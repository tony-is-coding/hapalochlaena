# 完整会话流程 - 详细实现

[← 返回总览](README.md) | 下游: [02-QueryEngine 核心循环](02-query-engine.md)

## 概览

本模块展示从用户启动 `claude` 命令到会话结束的完整生命周期。Claude Code 采用"轻量入口分流 → 主启动器编排 → 分阶段初始化 → 能力装配 → REPL 交互"的启动模式，支持 REPL/Headless/MCP Server/Bridge 等多种运行形态。

## 完整执行流程

```
┌──────────────────────────────────────────────────────────────────────┐
│ 【重点】cli.tsx main() [src/entrypoints/cli.tsx]                     │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  步骤1: 解析命令行参数                                                │
│    │  const argv = parseArgs(process.argv)                           │
│    │                                                                 │
│  步骤2: 快路径分流 — 命中则执行并退出，不加载完整应用                    │
│    │                                                                 │
│    ├─ --version → console.log(version) → process.exit(0)            │
│    │                                                                 │
│    ├─ --dump-system-prompt → dumpSystemPrompt() → exit              │
│    │                                                                 │
│    ├─ remote-control → runRemoteControl(argv) → exit                │
│    │                                                                 │
│    ├─ daemon / bg / runner → runDaemonOrBackground(argv) → exit     │
│    │                                                                 │
│    └─ 兜底: 动态 import('./main.tsx').then(m => m.main(argv))        │
│       设计要点: 见 [1]                                                │
│                                                                      │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 【重点】main() [src/main.tsx]                                        │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  步骤1: 早期初始化（不依赖 trust）                                     │
│    │  await init(argv)                                               │
│    │    ├─ applySafeEnvironmentVariables()   // 只应用安全 env var    │
│    │    ├─ initializeCertificates()          // 证书与 HTTPS 代理     │
│    │    ├─ initializeHttpAgent()             // HTTP agent 配置      │
│    │    └─ initTelemetrySkeleton()           // 注册 sink，不发事件   │
│    │  设计要点: 见 [2]                                                │
│    │                                                                 │
│  步骤2: 解析运行参数                                                  │
│    │  permissionMode = initialPermissionModeFromCLI(argv)            │
│    │  model = resolveModel(argv)                                     │
│    │                                                                 │
│  步骤3: 运行形态分支                                                  │
│    │                                                                 │
│    ├─ --print / --sdk → runHeadless()                                │
│    ├─ bridge → runBridge()                                           │
│    ├─ remote → runRemote()                                           │
│    └─ 默认 → 继续完整初始化                                           │
│                                                                      │
│  步骤4: 完整运行时初始化                                               │
│    │                                                                 │
│    ├─ setup(argv, permissionContext)                                  │
│    │    ├─ setCwd(resolvedWorkingDir)                                │
│    │    ├─ startHooksWatcher()                                       │
│    │    ├─ initWorktreeSnapshot()                                    │
│    │    ├─ initSessionMemory()                                       │
│    │    └─ startTeamMemoryWatcher()                                  │
│    │                                                                 │
│    ├─ fetchBootstrapData()          // 拉取远端配置                    │
│    ├─ initializeTelemetryAfterTrust()  // trust 后启动 telemetry     │
│    └─ settingsChangeDetector.start()   // 监听配置热更新              │
│                                                                      │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 【重点】能力装配 [src/main.tsx + src/tools.ts]                        │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  五大能力并行装配:                                                     │
│    │                                                                 │
│    ├─ getCommands(options)                                           │
│    │   ├─ 内建命令: compact, config, doctor, help ...                │
│    │   ├─ Feature Flag 条件命令: voice, buddy ...                    │
│    │   └─ 内部专属命令: bughunter, commit, teleport ...              │
│    │   [src/commands.ts]                                             │
│    │                                                                 │
│    ├─ getTools(permissionContext)                                     │
│    │   ├─ 基础工具: BashTool, FileEditTool, FileReadTool ...         │
│    │   ├─ 条件工具: LSPTool, WorktreeTool, ToolSearchTool ...        │
│    │   └─ 通过 buildTool() 构造，默认 Fail-Closed                    │
│    │   [src/tools.ts:193]                                            │
│    │                                                                 │
│    ├─ getMcpToolsCommandsAndResources()                              │
│    │   ├─ 连接所有配置的 MCP Server                                   │
│    │   ├─ 发现并注册 MCP 工具                                         │
│    │   └─ 通过 assembleToolPool() 与内建工具融合                      │
│    │   [src/services/mcp/client.ts]                                  │
│    │                                                                 │
│    ├─ initBundledSkills()                                            │
│    │   └─ 加载内建打包技能                                            │
│    │   [src/skills/bundled/index.ts]                                 │
│    │                                                                 │
│    └─ getAgentDefinitionsWithOverrides()                             │
│        ├─ 扫描 .claude/agents/ 目录                                  │
│        ├─ 解析 JSON / Markdown agent 定义                            │
│        └─ 检查 Agent Memory Snapshot 状态                            │
│        [src/tools/AgentTool/loadAgentsDir.ts]                        │
│                                                                      │
│  工具池融合: assembleToolPool() [src/tools.ts:345]                    │
│    ├─ builtInTools 排序                                              │
│    ├─ mcpTools 过滤 + 排序                                           │
│    └─ uniqBy 合并（内建优先，防止同名 MCP 工具覆盖）                    │
│    设计要点: 见 [3]                                                   │
│                                                                      │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ launchRepl() [src/replLauncher.tsx]                                   │
│ → 动态加载 App + REPL 组件 → 启动 Ink 渲染循环                        │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 【重点】REPL.tsx 交互循环 [src/screens/REPL.tsx]                      │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  AppState 是系统共享状态总线:                                          │
│    │  messages, toolPermissionContext, mainLoopModel,                 │
│    │  mcpClients, plugins, agentRegistry, notifications,             │
│    │  remoteBridgeState ... (约 20+ 字段)                             │
│    │  [src/state/AppStateStore.ts]                                   │
│    │                                                                 │
│  用户输入处理:                                                        │
│    │                                                                 │
│    ├─ / 开头 → slash command 分发                                    │
│    │   ├─ /compact → 手动压缩                                        │
│    │   ├─ /resume → 恢复旧会话 (详见 06-persistence.md)              │
│    │   ├─ /<skill> → 技能调用 (详见 07-skill-system.md)              │
│    │   └─ 其他内建命令                                                │
│    │                                                                 │
│    └─ 普通文本 → 进入 query() 主循环                                  │
│       → 详见 [02-QueryEngine 核心循环](02-query-engine.md)            │
│                                                                      │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 会话结束与清理                                                        │
│ → reAppendSessionMetadata()  // metadata 重挂到 transcript 尾部      │
│ → transcript 最终落盘                                                 │
│ → MCP 连接关闭                                                       │
│ → hooks watcher 停止                                                 │
│ → process.exit()                                                     │
└──────────────────────────────────────────────────────────────────────┘
```

