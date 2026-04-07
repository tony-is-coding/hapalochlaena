# Hook 拦截系统

**版本**: 2.0（加入 cc_core STATE 并发安全改造）

---

## 1. 总览

cc_ee 通过 cc_core 的 `registerHookCallbacks()` API 在进程内注册 HookCallback，实现工具调用前后的拦截逻辑。

```
cc_core 准备执行工具
  │
  ▼
遍历 STATE.registeredHooks[PreToolUse]
  │
  ▼
调用 cc_ee 注册的 HookCallback
  ├── 检查 token 预算
  ├── 检查 deny 规则
  └── 写入审计日志
  │
  ├── { decision: 'block', reason: '...' }
  │     → 工具调用被阻断
  │     → reason 作为错误信息返回给模型
  │
  └── { decision: 'approve' }
        → 工具正常执行
        │
        ▼
      工具执行完成
        │
        ▼
      遍历 STATE.registeredHooks[PostToolUse]
        │
        ▼
      调用 cc_ee 注册的 PostToolUse HookCallback
        └── 更新 session last_active_at
```

**注意**：token usage 不在 PostToolUse hook 中读取，而是从 `query()` generator yield 的 `AssistantMessage.usage` 中读取。

---

## 2. Hook 注册（进程启动时）

```typescript
import { registerHookCallbacks, getSessionId } from 'cc_core/bootstrap/state'

export function registerCcEeHooks(deps: HookDeps) {
  registerHookCallbacks({
    PreToolUse: [{
      matcher: '*',   // 匹配所有工具
      hooks: [{
        type: 'callback',
        callback: preToolUseCallback(deps)
      }]
    }],
    PostToolUse: [{
      matcher: '*',
      hooks: [{
        type: 'callback',
        callback: postToolUseCallback(deps)
      }]
    }]
  })
}
```

---

## 3. PreToolUse HookCallback

```typescript
function preToolUseCallback(deps: HookDeps) {
  return async (input: PreToolUseHookInput): Promise<HookJSONOutput> => {
    // cc_core 改造后：getSessionId() 通过 AsyncLocalStorage 自动路由到当前 session
    const sessionId = getSessionId()
    const ctx = deps.sessionStore.get(sessionId)
    if (!ctx) return { decision: 'approve' }  // 非 cc_ee 管理的 session，放行

    const { tenantId, userId } = ctx

    // 1. 检查 token 预算（乐观读，不加锁）
    const ledger = await deps.db.query<{ used: bigint; total_budget: bigint }>(
      `SELECT used, total_budget FROM token_ledgers
       WHERE tenant_id = $1 AND period = $2`,
      [tenantId, getCurrentPeriod()]
    ).then(r => r.rows[0])

    if (ledger && ledger.used >= ledger.total_budget) {
      await deps.auditLog.write({
        sessionId, tenantId, userId,
        toolName: input.tool_name,
        inputSnapshot: sanitize(input.input),
        decision: 'block',
        reason: 'token_budget_exhausted'
      })
      return {
        decision: 'block',
        reason: 'Token budget exhausted for this month. Please contact your administrator.'
      }
    }

    // 2. 检查 deny 规则（动态，从租户配置读取）
    const tenant = await deps.tenantCache.get(tenantId)
    const matchedRule = matchDenyRules(
      input.tool_name,
      input.input,
      tenant.permission_rules?.deny ?? []
    )
    if (matchedRule) {
      await deps.auditLog.write({
        sessionId, tenantId, userId,
        toolName: input.tool_name,
        inputSnapshot: sanitize(input.input),
        decision: 'block',
        reason: 'deny_rule_matched'
      })
      return {
        decision: 'block',
        reason: `Tool blocked by tenant policy: ${matchedRule}`
      }
    }

    // 3. 记录审计日志（允许执行）
    await deps.auditLog.write({
      sessionId, tenantId, userId,
      toolName: input.tool_name,
      inputSnapshot: sanitize(input.input),
      decision: 'allow'
    })

    return { decision: 'approve' }
  }
}
```

---

## 4. PostToolUse HookCallback

```typescript
function postToolUseCallback(deps: HookDeps) {
  return async (input: PostToolUseHookInput): Promise<HookJSONOutput> => {
    const sessionId = getSessionId()
    const ctx = deps.sessionStore.get(sessionId)
    if (!ctx) return { decision: 'approve' }

    const { tenantId } = ctx

    // 更新 session last_active_at（异步，不阻塞）
    deps.db.query(
      `UPDATE sessions SET last_active_at = NOW() WHERE id = $1`,
      [sessionId]
    ).catch(err => console.error('Failed to update last_active_at', err))

    return { decision: 'approve' }
  }
}
```

**注意**：token usage 不在这里更新，而是在 `query()` generator 消费时从 `AssistantMessage.usage` 读取。

---

