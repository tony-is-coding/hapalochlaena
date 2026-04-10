# 工具执行流程 - 详细实现

上游: [02-QueryEngine 核心循环](02-query-engine.md) | [← 返回总览](README.md) | 下游: [04-上下文管理](04-context-mgmt.md)

## 概览

工具执行是 Claude Code Agent 能力的核心。从模型输出 `tool_use` 到生成 `tool_result` 回流，经历了多层 Runtime Pipeline：Tool 抽象协议 → 工具池组装 → 并发/串行调度 → Schema 校验 → 权限检查 → Hooks → 执行 → 结果规范化。这不是"模型直接调函数"，而是一套严谨的执行引擎。

## 完整执行流程

```
┌──────────────────────────────────────────────────────────────────────┐
│ 模型输出 assistant message，含一个或多个 tool_use blocks              │
│ query.ts 收集 tool_use → 选择 runTools() 或 StreamingToolExecutor   │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 【重点】runTools() [src/services/tools/toolOrchestration.ts]         │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  步骤1: partitionToolCalls() 按并发安全性分批                          │
│    │                                                                 │
│    │  遍历 tool_use 列表:                                            │
│    │    for (const toolUse of toolUseMessages) {                     │
│    │      tool = findToolByName(ctx.tools, toolUse.name)             │
│    │      isSafe = tool?.isConcurrencySafe(parsedInput.data)         │
│    │                                                                 │
│    │      if (isSafe && 上一批也是并发安全)                           │
│    │        → 合入同一批次                                           │
│    │      else                                                       │
│    │        → 新建批次                                               │
│    │    }                                                            │
│    │                                                                 │
│    │  示例: [Read, Read, Write, Read]                                │
│    │    → 批次1: [Read, Read]  并发                                  │
│    │    → 批次2: [Write]       串行                                  │
│    │    → 批次3: [Read]        独占                                  │
│    │                                                                 │
│    │  设计要点: 见 [1]                                                │
│    │                                                                 │
│  步骤2: 按批次执行                                                    │
│    │                                                                 │
│    │  for (const batch of batches) {                                 │
│    │    if (batch.isConcurrencySafe) {                                │
│    │      → runToolsConcurrently(batch.blocks, ...)                  │
│    │      → contextModifier 延迟收集，批次完后按序应用               │
│    │    } else {                                                     │
│    │      → runToolsSerially(batch.blocks, ...)                      │
│    │      → 每个工具等上一个完成                                     │
│    │    }                                                            │
│    │  }                                                              │
│    │                                                                 │
│    │  设计要点: 见 [2]                                                │
│    │                                                                 │
└──────────────────────────────┬───────────────────────────────────────┘
                               │ 对每个 tool_use
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 【重点】runToolUse() [src/services/tools/toolExecution.ts]           │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  步骤1: Zod Schema 校验                                              │
│    │  result = tool.inputSchema.safeParse(toolUse.input)             │
│    │  if (!result.success)                                           │
│    │    → 把错误栈返回给模型，让模型纠正重试                          │
│    │    → 不退出系统                                                 │
│    │                                                                 │
│  步骤2: 语义校验 validateInput()                                     │
│    │  即使 Schema 通过，还要确保语义正确:                              │
│    │    ├─ 新旧字符串是否相等（FileEdit）                             │
│    │    ├─ 是否碰到黑名单目录                                        │
│    │    └─ 其他工具特定的语义约束                                     │
│    │                                                                 │
│  步骤3: Backfill 隐式派生依赖                                        │
│    │  backfillObservableInput()                                      │
│    │    └─ 注入 expandPath() 等钩子，供安全审计使用                   │
│    │                                                                 │
│  步骤4: PreToolUse Hooks                                             │
│    │  for await (const result of runPreToolUseHooks(                  │
│    │    tool, toolUseID, input, ...                                   │
│    │  )) {                                                           │
│    │    // 按顺序触发前置拦截校验                                     │
│    │    // 可能直接修改 input 结构                                    │
│    │    // 可能返回 stop → 拦截执行                                   │
│    │  }                                                              │
│    │  [src/services/tools/toolHooks.ts:435]                          │
│    │                                                                 │
│  步骤5: 权限检查 checkPermissions()                                  │
│    │  result = await tool.checkPermissions(input, ctx)                │
│    │                                                                 │
│    │  三种行为:                                                      │
│    │    ├─ allow → 继续执行                                          │
│    │    ├─ deny  → 返回拒绝消息给模型                                │
│    │    └─ ask   → 弹出权限确认框，等待用户决策                       │
│    │                                                                 │
│    │  设计要点: 见 [3]                                                │
│    │                                                                 │
│  步骤6: 执行 tool.call()                                             │
│    │  try {                                                          │
│    │    result = await tool.call(                                     │
│    │      callInput, enrichedToolUseContext,                          │
│    │      canUseTool, assistantMessage, onProgress                   │
│    │    )                                                            │
│    │    processToolResultBlock(result)                                │
│    │  } catch (error) {                                              │
│    │    yield generateErrorResult(error, toolUse.id)                 │
│    │    // 异常标准化包装，返回 tool_use_error 给模型                 │
│    │  }                                                              │
│    │                                                                 │
│  步骤7: 生成 tool_result                                             │
│    │  mapToolResultToToolResultBlockParam(result)                     │
│    │  → 规范化为 user-side tool_result message                       │
│    │  → 回流到 query 主循环的 messages 序列                          │
│    │                                                                 │
└──────────────────────────────────────────────────────────────────────┘
```