## 运行形态分支

```
                        main.tsx
                           │
              ┌────────────┼────────────┬──────────────┐
              │            │            │              │
              ▼            ▼            ▼              ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ 默认     │ │ Headless │ │ MCP      │ │ Bridge/  │
        │ REPL/TUI │ │ SDK      │ │ Server   │ │ Remote   │
        ├──────────┤ ├──────────┤ ├──────────┤ ├──────────┤
        │ Ink 渲染 │ │ 无 UI    │ │ 对外暴露 │ │ WebSocket│
        │ React    │ │ 纯引擎   │ │ 内部工具 │ │ 连接远端 │
        │ 组件树   │ │ 流式事件 │ │ 为 MCP   │ │ 编排器   │
        │          │ │          │ │ tool     │ │          │
        │ REPL.tsx │ │ Query-   │ │ mcp.ts   │ │ bridge-  │
        │          │ │ Engine   │ │          │ │ Main.ts  │
        └──────────┘ └──────────┘ └──────────┘ └──────────┘
              │            │            │              │
              └────────────┴────────────┴──────────────┘
                           │
                    共用 query.ts 执行内核
```

## 深度技术分析

### [1] 为什么 cli.tsx 要做"快路径分流"

cli.tsx 是"入口分流器"而非完整应用。设计目的：

