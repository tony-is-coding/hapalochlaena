# 多智能体协作流程 - 详细实现

上游: [04-上下文管理](04-context-mgmt.md) | [← 返回总览](README.md) | 下游: [06-持久化与恢复](06-persistence.md)

## 概览

Claude Code 的多 Agent 不是"加了个 AgentTool"那么简单，而是三套并存的运行模型：普通 SubAgent、Coordinator 调度器模式、Swarm Teammates 团队协作。它们共用同一套 `query()` 执行内核，但在调度、通信、权限和协作机制上各有不同。

## 完整执行流程

```
┌──────────────────────────────────────────────────────────────────────┐
│ 【重点】AgentTool.call() — 多 Agent 统一入口                         │
│ [src/tools/AgentTool/AgentTool.tsx]                                  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  输入 schema:                                                        │
│    baseInputSchema:                                                  │
│      description, prompt, subagent_type?, model?, run_in_background? │
│    multiAgentInputSchema (扩展):                                     │
│      name?, team_name?, mode?                                        │
│                                                                      │
│  路由判断:                                                            │
│    │                                                                 │
│    ├─ 防御检查:                                                      │
│    │   ├─ isTeammate() && teamName → reject (禁止嵌套 teammate)     │
│    │   └─ isInProcessTeammate() && background → reject              │
│    │                                                                 │
│    ├─ teamName && name ?                                             │
│    │   └─ YES → spawnTeammate() ─────→ Swarm 路径                   │
│    │                                                                 │
│    └─ else                                                           │
│        └─ runAgent() ─────────────→ 普通 SubAgent 路径              │
│                                                                      │
└─────────┬──────────────────────────────────┬─────────────────────────┘
          │                                  │
          ▼                                  ▼
┌─────────────────────────┐    ┌───────────────────────────────────────┐
│ 普通 SubAgent 路径       │    │ Swarm Teammate 路径                   │
│                         │    │                                       │
│ runAgent()              │    │ spawnTeammate()                       │
│ [src/tools/AgentTool/   │    │ [src/tools/shared/                    │
│  runAgent.ts]           │    │  spawnMultiAgent.ts]                  │
│                         │    │                                       │
│ 步骤:                   │    │  ┌──────────┬──────────┐              │
│  1. init agent MCP      │    │  │in-process│ tmux/    │              │
│  2. createSubagentCtx   │    │  │teammate  │ iTerm2   │              │
│  3. execSubagentHooks   │    │  └────┬─────┴────┬─────┘              │
│  4. recordSidechain     │    │       │          │                    │
│  5. query() ←同一内核   │    │       ▼          ▼                    │
│                         │    │  spawnInProc   pane/backend           │
│ 特殊变体: fork          │    │  Teammate()    spawn                  │
│  forkSubagent.ts:       │    │       │                               │
│  ├─ 继承父完整 context  │    │       ▼                               │
│  ├─ 继承父 system prompt│    │  InProcessTeammateTask                │
│  │  (原始字节, 不重建)  │    │  → inProcessRunner                   │
│  └─ 默认后台运行        │    │  → runAgent() → query()              │
│                         │    │                                       │
└─────────────────────────┘    └───────────────────────────────────────┘
```

## 三种多 Agent 模型

