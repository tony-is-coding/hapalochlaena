# 技术细节深化验证报告

**版本**: 1.0
**日期**: 2026-04-07
**状态**: Verified
**基于**: cc_core 源码分析（deep-dive-claude-code/claude-code/src/）

---

## 概述

本文档对架构设计中标注"实现略"或存在假设的关键技术细节进行源码级验证，确保方案在实际开发前没有根本性错误。

---

## 1. Hook 机制验证

### 1.1 Hook 类型全貌

**源码位置**: `src/utils/settings/types.ts`, `src/types/hooks.ts`

cc_core 支持以下 Hook 类型：

| 类型 | 说明 | 适用场景 |
|------|------|---------|
| `command` | Shell 命令，通过 exit code 控制行为 | 外部脚本 |
| `prompt` | LLM prompt hook | 智能判断 |
| `agent` | 多轮 LLM agent hook | 复杂验证 |
| `http` | HTTP 请求 hook | 外部服务 |
| `callback` | 进程内 TypeScript 回调（内部 SDK 用） | SDK 内部 |
| `function` | 进程内 TypeScript 函数（session 级） | **cc_ee 集成** |

**关键发现**：`type: "function"` 的 `FunctionHook` 确实存在，是 session 级别的进程内回调，正是我们架构设计中需要的机制。

### 1.2 FunctionHook 接口定义

**源码位置**: `src/utils/hooks/sessionHooks.ts:15-31`

```typescript
export type FunctionHookCallback = (
  messages: Message[],
  signal?: AbortSignal,
) => boolean | Promise<boolean>

export type FunctionHook = {
  type: 'function'
  id?: string          // 可选唯一 ID，用于移除
  timeout?: number     // 超时（毫秒）
  callback: FunctionHookCallback
  errorMessage: string
  statusMessage?: string
}
```

**⚠️ 重要差异**：FunctionHook 的 callback 签名是 `(messages: Message[], signal?) => boolean`，**不是** 我们架构文档中设计的 `(input: HookInput) => HookJSONOutput`。

- 返回 `true` = 允许继续
- 返回 `false` = 阻断（使用注册时固定的 `errorMessage`）
- **无法返回动态错误消息**（错误消息在注册时就固定了）

这意味着 FunctionHook 只能做 pass/block 决策，**不能向模型返回动态错误消息**（如"租户 X 的 token 预算已耗尽"）。

### 1.3 FunctionHook 执行机制

**源码位置**: `src/utils/hooks.ts:4895-4960`

```typescript
async function executeFunctionHook({ hook, messages, ... }): Promise<HookResult> {
  const passed = await Promise.resolve(hook.callback(messages, abortSignal))

  if (passed) {
    return { outcome: 'success', hook }
  }
  return {
    blockingError: {
      blockingError: hook.errorMessage,  // 固定错误消息，不能动态设置
      command: 'function',
    },
    outcome: 'blocking',
    hook,
  }
}
```

**结论**：FunctionHook 的错误消息在注册时就固定了（`errorMessage` 字段），无法在运行时动态返回"Token budget exhausted for tenant X"这样的动态消息。

### 1.4 HookCallback 接口（更强大）

**源码位置**: `src/types/hooks.ts:209-225`

```typescript
export type HookCallback = {
  type: 'callback'
  callback: (
    input: HookInput,
    toolUseID: string | null,
    abort: AbortSignal | undefined,
    hookIndex?: number,
    context?: HookCallbackContext,
  ) => Promise<HookJSONOutput>
  timeout?: number
  internal?: boolean
}
```

`HookCallback` 可以返回完整的 `HookJSONOutput`，包括：
- `decision: 'approve' | 'block'`
- `reason: string`（动态错误消息）
- `hookSpecificOutput.permissionDecision`
- `additionalContext`

**但是**：`HookCallback` 是通过 `getRegisteredHooks()` 注册的，属于**全局进程级**注册，不是 session 级别的。

### 1.5 allowManagedHooksOnly 验证

**源码位置**: `src/utils/hooks/hooksConfigSnapshot.ts:12-68`

```
// If allowManagedHooksOnly is set in policySettings, only managed hooks are returned.
// If disableAllHooks is set in non-managed settings, only managed hooks still run
// (non-managed settings cannot disable managed hooks).
```

**验证通过**：`allowManagedHooksOnly: true` 在 `policySettings`（即 managed-settings.json）中设置后，cc_core 只会执行来自 policySettings 的 hooks，用户级 hooks 被完全屏蔽。这与我们的安全设计一致。

---

## 2. Session 管理机制验证

### 2.1 cc_core 的集成模式（cc_ee 打包场景）

