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

**背景**：cc_core 的 server 模式（`src/server/server.ts`）是自动生成的 stub，不可用。

**方案**：cc_ee 与 cc_core 打包在同一进程，直接 import 并调用：

```typescript
import { query } from 'cc_core/query'
import { runWithCwdOverride } from 'cc_core/utils/cwd'
import { switchSession } from 'cc_core/bootstrap/state'

switchSession(sessionId)
const result = runWithCwdOverride(tenantCwd, () => query(params))
```

---

### 决策 2：`runWithCwdOverride` 实现 per-session cwd 隔离

**背景**：`cc_core/utils/cwd.ts` 基于 `AsyncLocalStorage` 实现，并发安全。cc_core 注释明确说明："enables concurrent agents to each see their own working directory without affecting each other"。

**效果**：
- 并发 session 各自看到自己的 cwd
- skill 从 `cwd/.claude/skills/` 自动加载，实现 per-tenant skill 隔离
- 文件操作限制在 session 工作目录内

---

### 决策 3：`registerHookCallbacks()` 替代 managed-settings.json function hooks

**背景**：`type: "function"` 的 `FunctionHook` 只能 pass/block，无法返回动态错误消息。`HookCallback`（`type: 'callback'`）支持返回 `{ decision: 'block', reason: '...' }`。

**方案**：进程启动时注册全局 HookCallback，hook 内部通过 `getSessionId()` 路由到对应租户逻辑。

---

### 决策 4：token usage 从 `AssistantMessage.usage` 读取

**背景**：`PostToolUseHookInput` 不包含 `usage` 字段（已验证）。

**方案**：消费 `query()` generator 时，从 `event.type === 'assistant'` 的 `event.message.usage` 读取，原子更新 `token_ledgers`。

---

### 决策 5：token 计数用原子 UPDATE

**方案**：

```sql
-- 更新（原子，无需事务）
UPDATE token_ledgers SET used = used + $1 WHERE tenant_id = $2 AND period = $3;

-- 检查（乐观读，不加锁）
SELECT total_budget, used FROM token_ledgers WHERE tenant_id = $1 AND period = $2;
```

---

### 决策 6：managed-settings.json 仅用于静态全局规则

**背景**：managed-settings.json 是全局路径，所有 session 共享，有缓存（修改不立即生效）。

**方案**：只配置平台级静态 deny 规则和 `allowManagedHooksOnly: true`。动态 per-tenant 规则全部在 HookCallback 中处理。

---

### 决策 7：并发 session 的 STATE.sessionId 竞态处理

**背景**：`switchSession()` 修改全局 `STATE.sessionId`，并发调用会导致 transcript 路径混乱。

**方案**：每个 cc_ee worker 进程串行处理 session（不并发调用 `switchSession()`）。多 worker 进程水平扩展。

---

## 4. 与历史设计文档的差异

| 设计点 | v1（enterprise-platform-design）| v2（tech-design）| v3（本文档，经验证）|
|--------|--------------------------------|-----------------|-------------------|
| 集成方式 | cc_core 子进程（stdio）| 进程内 query() | 进程内 query() ✓ |
| Hook 方式 | HTTP hooks | managed-settings function hooks | registerHookCallbacks() HookCallback |
| 动态错误消息 | ✓（HTTP 响应体）| ❌（FunctionHook 不支持）| ✓（HookCallback reason 字段）|
| per-session cwd | 进程级隔离 | 未明确 | runWithCwdOverride() AsyncLocalStorage |
| token usage 来源 | PostToolUse HTTP body | PostToolUse hook usage 字段 | AssistantMessage.usage（generator）|
| token 计数方式 | 无明确方案 | SELECT FOR UPDATE | 原子 UPDATE，乐观读 |
| server 模式 | 不依赖 | 依赖（实为 stub）| 不依赖，直接 query() |