```
┌──────────────────────────────────────────────────────────────────────┐
│ 模型1: 普通 SubAgent                                                 │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  主 agent ──AgentTool──→ runAgent() ──→ query()                     │
│                                  │                                   │
│                                  ├─ 继承部分上下文与工具池            │
│                                  ├─ 结果以 tool_result 回传          │
│                                  ├─ 支持同步执行或 run_in_background │
│                                  └─ transcript 写入 sidechain        │
│                                                                      │
│  本质: 主会话的侧链，更像"后台 worker"                               │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 模型2: Coordinator Mode [src/coordinator/coordinatorMode.ts]         │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  isCoordinatorMode() → 环境变量 + Feature Flag 触发                  │
│                                                                      │
│  核心机制: system prompt 重写主线程身份                               │
│    "You are Claude Code, an AI assistant that orchestrates           │
│     software engineering tasks across multiple workers."             │
│                                                                      │
│  主线程不再自己写代码，而是:                                          │
│    ├─ 用 Agent 派出 worker                                          │
│    ├─ 用 SendMessage 继续已有 worker                                 │
│    ├─ 用 TaskStop 停止 worker                                       │
│    └─ 综合 worker 结果，继续派工或汇报                               │
│                                                                      │
│  worker 结果回流格式:                                                 │
│    <task-notification>                                               │
│      <task-id>{agentId}</task-id>                                    │
│      <status>completed|failed|killed</status>                        │
│      <summary>...</summary>                                          │
│      <result>...</result>                                            │
│    </task-notification>                                              │
│                                                                      │
│  显式分相工作流:                                                      │
│    Research (workers) → Synthesis (coordinator)                      │
│    → Implementation (workers) → Verification (workers)              │
│                                                                      │
│  设计要点: 见 [1]                                                    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 【重点】模型3: Swarm Teammates                                       │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  TeamCreateTool [src/tools/TeamCreateTool/TeamCreateTool.ts]         │
│    │                                                                 │
│    ├─ 创建 team file (持久化)                                       │
│    │   teamFile = { name, description, leadAgentId, members[] }     │
│    │   await writeTeamFileAsync(teamName, teamFile)                  │
│    │                                                                 │
│    ├─ 创建共享 task list                                             │
│    │   await resetTaskList(taskListId)                                │
│    │   await ensureTasksDir(taskListId)                              │
│    │                                                                 │
│    └─ 设置 leader context                                            │
│        setLeaderTeamName(teamName)                                   │
│        更新 AppState.teamContext                                     │
│                                                                      │
│  Swarm 三份状态:                                                     │
│    1. team file (.claude/teams/{name}/team.json)                    │
│    2. task list (.claude/teams/{name}/tasks/)                       │
│    3. AppState.teamContext                                           │
│                                                                      │
│  设计要点: 见 [2]                                                    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## in-process Teammate: 同进程多 Agent

```
┌──────────────────────────────────────────────────────────────────────┐
│ 【重点】spawnInProcessTeammate()                                     │
│ [src/utils/swarm/spawnInProcess.ts]                                  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  不是开新进程，而是用 AsyncLocalStorage 隔离上下文:                    │
│                                                                      │
│    agentId = formatAgentId(name, teamName)                           │
│    taskId = generateTaskId('in_process_teammate')                    │
│      │                                                               │
│      ├─ 创建 abortController                                        │
│      ├─ 创建 teammate identity (name, color, role)                   │
│      ├─ 创建 teammateContext                                         │
│      │                                                               │
│      └─ taskState = {                                                │
│           type: 'in_process_teammate',                               │
│           status: 'running',                                         │
│           identity, prompt, model,                                   │
│           abortController,                                           │
│           pendingUserMessages: [],                                   │
│           messages: [],                                              │
│         }                                                            │
│         registerTask(taskState, setAppState)                         │
│                                                                      │
│  teammate 生命周期:                                                   │
│    ├─ appendTeammateMessage()     → 注入新消息                       │
│    ├─ injectUserMessageToTeammate() → 发送指令                       │
│    ├─ findTeammateTaskByAgentId() → 反查 task                       │
│    └─ requestTeammateShutdown()   → 请求停止                        │
│                                                                      │
│  [src/tasks/InProcessTeammateTask/InProcessTeammateTask.tsx]         │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## 通信机制: Mailbox + Direct Resume 双轨制

