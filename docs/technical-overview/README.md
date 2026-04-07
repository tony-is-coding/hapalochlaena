# Claude Code 技术总览文档系统

> 基于 `analysis/` 深度分析，整合为递进式技术总览。通过 ASCII 流程图展示完整执行链路。

## 项目定位

Claude Code 不是命令行聊天工具，而是**面向代码工作流的本地 Agent 平台**。

核心特征：多入口（CLI/REPL/SDK/MCP/Bridge/Remote）、多层次（命令/执行内核/工具/权限/Memory/扩展）、多形态协作（单Agent/SubAgent/Background/Teammate/Swarm）。

## 顶层架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Claude Code 六层架构                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 第1层: CLI 引导层                                                 │  │
│  │ entrypoints/cli.tsx → 快路径分流 OR main.tsx                      │  │
│  └───────────────────────┬───────────────────────────────────────────┘  │
│                          │                                              │
│                          ▼                                              │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 第2层: 初始化 + TUI/REPL 交互层                                   │  │
│  │ init.ts → setup.ts → launchRepl() → App + REPL.tsx               │  │
│  └───────────────────────┬───────────────────────────────────────────┘  │
│                          │                                              │
│                          ▼                                              │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ 第3层: Query/Agent 执行内核                                       │  │
│  │ query.ts (while-true 主循环) ←→ QueryEngine.ts (SDK/Headless)    │  │
│  └──────┬────────────────────┬──────────────────────┬───────────────┘  │
│         │                    │                      │                   │
│         ▼                    ▼                      ▼                   │
│  ┌─────────────┐  ┌──────────────────┐  ┌────────────────────────┐     │
│  │ 第4层:      │  │ 第5层:           │  │ 第6层:                 │     │
│  │ Tool/Perm   │  │ Memory/Persist   │  │ MCP/Plugin/Remote/     │     │
│  │             │  │                  │  │ Swarm 扩展层           │     │
│  │ Tool.ts     │  │ sessionStorage   │  │                        │     │
│  │ toolOrch.   │  │ memdir/          │  │ mcp/client.ts          │     │
│  │ toolExec.   │  │ SessionMemory    │  │ swarm/backends         │     │
│  │ permissions │  │ compact          │  │ bridge/remote          │     │
│  └─────────────┘  └──────────────────┘  └────────────────────────┘     │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## 默认交互主链路

```
用户启动 claude
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│ cli.tsx → 快路径分流(--version/--dump-system-prompt/daemon) │
│ → 兜底进入 main.tsx                                         │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ main.tsx: init() → 能力装配 → launchRepl()                  │
│   ├─ getTools()              内建工具池                      │
│   ├─ getMcpTools()           MCP 工具                       │
│   ├─ initBundledSkills()     技能系统                       │
│   ├─ getAgentDefinitions()   Agent 定义                     │
│   └─ getCommands()           命令系统                       │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ REPL.tsx: 用户输入 → query()                                │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ query.ts: while(true) 主循环                                │
│   1. normalizeMessagesForAPI()                              │
│   2. claude.ts API 流式调用                                  │
│   3. 提取 tool_use → runTools()                             │
│   4. tool_result 回流 → 下一轮                               │
│   5. compact / hooks / session memory                       │
└──────────────────────────┬──────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│ 会话管理: transcript 落盘 → Session Memory → 退出清理        │
└─────────────────────────────────────────────────────────────┘
```

## 模块导航

| # | 模块 | 文件 | 核心问题 |
|---|------|------|----------|
| 1 | [完整会话流程](01-full-session.md) | 01-full-session.md | 从启动到退出的完整生命周期 |
| 2 | [QueryEngine 核心循环](02-query-engine.md) | 02-query-engine.md | 单次查询的 while(true) 主循环 |
| 3 | [工具执行流程](03-tool-execution.md) | 03-tool-execution.md | tool_use → tool_result 完整链路 |
| 4 | [上下文管理](04-context-mgmt.md) | 04-context-mgmt.md | Prompt 组装、Memory 注入、Compact |
| 5 | [多智能体协作](05-multi-agent.md) | 05-multi-agent.md | SubAgent / Coordinator / Swarm |
| 6 | [持久化与恢复](06-persistence.md) | 06-persistence.md | Transcript / Resume / Session Memory |
| 7 | [Skill 系统](07-skill-system.md) | 07-skill-system.md | 技能发现、加载、Shell 执行 |
| 8 | [MCP 集成](08-mcp-integration.md) | 08-mcp-integration.md | 四种传输、工具融合、双向能力 |

## 阅读建议

- **快速了解全貌**：先读本文的顶层架构图，再读 [01-完整会话流程](01-full-session.md)
- **深入执行内核**：[02-QueryEngine](02-query-engine.md) → [03-工具执行](03-tool-execution.md)
- **理解上下文治理**：[04-上下文管理](04-context-mgmt.md) → [06-持久化](06-persistence.md)
- **探索平台能力**：[05-多智能体](05-multi-agent.md) → [07-Skill](07-skill-system.md) → [08-MCP](08-mcp-integration.md)

## 源码基础

本文档基于 `cc_core/src/` 源码分析，所有代码引用格式为 `[file.ts:line]`。