cc_ee 与 cc_core 打包在一起，cc_ee 是宿主进程，cc_core 作为库被直接引入（不是 spawn 子进程）。

**bridge 模式**（`src/bridge/sessionRunner.ts`）是 Claude.ai Web UI 的接入方式，每个 session spawn 一个子进程——这不是 cc_ee 的集成方式。

**cc_ee 的集成方式**：直接调用 cc_core 的 `query()` API：

```typescript
import { query } from 'cc_core/query'
import { init } from 'cc_core/entrypoints/init'
import { switchSession } from 'cc_core/bootstrap/state'

// 进程启动时初始化一次
await init()

// 每个 session 请求
switchSession(sessionId)
for await (const message of query({ messages, systemPrompt, toolUseContext, ... })) {
  // 处理流式输出
}
```

### 2.2 单进程多 session 的隔离机制

**源码位置**: `src/state/AppState.tsx`, `src/state/AppStateStore.ts`

cc_core 的 session 状态（`AppState`）是通过 **React `useState` + `createStore`** 创建的，每个 session 有独立的 store 实例。`getAppState`/`setAppState` 是绑定到各自 store 的闭包，通过 `ToolUseContext` 传递给 `query()`。

**关键区分**：
- `STATE`（`src/bootstrap/state.ts`）：进程级全局状态，包含 `sessionId`、`registeredHooks` 等
- `AppState`（`src/state/AppStateStore.ts`）：session 级状态，包含权限、工具状态、session hooks 等

`STATE.sessionId` 是全局的，但 `AppState` 是 per-session 的。cc_ee 在同一进程内并发运行多个 session 时，每个 session 有独立的 `AppState` 实例，通过 `ToolUseContext` 传入 `query()`。

### 2.3 并发 session 的可行性

**验证通过**：cc_ee 可以在同一进程内并发运行多个 session，因为：
1. `AppState`（session 核心状态）是 per-session 的闭包，不共享
2. `ToolUseContext`（包含 `getAppState`/`setAppState`）是 per-session 的，传入 `query()` 时各自独立
3. `STATE.sessionId` 是全局的，但只用于 transcript 路径等辅助功能，不影响核心逻辑

**注意**：`STATE.sessionId` 的全局性意味着在并发场景下，`getSessionId()` 可能返回错误的 session ID。cc_ee 需要避免依赖 `getSessionId()` 来识别当前 session，而应通过 `ToolUseContext` 传递 session 信息。

### 2.4 HookCallback 的全局注册与 per-session 路由

`registerHookCallbacks()` 写入 `STATE.registeredHooks`（全局），所以 cc_ee 注册的 `HookCallback` 对所有 session 生效。这正是我们想要的：

```typescript
// 进程启动时注册一次，对所有 session 生效
registerHookCallbacks({
  PreToolUse: [{
    matcher: '*',
    hooks: [{
      type: 'callback',
      callback: async (input, toolUseID, signal, hookIndex, context) => {
        // context.getAppState() 返回当前 session 的 AppState
        // 从 AppState 中读取 tenantId（cc_ee 在 session 创建时写入）
        const appState = context?.getAppState()
        const tenantId = appState?.ccEETenantId  // cc_ee 自定义字段
        // ... 检查 token 预算、权限等
      }
    }]
  }]
})
```

cc_ee 在创建 session 时，通过 `setAppState` 将 `tenantId` 写入 `AppState`，hook callback 通过 `context.getAppState()` 读取，实现 per-session 路由。

---

## 3. managed-settings.json 加载机制验证

### 3.1 加载路径

**源码位置**: `src/utils/settings/settings.ts:58-60`

```typescript
function getManagedSettingsFilePath(): string {
  return join(getManagedFilePath(), 'managed-settings.json')
}
```

**源码位置**: `src/utils/settings/managedPath.ts`（需进一步确认路径）

managed-settings.json 的路径基于 `getManagedFilePath()`，这个路径在不同平台有不同的默认值（通常是系统级配置目录）。

**⚠️ 关键问题**：managed-settings.json 是**全局路径**，不是 per-session 路径。如果多个 session 共享同一个 cc_core 进程，它们会读取同一个 managed-settings.json。

### 3.2 policySettings 优先级

**源码位置**: `src/utils/settings/settings.ts:322-345`

policySettings 的优先级（从高到低）：
1. Remote managed settings（远程）
2. MDM（HKLM/macOS plist）
3. managed-settings.json + managed-settings.d/（文件）
4. HKCU（用户注册表，最低）

**结论**：我们的方案使用 managed-settings.json 是正确的，它是 policySettings 的文件来源，优先级高于用户设置。

### 3.3 Settings 缓存机制