```
┌──────────────────────────────────────────────────────────────────────┐
│ 【重点】通信双轨制                                                    │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  轨道1: Mailbox 文件通信                                             │
│  [src/utils/teammateMailbox.ts]                                      │
│                                                                      │
│    存储: .claude/teams/{team}/inboxes/{agent}.json                   │
│                                                                      │
│    writeToMailbox(recipientName, message, teamName)                  │
│      ├─ lockfile.lock() (并发安全)                                   │
│      ├─ 读取现有 inbox                                               │
│      ├─ 追加消息                                                     │
│      └─ 写回文件                                                     │
│                                                                      │
│    useInboxPoller() 周期性检查:                                      │
│      readUnreadMessages(agentName, teamName)                         │
│      按消息类型分发:                                                  │
│        ├─ permission request/response                                │
│        ├─ shutdown request/approval                                  │
│        ├─ plan approval request/response                             │
│        └─ regular teammate messages                                  │
│    [src/hooks/useInboxPoller.ts]                                     │
│                                                                      │
│  轨道2: Direct Resume (本地 task/transcript)                         │
│  [src/tools/SendMessageTool/SendMessageTool.ts]                      │
│                                                                      │
│    SendMessageTool 路由逻辑:                                         │
│      ├─ 目标是本地 agentId                                           │
│      │   → queuePendingMessage() 或 resumeAgentBackground()         │
│      ├─ 目标是 teammate                                              │
│      │   → writeToMailbox()                                          │
│      └─ 目标是 '*'                                                   │
│          → broadcast 给所有成员                                      │
│                                                                      │
│  设计要点: 见 [3]                                                    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## 权限机制: Leader 为 Teammate 兜底

```
┌──────────────────────────────────────────────────────────────────────┐
│ 【重点】权限桥接 [src/utils/swarm/leaderPermissionBridge.ts]         │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  teammate 不拥有独立权限 UI                                           │
│                                                                      │
│  createInProcessCanUseTool() [src/utils/swarm/inProcessRunner.ts]    │
│    │                                                                 │
│    ├─ 先检查本地权限规则:                                             │
│    │   result = hasPermissionsToUseTool(toolRequest)                  │
│    │   if (allow/deny) → 直接返回                                    │
│    │                                                                 │
│    ├─ 主路径: leader permission UI bridge                            │
│    │   setToolUseConfirmQueue = getLeaderToolUseConfirmQueue()       │
│    │   if (bridge 可用) {                                            │
│    │     enqueue request → leader ToolUseConfirmQueue                │
│    │     显示 workerBadge (name + color)                             │
│    │     等待 leader 决策 → 返回                                     │
│    │   }                                                             │
│    │                                                                 │
│    └─ 降级路径: mailbox 权限同步                                      │
│        send permission request → leader inbox                        │
│        等待 leader response → 应用到 teammate                        │
│                                                                      │
│  设计意图:                                                            │
│    ├─ 避免多份权限 UI                                                │
│    ├─ 保持用户对整个 swarm 的统一控制                                 │
│    └─ 双轨容灾: bridge 不可用时退回 mailbox                          │
│                                                                      │
│  设计要点: 见 [4]                                                    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## 任务协作: 共享 Task List

