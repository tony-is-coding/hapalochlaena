# cc_core 集成方式（经源码验证）

**版本**: 1.0（基于 2026-04-07 验证报告）

---

## 1. 集成模式总览

cc_ee 与 cc_core 打包在同一 Node.js 进程，通过直接 import 调用 cc_core 的内部 API。

```
cc_ee Service
  ├── 进程启动时
  │   ├── registerHookCallbacks()   ← 注册全局 HookCallback（一次）
  │   └── setOriginalCwd()          ← 设置进程基础 cwd
  │
  └── 每次 session 请求时
      ├── switchSession(sessionId)  ← 切换 STATE.sessionId（串行）
      └── runWithCwdOverride(       ← 设置 per-session cwd（AsyncLocalStorage）
            tenantCwd,
            () => query(params)     ← 调用 cc_core 核心 API
          )
```

---

## 2. 关键 API 清单

### 2.1 `query()` — 核心调用入口

```typescript
// src/query.ts
export async function* query(params: QueryParams): AsyncGenerator<
  StreamEvent | RequestStartEvent | Message | TombstoneMessage | ToolUseSummaryMessage,
  Terminal
>

type QueryParams = {
  messages: Message[]
  systemPrompt: SystemPrompt
  userContext: { [k: string]: string }
  systemContext: { [k: string]: string }
  canUseTool: CanUseToolFn
  toolUseContext: ToolUseContext
  fallbackModel?: string
  querySource: QuerySource
  maxOutputTokensOverride?: number
  maxTurns?: number
  skipCacheWrite?: boolean
  taskBudget?: { total: number }
  deps?: QueryDeps
}
```

**注意**：`QueryParams` 没有 `cwd` 字段，cwd 通过 `runWithCwdOverride` 在 AsyncLocalStorage 中设置。

---

### 2.2 `runWithCwdOverride()` — per-session cwd 隔离

```typescript
// src/utils/cwd.ts
export function runWithCwdOverride<T>(cwd: string, fn: () => T): T

// 内部实现：基于 AsyncLocalStorage，并发安全
const cwdOverrideStorage = new AsyncLocalStorage<string>()
export function runWithCwdOverride<T>(cwd: string, fn: () => T): T {
  return cwdOverrideStorage.run(cwd, fn)
}
```

**效果**：
- `fn` 及其所有异步后代调用 `getCwd()` 时，返回 `cwd` 而非全局 `STATE.cwd`
- 并发 session 各自看到自己的 cwd，互不干扰
- skill 加载（`getSkills(cwd)`）自动使用该 cwd，实现 per-tenant skill 隔离

---

### 2.3 `switchSession()` — session 切换

```typescript
// src/bootstrap/state.ts
export function switchSession(sessionId: SessionId, projectDir: string | null = null): void
```

**注意**：修改全局 `STATE.sessionId`，**不是并发安全的**。cc_ee 必须串行调用（每个 worker 进程内部串行处理 session）。

---

### 2.4 `registerHookCallbacks()` — 注册全局 HookCallback

```typescript
// src/bootstrap/state.ts
export function registerHookCallbacks(
  hooks: Partial<Record<HookEvent, RegisteredHookMatcher[]>>
): void

type HookCallbackMatcher = {
  matcher?: string       // 工具名匹配模式，undefined = 匹配所有
  hooks: HookCallback[]
  pluginName?: string
}

// HookCallback 定义（src/types/hooks.ts）
type HookCallback = {
  type: 'callback'
  callback: (
    input: HookInput,
    toolUseID: string,
    signal: AbortSignal,
    hookIndex: number,
    context: unknown
  ) => Promise<HookJSONOutput>
}

type HookJSONOutput = {
  decision: 'approve' | 'block'
  reason?: string        // block 时返回给模型的错误消息
}
```

**特性**：
- 支持多次调用（merge 语义，不覆盖）
- 进程启动时注册一次，对所有 session 生效
- hook 内部通过 `getSessionId()` 获取当前 sessionId，路由到对应租户逻辑

---

### 2.5 `getSessionId()` — 在 hook 内获取当前 session

```typescript
// src/bootstrap/state.ts
export function getSessionId(): SessionId
```

在 HookCallback 内调用，获取当前正在执行的 session ID，用于查找对应的租户信息。

---

## 3. 完整集成示例

### 3.1 进程启动初始化