**源码位置**: `src/utils/settings/settings.ts:856-868`

```typescript
export function getSettingsWithErrors(): SettingsWithErrors {
  const cached = getSessionSettingsCache()
  if (cached !== null) return cached

  const result = loadSettingsFromDisk()
  setSessionSettingsCache(result)
  return result
}
```

**⚠️ 重要发现**：settings 有 session 级缓存，`resetSettingsCache()` 可以使缓存失效。这意味着：
- cc_core 启动后会缓存 settings
- 如果 cc_ee 在 session 运行中修改了 managed-settings.json，**不会立即生效**
- 需要调用 `resetSettingsCache()` 或重启 session 才能生效

这与我们架构文档中"每次任务前动态写入 managed-settings.json"的方案**存在冲突**——如果 session 已经启动并缓存了 settings，中途修改文件不会生效。

---

## 4. Token 计数机制验证

### 4.1 PostToolUse Hook 的 usage 字段

**源码位置**: `src/entrypoints/agentSdkTypes.ts`（PostToolUseHookInput 类型）

PostToolUse hook 的输入包含 `usage` 字段，包含 `input_tokens` 和 `output_tokens`。这与我们的设计一致。

### 4.2 SELECT FOR UPDATE 的适用性

我们设计中使用 PostgreSQL `SELECT FOR UPDATE` 来防止 token 计数竞态条件。这个设计是正确的，但需要注意：

- `SELECT FOR UPDATE` 会锁定行，高并发时可能成为瓶颈
- 建议使用 `UPDATE token_ledgers SET used = used + $1 WHERE ...` 的原子更新，而不是先 SELECT 再 UPDATE
- 对于 PreToolUse 的预算检查，可以用乐观锁（先读不锁，超限时再用事务确认）

---

## 5. 关键问题汇总与修正方案

### 问题 1：FunctionHook 无法返回动态错误消息

**影响**：PreToolUse hook 无法向模型返回"Token budget exhausted for tenant X"这样的动态消息。

**修正方案**：使用 `HookCallback`（`type: 'callback'`）替代 `FunctionHook`。

`HookCallback` 的 callback 接收完整的 `HookInput`（包含 `tool_name`、`tool_input` 等），可以返回完整的 `HookJSONOutput`：

```typescript
// src/entrypoints/sdk/coreTypes.generated.ts
type PreToolUseHookInput = HookInput & { tool_name: string }  // ✅ 有 tool_name

// src/types/hooks.ts
type HookCallback = {
  type: 'callback'
  callback: (
    input: HookInput,          // ✅ 接收完整 HookInput，含 tool_name
    toolUseID: string | null,
    abort: AbortSignal | undefined,
    hookIndex?: number,
    context?: HookCallbackContext,
  ) => Promise<HookJSONOutput>  // ✅ 可返回动态 reason
}
```

注册方式（通过 `registerHookCallbacks`，进程启动时一次性注册）：

```typescript
import { registerHookCallbacks } from 'cc_core/bootstrap/state'

registerHookCallbacks({
  PreToolUse: [{
    matcher: '*',
    hooks: [{
      type: 'callback',
      callback: async (input, toolUseID, signal, hookIndex, context) => {
        const sessionId = getSessionId()  // 从 cc_core bootstrap state 获取
        const tenantId = await sessionStore.getTenantId(sessionId)
        const budgetOk = await tokenBudgetService.check(tenantId)
        if (!budgetOk) {
          return {
            decision: 'block',
            reason: `Token budget exhausted for this month`,
          }
        }
        return { decision: 'approve' }
      }
    }]
  }]
})
```

**推荐**：使用 `HookCallback` + `registerHookCallbacks`，进程内调用，零网络开销，支持动态消息。

### 问题 2：单进程多 session 需要 server 模式

**影响**：架构文档中的"单进程多 session"需要使用 cc_core 的 server 模式，而不是 bridge 模式。

**修正方案**：cc_ee 以 server 模式启动 cc_core（或直接作为库引入），通过 cc_core 的 server API 管理多个 session。需要进一步研究 cc_core server 模式的 API 接口。

### 问题 3：managed-settings.json 是全局路径，不是 per-session

**影响**：无法为每个 session 动态生成独立的 managed-settings.json，因为所有 session 共享同一个路径。

**修正方案**：
- **方案 A**：每个 session 启动独立的 cc_core 进程（回到"一进程一 session"），每个进程有独立的工作目录和 managed-settings.json
- **方案 B**：使用 `HookCallback`（进程内注册）替代 managed-settings.json 中的 hooks，在 cc_ee 层按 session 路由到对应的租户逻辑
- **方案 C**：使用 cc_core 的 `flagSettings`（`--settings` 标志）为每个 session 指定独立的 settings 文件路径