## 5. Token Usage 读取（query() generator）

```typescript
// 在 cc_ee 消费 query() generator 时
for await (const event of generator) {
  if (event.type === 'assistant' && event.message?.usage) {
    const { input_tokens, output_tokens } = event.message.usage
    const total = input_tokens + output_tokens

    // 原子更新 token ledger（无需事务，无锁竞争）
    await db.query(
      `UPDATE token_ledgers
       SET used = used + $1, last_updated_at = NOW()
       WHERE tenant_id = $2 AND period = $3`,
      [total, tenantId, getCurrentPeriod()]
    )
  }

  yield event  // 转发给 WebSocket 客户端
}
```

---

## 6. Deny 规则匹配

```typescript
// 规则格式：
// "Bash"           → 匹配所有 Bash 调用
// "Bash(rm -rf:*)" → 匹配 Bash 且 command 包含 "rm -rf"
// "Write"          → 匹配所有 Write 调用
// "*"              → 匹配所有工具

function matchDenyRules(
  toolName: string,
  input: Record<string, unknown>,
  denyRules: string[]
): string | null {
  for (const rule of denyRules) {
    if (matchRule(toolName, input, rule)) {
      return rule
    }
  }
  return null
}

function matchRule(toolName: string, input: Record<string, unknown>, rule: string): boolean {
  // 解析规则：ToolName(param:pattern)
  const match = rule.match(/^(\w+)(?:\((.+):(.+)\))?$/)
  if (!match) return false

  const [, ruleTool, ruleParam, rulePattern] = match

  // 工具名不匹配
  if (ruleTool !== '*' && ruleTool !== toolName) return false

  // 无参数约束，直接匹配
  if (!ruleParam) return true

  // 检查参数值
  const paramValue = String(input[ruleParam] ?? '')
  return minimatch(paramValue, rulePattern)
}
```

---

## 7. 审计日志

```typescript
interface AuditLogEntry {
  sessionId: string
  tenantId: string
  userId: string
  toolName: string
  inputSnapshot: Record<string, unknown>  // 脱敏后的输入
  decision: 'allow' | 'block'
  reason?: string
  timestamp: Date
}

// 写入 tool_audit_logs 表
async function writeAuditLog(entry: AuditLogEntry): Promise<void> {
  await db.query(
    `INSERT INTO tool_audit_logs
     (session_id, tenant_id, user_id, tool_name, input_snapshot, hook_decision, timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [entry.sessionId, entry.tenantId, entry.userId,
     entry.toolName, entry.inputSnapshot, entry.decision]
  )
}

// 输入脱敏（移除敏感字段）
function sanitize(input: Record<string, unknown>): Record<string, unknown> {
  const SENSITIVE_KEYS = ['password', 'token', 'secret', 'key', 'credential']
  return Object.fromEntries(
    Object.entries(input).map(([k, v]) => [
      k,
      SENSITIVE_KEYS.some(s => k.toLowerCase().includes(s)) ? '[REDACTED]' : v
    ])
  )
}
```

---

## 8. managed-settings.json 静态规则

managed-settings.json 只配置全局静态安全规则（不依赖租户配置）：

```json
{
  "allowManagedHooksOnly": true,
  "permissions": {
    "deny": [
      "Bash(rm -rf /*)",
      "Bash(dd if=/dev/zero:*)",
      "Bash(curl * | bash:*)",
      "Bash(wget * | bash:*)",
      "Bash(mkfs:*)"
    ]
  }
}
```

**`allowManagedHooksOnly: true`** 的作用：
- 屏蔽所有用户级 hook（`~/.claude/settings.json` 中的 hooks）
- 只允许 managed-settings.json 中配置的 hooks 和 `registerHookCallbacks()` 注册的 HookCallback
- 防止用户注入恶意 hook 绕过 cc_ee 的安全检查

---

## 9. Hook 执行顺序

```
PreToolUse 执行顺序：
  1. managed-settings.json 中的 hooks（静态规则）
  2. registerHookCallbacks() 注册的 HookCallback（cc_ee 动态规则）

任一 hook 返回 block → 工具调用被阻断，后续 hook 不再执行
```

---

## 10. 错误处理

```typescript
// HookCallback 内部异常处理
const callback = async (input) => {
  try {
    return await preToolUseLogic(input)
  } catch (err) {
    // DB 连接失败等异常：记录日志，默认放行（fail-open）
    // 生产环境可改为 fail-closed（返回 block）
    console.error('PreToolUse hook error:', err)
    return { decision: 'approve' }
  }
}
```

**fail-open vs fail-closed**：
- **fail-open**（默认放行）：DB 故障时用户体验不中断，但可能有短暂超支风险
- **fail-closed**（默认阻断）：安全性更高，但 DB 故障会导致所有工具调用失败

建议：token 预算检查 fail-open，deny 规则检查 fail-closed。