```typescript
import { registerHookCallbacks, setOriginalCwd, getSessionId } from 'cc_core/bootstrap/state'
import { runWithCwdOverride } from 'cc_core/utils/cwd'
import { query } from 'cc_core/query'

// 进程启动时执行一次
export function initCcCore(baseCwd: string) {
  setOriginalCwd(baseCwd)

  registerHookCallbacks({
    PreToolUse: [{
      matcher: '*',
      hooks: [{
        type: 'callback',
        callback: async (input, toolUseID, signal) => {
          const sessionId = getSessionId()
          const tenantId = sessionStore.getTenantId(sessionId)

          // 1. 检查 token 预算（乐观读）
          const { used, total_budget } = await db.query(
            `SELECT used, total_budget FROM token_ledgers
             WHERE tenant_id = $1 AND period = $2`,
            [tenantId, getCurrentPeriod()]
          ).then(r => r.rows[0])

          if (used >= total_budget) {
            await auditLog({ sessionId, tenantId, decision: 'block', reason: 'budget_exhausted' })
            return {
              decision: 'block',
              reason: 'Token budget exhausted for this month. Contact your administrator.'
            }
          }

          // 2. 检查 deny 规则
          const tenant = await tenantCache.get(tenantId)
          const matchedRule = matchDenyRules(tenant.permission_rules.deny, input)
          if (matchedRule) {
            await auditLog({ sessionId, tenantId, decision: 'block', reason: 'deny_rule' })
            return {
              decision: 'block',
              reason: `Tool blocked by tenant policy: ${matchedRule}`
            }
          }

          // 3. 记录审计日志（允许）
          await auditLog({ sessionId, tenantId, decision: 'allow', toolName: input.tool_name })
          return { decision: 'approve' }
        }
      }]
    }]
  })
}
```

### 3.2 Session 请求处理

```typescript
import { switchSession } from 'cc_core/bootstrap/state'
import { runWithCwdOverride } from 'cc_core/utils/cwd'
import { query } from 'cc_core/query'

// 每次 session 请求时（串行执行）
export async function* handleSessionQuery(
  sessionId: string,
  tenantId: string,
  tenantCwd: string,
  params: QueryParams
): AsyncGenerator<StreamEvent | Message> {
  // 1. 注册 session → tenant 映射（供 HookCallback 查询）
  sessionStore.set(sessionId, tenantId)

  // 2. 切换 session（修改全局 STATE，必须串行）
  switchSession(sessionId)

  // 3. 在 per-session cwd 上下文中执行 query
  const generator = runWithCwdOverride(tenantCwd, () => query(params))

  // 4. 消费 generator，提取 token usage
  for await (const event of generator) {
    // 从 AssistantMessage 提取 token usage
    if (event.type === 'assistant' && event.message?.usage) {
      const { input_tokens, output_tokens } = event.message.usage
      const total = input_tokens + output_tokens

      // 原子更新 token ledger
      await db.query(
        `UPDATE token_ledgers
         SET used = used + $1, last_updated_at = NOW()
         WHERE tenant_id = $2 AND period = $3`,
        [total, tenantId, getCurrentPeriod()]
      )
    }

    yield event
  }
}
```

---

## 4. cc_core 内部机制说明

### 4.1 Skill 加载机制

cc_core 的 `getSkills(cwd)` 从 `cwd` 向上遍历查找 `.claude/skills/`，每次 query 时动态加载。

```
tenantCwd = /sessions/tenant-1/session-abc/
  ↓ getSkills(tenantCwd)
  ↓ 查找 /sessions/tenant-1/session-abc/.claude/skills/*.md
  ↓ 查找 /sessions/tenant-1/.claude/skills/*.md
  ↓ 查找 /sessions/.claude/skills/*.md
  ↓ 查找 ~/.claude/skills/*.md（managed skills）
```

cc_ee 在 session 启动时将租户激活的 skill 写入 `tenantCwd/.claude/skills/`，`runWithCwdOverride` 确保 `getSkills` 使用正确的 cwd。

### 4.2 HookCallback 执行时机

```
query() 调用
  → cc_core 准备执行工具
  → 遍历 STATE.registeredHooks[PreToolUse]
  → 调用每个 HookCallback.callback(input, ...)
  → 如果任一返回 { decision: 'block' }，工具调用被阻断
  → reason 字段作为错误信息返回给模型
```

### 4.3 AssistantMessage.usage 结构

```typescript
type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  server_tool_use?: { web_search_requests?: number }
}
```

token 计费建议：`input_tokens + output_tokens`（cache tokens 按 Anthropic 定价折扣计算）。

---

## 5. 已知限制

| 限制 | 说明 | 缓解方案 |
|------|------|---------|
| `switchSession()` 非并发安全 | 修改全局 STATE，并发调用会导致 transcript 路径混乱 | 每个 worker 进程串行处理 session |
| managed-settings.json 全局共享 | 无法 per-session 配置 | 静态全局规则放 managed-settings，动态规则放 HookCallback |
| `STATE.registeredHooks` 全局共享 | 所有 session 共享同一套 HookCallback | HookCallback 内部通过 sessionId 路由到租户逻辑 |
| cc_core 无 server 模式 | `src/server/server.ts` 是 stub | 直接调用 `query()` API |
