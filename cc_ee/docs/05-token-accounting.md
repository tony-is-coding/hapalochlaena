# Token 计量与账本设计

**版本**: 2.0（cc_core 并发安全改造后）

---

## 1. 总览

```
query() generator 消费层
  │
  ├── event.type === 'assistant' && event.message.usage
  │     ├── input_tokens
  │     ├── output_tokens
  │     ├── cache_read_input_tokens（可选）
  │     └── cache_creation_input_tokens（可选）
  │
  ▼
原子 UPDATE token_ledgers
  SET used = used + $tokens
  WHERE tenant_id = $1 AND period = $2
  │
  ▼
PreToolUse HookCallback（下次工具调用前）
  └── 乐观读 token_ledgers
        → used >= total_budget → block
        → used < total_budget  → approve
```

---

## 2. token usage 来源

**已验证**：`PostToolUseHookInput` 不包含 `usage` 字段。

token usage 在 `query()` yield 出的 `AssistantMessage` 中：

```typescript
// cc_core 的 AssistantMessage 结构
type AssistantMessage = {
  type: 'assistant'
  message: {
    id: string
    type: 'message'
    role: 'assistant'
    content: ContentBlock[]
    model: string
    stop_reason: string | null
    usage: {
      input_tokens: number
      output_tokens: number
      cache_read_input_tokens?: number
      cache_creation_input_tokens?: number
      server_tool_use?: { web_search_requests?: number }
    }
  }
  session_id: string
}
```

---

## 3. Token 计费策略

### 3.1 基础计费

```typescript
function calcTokenCost(usage: Usage): number {
  // 基础：input + output
  const base = usage.input_tokens + usage.output_tokens

  // cache_read 按折扣计算（Anthropic 定价：cache read = 10% of input price）
  const cacheRead = Math.ceil((usage.cache_read_input_tokens ?? 0) * 0.1)

  // cache_creation 按溢价计算（Anthropic 定价：cache write = 125% of input price）
  const cacheWrite = Math.ceil((usage.cache_creation_input_tokens ?? 0) * 1.25)

  return base + cacheRead + cacheWrite
}
```

**简化方案**（Phase 1）：直接用 `input_tokens + output_tokens`，不考虑 cache 折扣。

### 3.2 计费时机

每次 `query()` generator yield `AssistantMessage` 时更新账本（每个 LLM 响应一次）。

---

## 4. Token Ledger 更新

### 4.1 原子 UPDATE（推荐）

```typescript
async function addTokenUsage(
  tenantId: string,
  tokens: number
): Promise<{ used: bigint; total_budget: bigint }> {
  const period = getCurrentPeriod()  // 'YYYY-MM'

  const result = await db.query<{ used: bigint; total_budget: bigint }>(
    `UPDATE token_ledgers
     SET used = used + $1, last_updated_at = NOW()
     WHERE tenant_id = $2 AND period = $3
     RETURNING used, total_budget`,
    [tokens, tenantId, period]
  )

  if (result.rowCount === 0) {
    // 当月账本不存在，初始化
    await initLedger(tenantId, period)
    return addTokenUsage(tenantId, tokens)  // 重试
  }

  return result.rows[0]
}

async function initLedger(tenantId: string, period: string): Promise<void> {
  await db.query(
    `INSERT INTO token_ledgers (tenant_id, period, total_budget, used)
     SELECT $1, $2, token_budget_monthly, 0
     FROM tenants WHERE id = $1
     ON CONFLICT (tenant_id, period) DO NOTHING`,
    [tenantId, period]
  )
}
```

**为什么用原子 UPDATE 而非 SELECT FOR UPDATE**：
- 原子 UPDATE 无需事务，单条 SQL 完成，性能更好
- 高并发下不会因行锁成为瓶颈
- `RETURNING` 子句返回更新后的值，可用于后续判断

### 4.2 PreToolUse 预算检查（乐观读）