```
┌──────────────────────────────────────────────────────────────────────┐
│ Swarm 任务协作 [src/utils/swarm/inProcessRunner.ts]                  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  teammate 主循环:                                                    │
│    while (alive) {                                                   │
│      msg = nextPendingUserMessage() or tryClaimNextTask()            │
│      if (no msg) → idle → wait                                      │
│      else → runAgent(msg) → update progress → notify leader         │
│    }                                                                 │
│                                                                      │
│  tryClaimNextTask():                                                 │
│    tasks = await listTasks(taskListId)                               │
│    available = findAvailableTask(tasks)                              │
│    result = await claimTask(taskListId, available.id, agentName)    │
│    await updateTask(taskListId, available.id, {status:'in_progress'})│
│                                                                      │
│  teammate 工具池强制注入:                                             │
│    agentDefinition.tools 之外，始终包含:                              │
│      SendMessage, TeamCreate, TeamDelete,                            │
│      TaskCreate, TaskGet, TaskList, TaskUpdate                       │
│    → swarm 协作能力是 runtime contract                               │
│                                                                      │
│  TaskStopTool 提供统一 kill switch                                   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## 深度技术分析

### [1] Coordinator Mode — Prompt 层的角色重写

Coordinator 不是一个工具或命令，而是**运行模式**。通过环境变量 `CLAUDE_CODE_COORDINATOR_MODE` 触发后，system prompt 直接把主线程定义为 orchestrator：

```
You are Claude Code, an AI assistant that orchestrates
software engineering tasks across multiple workers.
```

worker 结果不是普通的 assistant 消息，而是结构化的 `<task-notification>` XML。coordinator 必须解析这些通知并做出调度决策。

显式分相工作流是另一个亮点：Research → Synthesis → Implementation → Verification。这不是自由分工，而是工程约束：研究并行、综合集中、实现分派、验证独立。

### [2] Swarm 不是临时内存态

Swarm team 至少有三份持久化状态：
1. **team file** — `.claude/teams/{name}/team.json`
2. **task list** — `.claude/teams/{name}/tasks/`
3. **mailbox** — `.claude/teams/{name}/inboxes/{agent}.json`

这意味着 team 可以跨会话存活（理论上），不是"对话结束就消失"的临时态。team file 包含完整的成员信息（agentId、name、model、agentType），task list 包含任务状态和认领信息。

### [3] SendMessageTool 是消息路由器

`SendMessageTool` 不是简单的"发消息 API"，而是根据目标类型做路由：

| 目标 | 路由 |
|------|------|
| 本地 agentId (running) | `queuePendingMessage()` |
| 本地 agentId (stopped) | `resumeAgentBackground()` |
| teammate name | `writeToMailbox()` |
| `*` | broadcast 给所有成员 |

mailbox 传的不是纯文本，而是结构化的 agent 协作协议消息（permission request/response、shutdown、plan approval 等）。`useInboxPoller()` 周期性检查 unread 消息并按类型分发处理。

### [4] 权限桥接的双轨容灾

in-process teammate 的权限请求走两条路径：

1. **主路径**：通过 `leaderPermissionBridge` 直接把 ask 权限推入 leader 的 `ToolUseConfirmQueue`，UI 上带 `workerBadge` 标识请求来源
2. **降级路径**：bridge 不可用时，通过 mailbox 发送 permission request，等待 leader 异步响应

这种设计避免了多份权限 UI、保持了用户对整个 swarm 的统一控制，同时做了容灾——即使 leader 权限 UI 暂时不可用，teammate 也不会完全卡住。

### [5] Agent 拓扑约束

源码通过显式的防御检查约束 multi-agent 拓扑：

- teammate 不能无限嵌套 teammate（`isTeammate() && teamName → reject`）
- in-process teammate 不能再启动 background agent

这些约束防止 agent graph 失控。没有这些限制，一个 teammate 可能无限产生子 teammate，导致进程资源耗尽。

### [6] fork subagent 的 Prompt Cache 优化

fork child 不重新生成 system prompt，而是直接使用父会话已渲染好的 prompt 字节。这不是为了逻辑正确性，而是为了 **prompt cache 命中稳定性**。重新调用 `getSystemPrompt()` 可能因为时间戳、git status 等动态段变化而产生不同的字节序列，破坏 cache prefix。

## 代码索引

- `src/tools/AgentTool/AgentTool.tsx` — AgentTool，multi-agent 统一入口
- `src/tools/AgentTool/runAgent.ts` — `runAgent()` 实际 agent 执行器
- `src/tools/AgentTool/forkSubagent.ts` — fork 变体，继承父 context
- `src/coordinator/coordinatorMode.ts` — Coordinator 模式，prompt 重写 + 分相工作流
- `src/tools/shared/spawnMultiAgent.ts` — `spawnTeammate()` teammate 生成共享模块
- `src/utils/swarm/spawnInProcess.ts` — `spawnInProcessTeammate()` 同进程 teammate
- `src/utils/swarm/inProcessRunner.ts` — in-process teammate runner + tryClaimNextTask
- `src/tasks/InProcessTeammateTask/InProcessTeammateTask.tsx` — teammate task 生命周期
- `src/utils/teammateMailbox.ts` — Mailbox 文件通信 + lockfile
- `src/hooks/useInboxPoller.ts` — inbox 轮询 + 消息分发
- `src/tools/SendMessageTool/SendMessageTool.ts` — 消息路由器
- `src/tools/TeamCreateTool/TeamCreateTool.ts` — Team 创建 + task list 绑定
- `src/tools/TaskCreateTool/TaskCreateTool.ts` — 任务创建
- `src/tools/TaskStopTool/TaskStopTool.ts` — 统一 kill switch
- `src/utils/swarm/leaderPermissionBridge.ts` — 权限桥接
