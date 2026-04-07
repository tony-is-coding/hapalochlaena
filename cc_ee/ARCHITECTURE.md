# cc_ee 整体架构

**版本**: 3.0（经源码验证修正）
**基于**: 2026-04-07 技术细节验证报告

---

## 1. 整体架构图

```
┌─────────────────────────────────────────────────────────┐
│                      Web UI (React)                      │
│              浏览器端对话界面，类似 Claude.ai              │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTP / WebSocket
┌──────────────────────────▼──────────────────────────────┐
│                    API Gateway (Fastify)                  │
│        认证(JWT) · 租户路由 · 限流 · 会话路由             │
└──────┬────────────────────────────────────┬─────────────┘
       │                                    │
┌──────▼──────────────┐          ┌──────────▼──────────────┐
│   Control Plane      │          │    cc_ee Service         │
│  ─────────────────  │          │  ──────────────────────  │
│  · 租户 CRUD         │          │  · 多租户编排            │
│  · 用户管理          │◄────────►│  · 多会话管理            │
│  · Token 预算账本    │          │  · 限流 · 安全 · 鉴权    │
│  · Skill 仓库 & 分配 │          │  · 会话恢复 · 上下文组装 │
│  · 权限规则引擎       │          │  · HookCallback 拦截     │
└─────────────────────┘          └──────────┬──────────────┘
                                             │ 进程内调用
                                             │ runWithCwdOverride(tenantCwd, () => query(params))
                          ┌──────────────────▼──────────────────┐
                          │         cc_core (单进程多 session)   │
                          │                                      │
                          │  Session A (Tenant1/User1)           │
                          │    cwd: /sessions/t1/s1/             │
                          │    skills: .claude/skills/*.md       │
                          │                                      │
                          │  Session B (Tenant1/User2)           │
                          │    cwd: /sessions/t1/s2/             │
                          │    skills: .claude/skills/*.md       │
                          │                                      │
                          │  Session C (Tenant2/User3)           │
                          │    cwd: /sessions/t2/s3/             │
                          │    skills: .claude/skills/*.md       │
                          └────────────────────────────────────┘
                                             │
                          ┌──────────────────▼──────────────────┐
                          │           Anthropic API             │
                          │   (通过 ANTHROPIC_BASE_URL 配置)    │
                          └────────────────────────────────────┘
```

---

## 2. 分层职责

| 层 | 职责 | 技术选型 |
|---|---|---|
| **Web UI** | 对话界面、Session 管理 UI、租户管理后台 | React + TypeScript + WebSocket |
| **API Gateway** | 认证(JWT)、路由、限流 | Fastify (Node.js) |
| **Control Plane** | 租户/用户/Token/Skill 的管理数据面 | Node.js + PostgreSQL |
| **cc_ee Service** | 多租户编排、多会话管理、安全管控、Hook 拦截 | Node.js（与 cc_core 同进程）|
| **cc_core** | Agent 核心能力（query loop、工具执行、LLM 调用） | Node.js（原生，不修改）|

---

## 3. 关键设计决策

### 决策 1：进程内集成，直接调用 `query()` API

**背景**：cc_core 的 `src/server/server.ts` 和 `src/server/sessionManager.ts` 均为自动生成的 stub（3 行，无实际实现），server 模式不可用。

**方案**：cc_ee 与 cc_core 打包在同一 Node.js 进程，直接 import 并调用 `query()` API：

```typescript
import { query } from 'cc_core/query'
import { runWithCwdOverride } from 'cc_core/utils/cwd'
import { switchSession } from 'cc_core/bootstrap/state'

async function runSession(sessionId: string, tenantCwd: string, params: QueryParams) {
  switchSession(sessionId)
  return runWithCwdOverride(tenantCwd, () => query(params))
}
```

**理由**：
- 零网络开销（进程内调用）
- 直接访问 cc_core 的所有 API
- 无需维护独立的 server 进程

---

### 决策 2：`runWithCwdOverride` 实现 per-session cwd 隔离

**背景**：`cc_core/utils/cwd.ts` 提供 `runWithCwdOverride(cwd, fn)`，基于 Node.js `AsyncLocalStorage` 实现。cc_core 注释明确说明："enables concurrent agents to each see their own working directory without affecting each other"。

**方案**：每次调用 `query()` 时，用 `runWithCwdOverride(tenantCwd, ...)` 包裹，为该 session 设置独立的工作目录。

**效果**：
- 并发 session 各自看到自己的 cwd，互不干扰
- skill 从 cwd 向上遍历 `.claude/skills/` 动态加载，自动实现 per-tenant skill 隔离
- 文件系统操作限制在 session 工作目录内

---

### 决策 3：`registerHookCallbacks()` 替代 managed-settings.json 的 function hooks

**背景**：验证发现 `type: "function"` hook（`FunctionHook`）只能返回 pass/block，无法返回动态错误消息。`HookCallback`（`type: 'callback'`）才支持返回完整的 `HookJSONOutput`（含动态 `reason`）。

**方案**：cc_ee 进程启动时，通过 `registerHookCallbacks()` 一次性注册全局 HookCallback，hook 内部根据 sessionId 路由到对应租户逻辑：

