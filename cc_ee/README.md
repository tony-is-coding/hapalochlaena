# cc_ee — 企业级 Agent 编排层

cc_ee (Claude Code Enterprise Edition) 是构建在 cc_core 之上的企业级 SaaS 多租户 Agent 平台编排层。

## 文档导航

| 文档 | 内容 |
|------|------|
| [docs/01-architecture.md](./docs/01-architecture.md) | 整体架构、分层职责、关键设计决策 |
| [docs/02-cc-core-integration.md](./docs/02-cc-core-integration.md) | cc_core 集成方式（经源码验证） |
| [docs/03-session-lifecycle.md](./docs/03-session-lifecycle.md) | Session 生命周期与上下文组装 |
| [docs/04-hook-system.md](./docs/04-hook-system.md) | Hook 拦截机制（token 预算 + 权限拦截） |
| [docs/05-token-accounting.md](./docs/05-token-accounting.md) | Token 计量与账本设计 |
| [docs/06-skill-system.md](./docs/06-skill-system.md) | Skill 仓库与租户动态分配 |
| [docs/07-data-model.md](./docs/07-data-model.md) | 数据模型（PostgreSQL schema） |
| [docs/08-security.md](./docs/08-security.md) | 安全边界与隔离机制 |
| [docs/09-roadmap.md](./docs/09-roadmap.md) | 实施路线图（Phase 1a → Phase 5） |

## 核心设计原则

- **零侵入 cc_core**：所有企业级能力通过 cc_core 原生扩展点实现，不修改 cc_core 代码
- **进程内集成**：cc_ee 与 cc_core 打包在同一进程，通过 `query()` API 直接调用
- **应用层隔离**：单进程多 session，通过 `runWithCwdOverride` + HookCallback 实现租户隔离

## 快速了解

```
Web UI → API Gateway → cc_ee Service（含 cc_core）
                              │
                    ┌─────────┴──────────────────────┐
                    │  进程启动时                      │
                    │  registerHookCallbacks()         │  ← 注册全局 HookCallback
                    │                                  │
                    │  每次 session 请求时              │
                    │  switchSession(sessionId)        │  ← 切换 session（串行）
                    │  runWithCwdOverride(             │
                    │    tenantCwd,                    │  ← per-tenant cwd 隔离
                    │    () => query(params)           │  ← cc_core 核心调用
                    │  )                               │
                    └──────────────────────────────────┘
```

## 与历史设计文档的关系

`docs/superpowers/specs/` 下的文档是设计演进历史：

- `2026-04-06-enterprise-agent-platform-design.md` — v1 设计（每 session 一进程，HTTP hooks）
- `2026-04-06-enterprise-agent-platform-tech-design.md` — v2 设计（单进程多 session，function hooks）
- `2026-04-07-technical-details-verification.md` — **源码验证报告**，发现多处设计假设需修正

本目录下的文档是**经过源码验证后的最终方案（v3）**，已修正验证报告中发现的所有问题：

| 修正点 | v2 假设 | v3 实际 |
|--------|---------|---------|
| Hook 注册方式 | managed-settings function hooks | `registerHookCallbacks()` HookCallback |
| 动态错误消息 | FunctionHook 不支持 | HookCallback `reason` 字段 ✓ |
| per-session cwd | 未明确 | `runWithCwdOverride()` AsyncLocalStorage ✓ |
| token usage 来源 | PostToolUse hook | `AssistantMessage.usage`（generator）✓ |
| token 计数方式 | SELECT FOR UPDATE | 原子 UPDATE，乐观读 ✓ |
| server 模式 | 依赖（实为 stub）| 直接调用 `query()` API ✓ |