```typescript
async function checkTokenBudget(tenantId: string): Promise<boolean> {
  const period = getCurrentPeriod()

  const result = await db.query<{ used: bigint; total_budget: bigint }>(
    `SELECT used, total_budget FROM token_ledgers
     WHERE tenant_id = $1 AND period = $2`,
    [tenantId, period]
  )

  if (result.rowCount === 0) return true  // 账本不存在，允许（首次使用）

  const { used, total_budget } = result.rows[0]
  return used < total_budget
}
```

**乐观读的权衡**：
- 不加锁，高并发下性能好
- 极小概率超支（两个并发请求同时通过检查，但只有一个 LLM 响应会更新账本）
- 超支量有限（最多一次 LLM 响应的 token 量），可接受

---

## 5. 月度账本管理

### 5.1 账本初始化

每月第一次使用时自动初始化（`ON CONFLICT DO NOTHING` 保证幂等）：

```typescript
// 在 addTokenUsage 中自动处理
// 也可以在月初通过 cron job 批量初始化
async function initMonthlyLedgers(): Promise<void> {
  const period = getCurrentPeriod()
  await db.query(
    `INSERT INTO token_ledgers (tenant_id, period, total_budget, used)
     SELECT id, $1, token_budget_monthly, 0
     FROM tenants WHERE status = 'active'
     ON CONFLICT (tenant_id, period) DO NOTHING`,
    [period]
  )
}
```

### 5.2 月度重置

token_ledgers 按 `(tenant_id, period)` 分区，每月自动产生新行，无需重置旧数据。

历史数据保留用于审计和报表。

---

## 6. Token 使用仪表盘 API

```typescript
// GET /api/tenants/:tenantId/token-usage
async function getTokenUsage(tenantId: string, period?: string) {
  const p = period ?? getCurrentPeriod()

  const result = await db.query(
    `SELECT
       tl.period,
       tl.total_budget,
       tl.used,
       tl.total_budget - tl.used AS remaining,
       ROUND(tl.used::numeric / tl.total_budget * 100, 2) AS usage_pct,
       tl.last_updated_at
     FROM token_ledgers tl
     WHERE tl.tenant_id = $1 AND tl.period = $2`,
    [tenantId, p]
  )

  return result.rows[0] ?? {
    period: p,
    total_budget: 0,
    used: 0,
    remaining: 0,
    usage_pct: 0
  }
}

// GET /api/tenants/:tenantId/token-usage/history
async function getTokenUsageHistory(tenantId: string, months: number = 6) {
  return db.query(
    `SELECT period, total_budget, used,
            ROUND(used::numeric / total_budget * 100, 2) AS usage_pct
     FROM token_ledgers
     WHERE tenant_id = $1
     ORDER BY period DESC
     LIMIT $2`,
    [tenantId, months]
  )
}
```

---

## 7. Phase 2：LLM Proxy 双重校验

Phase 1 只用 cc_ee 层的 token 计数。Phase 2 增加 LLM Proxy 做双重校验：

```
cc_ee → LLM Proxy → Anthropic API
              │
              └── 从 Anthropic 响应 header 读取 usage
                  → 写入独立的 proxy_token_ledgers 表
                  → 每日批量对比 token_ledgers vs proxy_token_ledgers
                  → 差异 > 5% → 告警
```

**为什么需要双重校验**：
- cc_ee 的计数依赖 `AssistantMessage.usage`，理论上可能有遗漏
- LLM Proxy 直接从 Anthropic API 响应读取，是权威来源
- 两者互相校验，防止计数漏洞

---

## 8. 告警规则

| 告警 | 触发条件 | 处理 |
|------|---------|------|
| 预算即将耗尽 | used >= total_budget * 0.9 | 通知租户管理员 |
| 预算已耗尽 | used >= total_budget | 阻断工具调用，通知管理员 |
| 异常消耗 | 单小时消耗 > 日均 * 3 | 告警，人工介入 |
| 计数差异（Phase 2）| cc_ee 与 LLM Proxy 差异 > 5% | 告警，人工复核 |