```typescript
import { registerHookCallbacks } from 'cc_core/bootstrap/state'

// 进程启动时注册一次
registerHookCallbacks({
  PreToolUse: [{
    matcher: '*',
    hooks: [{
      type: 'callback',
      callback: async (input, toolUseID, signal, hookIndex, context) => {
        const sessionId = getSessionIdFromContext(context)
        const tenantId = sessionStore.getTenantId(sessionId)

        // 检查 token 预算
        const budgetOk = await tokenBudgetService.check(tenantId)
        if (!budgetOk) {
          return { decision: 'block', reason: 'Token budget exhausted for this month' }
        }

        // 检查 deny 规则
        const denied = await permissionService.checkDeny(tenantId, input)
        if (denied) {
          return { decision: 'block', reason: `Tool blocked by tenant policy: ${denied.rule}` }
        }

        return { decision: 'approve' }
      }
    }]
  }]
})
```

**优势**：
- 零文件 I/O（不依赖 managed-settings.json）
- 支持动态错误消息（`reason` 字段返回给模型）
- 完整 session 上下文访问（通过 sessionId 查租户配置）
- `registerHookCallbacks()` 支持 merge 语义，可多次调用

---

### 决策 4：token usage 从 `AssistantMessage.usage` 读取

**背景**：验证发现 `PostToolUseHookInput` 不包含 `usage` 字段。token usage 在 `query()` yield 出的 `AssistantMessage` 中（`event.message.usage`）。

**方案**：cc_ee 消费 `query()` 的 async generator 时，从 `AssistantMessage` 中读取 usage 并累计到 token ledger：

```typescript
for await (const event of query(params)) {
  if (event.type === 'assistant' && event.message?.usage) {
    const { input_tokens, output_tokens,
            cache_read_input_tokens, cache_creation_input_tokens } = event.message.usage
    const total = input_tokens + output_tokens
    await tokenLedger.atomicAdd(tenantId, total)
  }
  // 转发 event 给 WebSocket 客户端
  yield event
}
```

---

### 决策 5：token 计数用原子 UPDATE，不用 SELECT FOR UPDATE

**背景**：验证报告建议用原子 UPDATE 替代 SELECT FOR UPDATE，避免锁竞争。

**方案**：

```sql
-- PostToolUse：原子更新（无需先 SELECT）
UPDATE token_ledgers
SET used = used + $1, last_updated_at = NOW()
WHERE tenant_id = $2 AND period = $3
RETURNING used, total_budget;

-- PreToolUse：乐观读（不加锁）
SELECT total_budget, used FROM token_ledgers
WHERE tenant_id = $1 AND period = $2;
-- 如果 used >= total_budget，阻断工具调用
```

**理由**：
- 原子 UPDATE 无需事务，性能更好
- PreToolUse 的预算检查是乐观读，允许极小概率的超支（可接受）
- 高并发下不会因行锁成为瓶颈

---

### 决策 6：managed-settings.json 仅用于静态权限配置

**背景**：managed-settings.json 是全局路径（`~/.claude/managed-settings.json`），所有 session 共享，且有 session 级缓存（修改不立即生效）。

**方案**：managed-settings.json 只配置静态的、全局生效的安全规则：

```json
{
  "allowManagedHooksOnly": true,
  "permissions": {
    "deny": [
      "Bash(rm -rf /*)",
      "Bash(dd if=/dev/zero:*)",
      "Bash(curl * | bash:*)"
    ]
  }
}
```

动态的 per-tenant 权限规则（deny 规则、token 预算）全部在 HookCallback 中处理。

---

### 决策 7：并发 session 的 STATE.sessionId 竞态处理

**背景**：`switchSession()` 修改全局 `STATE.sessionId`，并发调用会导致 transcript 路径混乱。

**方案**：每个 cc_ee worker 进程顺序处理 session（不并发调用 `switchSession()`）。多个 worker 进程水平扩展，每个 worker 内部串行。

```
cc_ee Pod 1: Worker 1 → Session A → Session B → Session C (串行)
cc_ee Pod 2: Worker 2 → Session D → Session E → Session F (串行)
```

**注意**：`runWithCwdOverride` 是并发安全的（AsyncLocalStorage），但 `switchSession()` 不是。cwd 隔离可以并发，session 切换需要串行。

---

## 4. 与 v2 设计的关键差异

| 设计点 | v2 设计（tech-design.md） | v3 设计（本文档，经验证修正）|
|--------|--------------------------|---------------------------|
| Hook 注册方式 | managed-settings.json `type: "function"` | `registerHookCallbacks()` HookCallback |
| 动态错误消息 | ❌ FunctionHook 不支持 | ✅ HookCallback 支持 `reason` 字段 |
| per-session cwd | 未明确 | `runWithCwdOverride()` AsyncLocalStorage |
| token usage 来源 | PostToolUse hook 的 `usage` 字段 | `AssistantMessage.usage`（query() generator）|
| token 计数方式 | SELECT FOR UPDATE | 原子 UPDATE，乐观读 |
| server 模式 | 依赖 cc_core server 模式 | 直接调用 `query()` API（server 是 stub）|
| managed-settings.json | 动态 per-session 生成 | 仅静态全局安全规则 |