## Tool 抽象协议

```
┌──────────────────────────────────────────────────────────────────────┐
│ 【重点】Tool 接口 [src/Tool.ts:362]                                  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Tool 不是简单的"函数映射"，而是标准化的运行时协议对象:               │
│                                                                      │
│  ┌─ 能力描述 ─────────────────────────────────────────────────┐     │
│  │  name, description(), prompt(), searchHint, aliases        │     │
│  └────────────────────────────────────────────────────────────┘     │
│  ┌─ 输入输出 ─────────────────────────────────────────────────┐     │
│  │  inputSchema (Zod), outputSchema                           │     │
│  │  mapToolResultToToolResultBlockParam()                     │     │
│  └────────────────────────────────────────────────────────────┘     │
│  ┌─ 安全属性 ─────────────────────────────────────────────────┐     │
│  │  isConcurrencySafe()   → 是否可并发执行                    │     │
│  │  isReadOnly()          → 是否只读                          │     │
│  │  isDestructive()       → 是否有破坏性                      │     │
│  │  checkPermissions()    → 权限检查                          │     │
│  └────────────────────────────────────────────────────────────┘     │
│  ┌─ 语义校验 ─────────────────────────────────────────────────┐     │
│  │  validateInput()       → Schema 之外的语义约束             │     │
│  └────────────────────────────────────────────────────────────┘     │
│  ┌─ UI 表现 ──────────────────────────────────────────────────┐     │
│  │  renderToolUseMessage(), renderToolResultMessage()          │     │
│  │  renderToolUseRejectedMessage(), renderToolUseErrorMessage()│     │
│  └────────────────────────────────────────────────────────────┘     │
│  ┌─ 运行控制 ─────────────────────────────────────────────────┐     │
│  │  interruptBehavior()          → 中断时的补偿策略           │     │
│  │  requiresUserInteraction()    → 是否需要用户交互           │     │
│  │  backfillObservableInput()    → 隐式依赖注入               │     │
│  └────────────────────────────────────────────────────────────┘     │
│  ┌─ 核心方法 ─────────────────────────────────────────────────┐     │
│  │  call(args, context, canUseTool, parentMessage, onProgress)│     │
│  │    → Promise<ToolResult<Output>>                           │     │
│  └────────────────────────────────────────────────────────────┘     │
│                                                                      │
│  设计要点: 见 [4]                                                    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 【重点】buildTool() 默认值策略 [src/Tool.ts:757]                     │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  const TOOL_DEFAULTS = {                                             │
│    isEnabled:          () => true,                                   │
│    isConcurrencySafe:  () => false,    // 默认不可并发               │
│    isReadOnly:         () => false,    // 默认非只读                 │
│    isDestructive:      () => false,    // 默认非破坏性               │
│    checkPermissions:   () => ({ behavior: 'allow' }),                │
│    toAutoClassifierInput: () => '',    // 安全分类器默认短路         │
│  }                                                                   │
│                                                                      │
│  export function buildTool(def) {                                    │
│    return { ...TOOL_DEFAULTS, userFacingName: () => def.name, ...def }│
│  }                                                                   │
│                                                                      │
│  Fail-Closed 原则:                                                   │
│    新工具默认被假定为"有风险的、不可并发的"                            │
│    除非开发者显式声明安全属性                                         │
│                                                                      │
│  设计要点: 见 [5]                                                    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## 工具池组装

```
┌──────────────────────────────────────────────────────────────────────┐
│ 工具池组装流程 [src/tools.ts]                                         │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  getAllBaseTools() [src/tools.ts:193]                                 │
│    │  ├─ 始终存在: BashTool, FileEditTool, FileReadTool, ...         │
│    │  ├─ 条件启用: LSPTool (ENABLE_LSP_TOOL)                        │
│    │  │            WorktreeTool (isWorktreeModeEnabled)              │
│    │  │            ToolSearchTool (isToolSearchEnabled)              │
│    │  └─ 内部专属: ConfigTool (USER_TYPE === 'ant')                  │
│    │                                                                 │
│    ▼                                                                 │
│  getTools(permissionContext)                                          │
│    │  └─ 过滤 isEnabled() + 应用 permission context                  │
│    │                                                                 │
│    ▼                                                                 │
│  assembleToolPool(permissionContext, mcpTools) [src/tools.ts:345]     │
│    │  builtInTools = getTools(permissionContext)                      │
│    │  allowedMcpTools = filterToolsByDenyRules(mcpTools)              │
│    │                                                                 │
│    │  return uniqBy(                                                 │
│    │    [...builtInTools].sort(byName)                                │
│    │      .concat(allowedMcpTools.sort(byName)),                     │
│    │    'name'                                                       │
│    │  )                                                              │
│    │                                                                 │
│    │  内建优先 + MCP 受控融合                                        │
│    │  同名冲突时内建工具胜出                                         │
│    │                                                                 │
│    ▼                                                                 │
│  最终工具池: 统一的 Tool[] 数组                                       │
│  模型无需区分工具来源（内建 vs MCP）                                  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## 具体案例: AskUserQuestionTool