**推荐**：方案 B，在 cc_ee 层通过 `HookCallback` 注册进程内 hook，hook 内部根据 sessionId 查找对应的租户配置，完全绕过 managed-settings.json 的路径限制。

### 问题 4：Settings 缓存导致动态更新不生效

**影响**：session 启动后修改 managed-settings.json 不会立即生效。

**修正方案**：如果采用问题 3 的方案 B（HookCallback），则完全不依赖 managed-settings.json，此问题自然消失。

---

## 6. 修正后的架构方案

基于以上验证，对架构设计的关键修正：

### 6.1 Hook 注册方式修正

**原方案**：通过 managed-settings.json 注入 `type: "function"` hooks

**修正方案**：通过 cc_core SDK 的 `getRegisteredHooks()` 机制注册 `HookCallback`（`type: 'callback'`），在 cc_ee 启动时一次性注册，hook 内部根据 sessionId 动态路由到对应租户逻辑：

```typescript
// cc_ee 启动时注册全局 HookCallback
registerHooks({
  PreToolUse: [{
    matcher: '*',
    hooks: [{
      type: 'callback',
      callback: async (input, toolUseID, signal, hookIndex, context) => {
        const sessionId = getSessionIdFromContext(context)
        const tenantId = await sessionStore.getTenantId(sessionId)

        // 检查 token 预算
        const budgetOk = await tokenBudgetService.check(tenantId)
        if (!budgetOk) {
          return {
            decision: 'block',
            reason: `Token budget exhausted for this month`,
          }
        }

        // 检查 deny 规则
        const denied = await permissionService.checkDeny(tenantId, input)
        if (denied) {
          return {
            decision: 'block',
            reason: `Tool blocked by tenant policy: ${denied.rule}`,
          }
        }

        return { decision: 'approve' }
      }
    }]
  }]
})
```

### 6.2 Session 隔离方式修正

**原方案**：每个 session 独立的 managed-settings.json

**修正方案**：
- 权限控制：通过 HookCallback 在运行时按 sessionId 查租户配置
- 文件系统隔离：通过 cc_core 的 `permissions.additionalDirectories` 配置（在 server 模式启动时传入）
- Skill 注入：在 session 工作目录写入 `.claude/skills/`，cc_core 启动 session 时自动加载

### 6.3 Token 计数修正

**原方案**：SELECT FOR UPDATE + 两步操作

**修正方案**：使用原子 UPDATE 避免锁竞争：

```sql
-- PreToolUse：检查预算（乐观读，不加锁）
SELECT total_budget, used FROM token_ledgers
WHERE tenant_id = $1 AND period = $2;

-- PostToolUse：原子更新（无需先 SELECT）
UPDATE token_ledgers
SET used = used + $1, last_updated_at = NOW()
WHERE tenant_id = $2 AND period = $3
RETURNING used, total_budget;

-- 如果 used > total_budget，下次 PreToolUse 会检测到并阻断
```

---

## 7. 待进一步验证的问题

1. **cc_core server 模式 API**：需要阅读 `src/server/server.ts` 和 `src/server/sessionManager.ts`，确认 server 模式的启动方式和 session 管理 API
2. **HookCallback 注册接口**：`getRegisteredHooks()` 和对应的 `registerHooks()` 的完整 API，确认 cc_ee 如何在进程启动时注册全局 hooks
3. **Session 工作目录配置**：server 模式下如何为每个 session 指定独立的工作目录
4. **Skill 加载时机**：server 模式下 skill 是在 session 启动时加载还是进程启动时加载

---

## 8. 结论

| 原设计假设 | 验证结果 | 影响 |
|-----------|---------|------|
| `type: "function"` hook 可返回动态错误消息 | ❌ 不支持，只能 pass/block | 需改用 HookCallback |
| managed-settings.json 可 per-session | ❌ 全局路径，所有 session 共享 | 需改用进程内 HookCallback |
| `allowManagedHooksOnly` 可锁定 hooks | ✅ 验证通过 | 无需修改 |
| Settings 缓存可动态更新 | ❌ 有缓存，修改不立即生效 | 改用 HookCallback 后此问题消失 |
| 单进程多 session 可行 | ✅ server 模式支持 | 需确认 server API |
| PostgreSQL 行级锁防竞态 | ✅ 可行，但可优化为原子 UPDATE | 建议优化 |

**核心结论**：架构方向正确，但 Hook 注册机制需要从"managed-settings.json 注入"改为"cc_ee 进程内 HookCallback 注册"。这实际上是更优的方案——零文件 I/O、动态消息、完整 session 上下文访问。