- `--version`、`--dump-system-prompt` 等命令不需要加载 React/Ink/MCP 等重量级依赖
- 通过动态 `import('./main.tsx')` 实现延迟加载，快路径启动速度极快且副作用少
- daemon/bg/runner 等后台模式有独立的生命周期管理，不应进入 REPL

这是一种经典的**入口层薄、核心层厚**的设计模式。CLI 工具的启动延迟直接影响用户体验，把不需要完整运行时的命令提前拦截，是非常务实的工程选择。

### [2] init.ts 与 setup.ts 的 Trust 分界线

初始化被刻意分成两个阶段：

- `init.ts`（trust 前）：只应用安全的环境变量、证书、HTTP agent、telemetry 骨架
- `setup.ts`（trust 后）：设置工作目录、hooks、worktree、session memory、team memory

**为什么要分**：trust 建立前，配置文件和 includes 本身可能是攻击面。如果在 trust 前就应用全部环境变量，恶意的 `.claude/settings.json` 可能注入危险配置。所以 `initializeTelemetryAfterTrust()` 必须在 trust 通过后才由 main.tsx 调用。

这体现了**安全边界前移**的设计原则：不是在功能层面做安全检查，而是在初始化阶段就划定信任边界。

### [3] 工具池融合的安全设计

`assembleToolPool()` 的融合策略：

```typescript
return uniqBy(
  [...builtInTools].sort(byName).concat(allowedMcpTools.sort(byName)),
  'name',
)
```

内建工具放在数组前面，`uniqBy` 保留第一个出现的同名工具。这意味着：

- 即便外部 MCP Server 注册了与 `BashTool` 同名的工具，也会被静默丢弃
- MCP 工具还要经过 `filterToolsByDenyRules()` 过滤
- 这是一种**内建优先、外部受控**的融合策略，防止工具池被外部污染

### [4] AppState 不是 UI 状态

`AppState` 包含约 20+ 字段，远超普通 UI 状态管理：

```typescript
type AppState = {
  messages, toolPermissionContext, mainLoopModel,
  mcpClients, plugins, agentRegistry, notifications,
  remoteBridgeState, teamContext, ...
}
```

它实际上是**系统运行时的共享状态总线**，REPL/query/tools/permissions/agents 都通过它通信。这也是为什么 Claude Code 能在同一个进程里同时运行主会话和多个 teammate——它们共享同一个 AppState 但通过不同的 context 隔离。

## 代码索引

- `src/entrypoints/cli.tsx` — 轻量入口，快路径分流器
- `src/main.tsx` — 主启动器，系统编排中心（~80 个 import）
- `src/entrypoints/init.ts` — trust 前逻辑初始化
- `src/setup.ts` — trust 后运行环境初始化
- `src/tools.ts:193` — `getAllBaseTools()` 内建工具总表
- `src/tools.ts:345` — `assembleToolPool()` 工具池融合
- `src/commands.ts` — `getCommands()` 命令系统
- `src/replLauncher.tsx` — `launchRepl()` REPL 启动器
- `src/screens/REPL.tsx` — REPL 主界面，维护 AppState
- `src/state/AppStateStore.ts` — AppState 状态管理
- `src/QueryEngine.ts` — 无 UI 执行引擎（SDK/Headless）
- `src/entrypoints/mcp.ts` — MCP Server 形态入口
- `src/bridge/bridgeMain.ts` — Bridge/Remote 形态入口