```
┌──────────────────────────────────────────────────────────────────────┐
│ AskUserQuestionTool [src/tools/AskUserQuestionTool.tsx]               │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  配置:                                                               │
│    shouldDefer = true                                                │
│    requiresUserInteraction = true                                    │
│    isReadOnly = true                                                 │
│                                                                      │
│  揭示: Tool 不一定是后端机器操作！                                    │
│    模型通过调用 Tool API 向用户屏幕发送提问表单                       │
│    返回值就是用户在界面上敲下的字                                     │
│    Tool 调用链路本质是"双边交互抽象隧道"                              │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## 深度技术分析

### [1] partitionToolCalls() — 并发不是默认开启的

并发调度的核心逻辑：遍历 tool_use 列表，根据每个工具的 `isConcurrencySafe()` 声明分批。连续的并发安全工具合入同一批次，遇到非安全工具则切断并独立成批。

这种设计的关键在于**保序**：即使并发执行，批次之间的顺序仍然严格保持。模型输出 `[A(Read), B(Read), C(Write), D(Read)]` 时，A/B 可以并发，但 C 必须等 A/B 完成，D 必须等 C 完成。

### [2] contextModifier 的延迟应用

并发批次中，工具返回的 `contextModifier`（上下文修改回调）不会立即应用，而是被收集起来，在批次全部完成后按序应用。

这解决了一个微妙的竞态问题：如果两个并发 Read 工具同时修改 `toolUseContext` 中的文件缓存，可能产生读写覆盖。延迟应用确保了即使并发执行，上下文修改仍然是确定性的。

### [3] 权限系统的三种行为

权限检查的结果不是简单的 true/false，而是三种行为：

| 行为 | 含义 | 后续动作 |
|------|------|----------|
| `allow` | 允许执行 | 继续到 `tool.call()` |
| `deny` | 拒绝执行 | 返回拒绝消息给模型，模型可能换一种方式重试 |
| `ask` | 需要用户确认 | 弹出权限确认框，等待用户点击允许/拒绝 |

`ask` 行为是 Claude Code 交互体验的核心——用户可以逐个审批工具调用，也可以通过 permission rules 批量允许。这种设计让用户始终保持对 Agent 行为的控制权。

PreToolUse Hooks 在权限检查之前执行，可以：
- 修改工具输入（如路径展开）
- 直接拦截执行（返回 stop）
- 注入额外的上下文信息

### [4] Tool 接口为什么这么"重"

Tool 接口包含约 20 个方法/属性，远超一般的"工具函数"定义。这是因为它不是函数映射，而是**运行时协议对象**。

每个工具编写者被强制考虑：
- 并发安全性（`isConcurrencySafe`）
- 权限模型（`checkPermissions`）
- 中断补偿（`interruptBehavior`）
- UI 呈现（`renderToolUseMessage` 等 4 个渲染方法）
- 语义校验（`validateInput`）

这种"重接口"设计的好处是：框架层面就能做到统一的并发调度、权限管理、UI 渲染和错误处理，而不需要每个工具自己实现这些横切关注点。

### [5] Fail-Closed 默认值策略

`buildTool()` 的默认值策略体现了系统级保守原则：

- `isConcurrencySafe: false` — 新工具默认不可并发
- `isReadOnly: false` — 新工具默认有写操作风险
- `toAutoClassifierInput: ''` — 安全分类器默认短路拦截

这意味着：如果开发者忘记声明安全属性，工具会被当作"最危险的"来处理。这比"默认允许"安全得多，因为遗漏声明只会导致性能下降（不必要的串行执行），而不会导致安全问题。

### [6] ToolUseContext — 执行时上下文总线

`ToolUseContext` 不是简单的参数包，而是整个系统会话运行时的引用：

- 当前工具池与权限上下文
- AppState 与 MCP clients / resources
- 文件缓存、abortController、当前消息序列
- renderedSystemPrompt（可被 fork/subagent 复用）

这意味着工具执行深度依赖整个系统的会话运行时，而不仅是孤立的传参。这也是为什么工具可以做到"读取其他工具的结果"、"修改后续工具的上下文"等跨工具协作。

## 代码索引

- `src/Tool.ts:362` — `Tool` 类型定义，运行时协议对象
- `src/Tool.ts:757` — `buildTool()` + `TOOL_DEFAULTS`，Fail-Closed 默认值
- `src/tools.ts:193` — `getAllBaseTools()` 内建工具总表
- `src/tools.ts:345` — `assembleToolPool()` 工具池融合
- `src/services/tools/toolOrchestration.ts` — `runTools()` / `partitionToolCalls()` 调度核心
- `src/services/tools/toolExecution.ts` — `runToolUse()` 单工具执行主干
- `src/services/tools/toolHooks.ts:435` — `runPreToolUseHooks()` 前置拦截
- `src/services/tools/StreamingToolExecutor.ts` — 流式工具执行器
- `src/tools/FileEditTool/FileEditTool.ts` — FileEditTool 完整实现案例
- `src/tools/AskUserQuestionTool/AskUserQuestionTool.tsx` — 用户交互工具案例
