# QueryEngine 核心循环 - 详细实现

上游: [01-完整会话流程](01-full-session.md) | [← 返回总览](README.md) | 下游: [03-工具执行流程](03-tool-execution.md)

## 概览

`query.ts` 是 Claude Code 的心脏——一个 `while(true)` 异步生成器循环。每轮循环：组装上下文 → 调用 Claude API → 处理流式响应 → 提取 tool_use → 执行工具 → 回流 tool_result → 判断是否继续。`QueryEngine.ts` 则是无 UI 的跨轮会话管理器，供 SDK/Headless 使用。

## 完整执行流程

```
┌──────────────────────────────────────────────────────────────────────┐
│ 【重点】query() 主循环 [src/query.ts]                                 │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  函数签名:                                                            │
│    export async function* query(                                     │
│      userMessages: Message[],                                        │
│      systemPrompt: SystemPrompt,                                     │
│      toolUseContext: ToolUseContext,                                  │
│      deps: QueryDeps,                                                │
│    ): AsyncGenerator<StreamEvent>                                    │
│                                                                      │
│  步骤1: 初始化                                                       │
│    │  let messages = userMessages                                    │
│    │  let autoCompactTracking = { consecutiveFailures: 0 }           │
│    │                                                                 │
│  步骤2: while(true) 主循环开始                                        │
│    │                                                                 │
│    │  ┌─────────────────────────────────────────────────────────┐    │
│    │  │ 2a. 消息规范化                                           │    │
│    │  │   apiMessages = normalizeMessagesForAPI(messages)        │    │
│    │  │   ├─ 剔除富文本、本地图片、打点元数据                      │    │
│    │  │   ├─ 提炼为标准 Anthropic API 格式                       │    │
│    │  │   └─ 保留 tool_use / tool_result 的正确配对              │    │
│    │  │   设计要点: 见 [1]                                       │    │
│    │  └─────────────────────────────────────────────────────────┘    │
│    │    │                                                            │
│    │    ▼                                                            │
│    │  ┌─────────────────────────────────────────────────────────┐    │
│    │  │ 2b. 调用 Claude API（流式）                              │    │
│    │  │   for await (const event of                              │    │
│    │  │     deps.claudeApi.stream(apiMessages, systemPrompt))    │    │
│    │  │   {                                                      │    │
│    │  │     yield event  // 实时 yield 给 UI/调用方              │    │
│    │  │   }                                                      │    │
│    │  │   设计要点: 见 [2]                                       │    │
│    │  └─────────────────────────────────────────────────────────┘    │
│    │    │                                                            │
│    │    ▼                                                            │
│    │  ┌─────────────────────────────────────────────────────────┐    │
│    │  │ 2c. 提取 tool_use 列表                                   │    │
│    │  │   toolUseBlocks = extractToolUseBlocks(messages)         │    │
│    │  │                                                          │    │
│    │  │   if (toolUseBlocks.length === 0) break                  │    │
│    │  │   // 无工具调用 → 退出循环，输出最终回复                   │    │
│    │  │   设计要点: 见 [3]                                       │    │
│    │  └─────────────────────────────────────────────────────────┘    │
│    │    │ 有 tool_use                                                │
│    │    ▼                                                            │
│    │  ┌─────────────────────────────────────────────────────────┐    │
│    │  │ 【重点】2d. 执行工具                                      │    │
│    │  │                                                          │    │
│    │  │   for await (const update of                             │    │
│    │  │     runTools(toolUseBlocks, assistantMessages,            │    │
│    │  │              canUseTool, toolUseContext))                 │    │
│    │  │   {                                                      │    │
│    │  │     yield update          // 实时 yield 进度给 UI        │    │
│    │  │     toolResults.push(update.message)                     │    │
│    │  │   }                                                      │    │
│    │  │                                                          │    │
│    │  │   runTools() 内部:                                       │    │
│    │  │     ├─ partitionToolCalls() 按并发安全性分批              │    │
│    │  │     ├─ 并发安全 → Promise.all 并行执行                   │    │
│    │  │     └─ 非安全 → 串行逐个执行                             │    │
│    │  │   → 详见 [03-工具执行流程](03-tool-execution.md)         │    │
│    │  └─────────────────────────────────────────────────────────┘    │
│    │    │                                                            │
│    │    ▼                                                            │
│    │  ┌─────────────────────────────────────────────────────────┐    │
│    │  │ 2e. 结果回流                                             │    │
│    │  │   messages = [...messages, ...toolResults]               │    │
│    │  │   // tool_result 追加到消息序列，下一轮 API 调用带回      │    │
│    │  └─────────────────────────────────────────────────────────┘    │
│    │    │                                                            │
│    │    ▼                                                            │
│    │  ┌─────────────────────────────────────────────────────────┐    │
│    │  │ 2f. Post-Sampling 处理                                   │    │
│    │  │                                                          │    │
│    │  │   // Hooks 执行                                          │    │
│    │  │   await executePostSamplingHooks(messages, toolUseCtx)   │    │
│    │  │                                                          │    │
│    │  │   // Auto-Compact 检查                                   │    │
│    │  │   if (shouldAutoCompact(messages, model))                │    │
│    │  │     await compactConversation(messages, ...)             │    │
│    │  │   → 详见 [04-上下文管理](04-context-mgmt.md)             │    │
│    │  │                                                          │    │
│    │  │   // Session Memory 检查                                 │    │
│    │  │   if (shouldExtractMemory(messages))                     │    │
│    │  │     registerPostSamplingHook → runForkedAgent()          │    │
│    │  │   → 详见 [06-持久化与恢复](06-persistence.md)            │    │
│    │  └─────────────────────────────────────────────────────────┘    │
│    │    │                                                            │
│    │    └─→ 回到 while(true) 顶部，进入下一轮 ──────────────────┐   │
│    │                                                             │   │
│    └─────────────────────────────────────────────────────────────┘   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## while(true) 退出条件

```
while(true) 循环
    │
    ├─ 正常退出: 模型输出不含 tool_use → break
    │   └─ 模型认为任务完成，直接输出文本回复
    │
    ├─ 中断退出: abortController.signal 触发
    │   └─ 用户按 Ctrl+C / ESC / 超时
    │
    ├─ 异常退出: API 调用失败 / 网络错误
    │   └─ 错误被捕获并 yield 给调用方
    │
    └─ 特殊退出: tool 返回 shouldDefer = true
        └─ AskUserQuestionTool 等需要用户交互的工具
           会暂停循环等待用户输入
```

## tool_use / tool_result 回流机制

```
┌──────────────────────────────────────────────────────────────────────┐
│ 回流机制: Transcript 是唯一交互真理                                    │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  第 N 轮:                                                            │
│    messages = [user₁, asst₁, user₂, asst₂(tool_use), tool_result₂] │
│                                                                      │
│  API 调用:                                                           │
│    normalizeMessagesForAPI(messages)                                  │
│    ├─ 剔除 UI 专属字段 (progress, renderData, ...)                   │
│    ├─ 保留 role: user/assistant 交替                                 │
│    ├─ tool_result 作为 user role message 发送                        │
│    └─ 确保 tool_use.id 与 tool_result.tool_use_id 配对              │
│                                                                      │
│  模型看到:                                                            │
│    [system prompt]                                                    │
│    [user context / CLAUDE.md / memory]                               │
│    [user₁] [asst₁] [user₂] [asst₂(tool_use)] [tool_result₂]       │
│                                                                      │
│  模型输出:                                                            │
│    asst₃ → 可能包含新的 tool_use 或最终文本回复                       │
│                                                                      │
│  第 N+1 轮:                                                          │
│    messages = [...messages, asst₃, tool_result₃]                     │
│    → 继续循环                                                        │
│                                                                      │
│  面向 UI:                                                             │
│    每个 tool_result 实时 yield 给 REPL 渲染                           │
│    用户看到 progress / result / reject / error                       │
│                                                                      │
│  面向持久化:                                                          │
│    每条消息 append 到 transcript JSONL                                │
│    → 详见 [06-持久化与恢复](06-persistence.md)                       │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## QueryEngine: 无 UI 的跨轮管理器

```
┌──────────────────────────────────────────────────────────────────────┐
│ QueryEngine [src/QueryEngine.ts]                                     │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  职责: 管理跨多轮的会话状态，供 SDK/Headless 使用                      │
│                                                                      │
│  class QueryEngine {                                                 │
│    │                                                                 │
│    ├─ 维护 messages 历史                                             │
│    ├─ 维护 system prompt 和 tool context                             │
│    ├─ 维护 session 状态                                              │
│    │                                                                 │
│    └─ async *query(userInput): AsyncGenerator<StreamEvent>           │
│        ├─ 组装 messages + system prompt                              │
│        ├─ 调用 query.ts 的 query() 函数                              │
│        ├─ 处理 tool_use / tool_result                                │
│        └─ yield 事件给调用方                                         │
│  }                                                                   │
│                                                                      │
│  与 REPL 的关系:                                                     │
│    REPL.tsx ──→ query()     // 直接调用 query 函数                   │
│    SDK      ──→ QueryEngine ──→ query()  // 通过 Engine 间接调用     │
│                                                                      │
│  设计意图:                                                            │
│    query.ts 管单次循环，QueryEngine 管跨轮状态                        │
│    两者解耦让同一个执行内核服务不同的上层入口                           │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## 流式响应处理

```
┌──────────────────────────────────────────────────────────────────────┐
│ 流式响应状态机                                                        │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Claude API 返回 SSE 事件流:                                         │
│                                                                      │
│  message_start ──→ content_block_start ──→ content_block_delta       │
│       │                    │                      │                  │
│       │                    │                      ├─ text delta      │
│       │                    │                      ├─ tool_use delta  │
│       │                    │                      └─ thinking delta  │
│       │                    │                                         │
│       │                    └──→ content_block_stop                   │
│       │                                                              │
│       └──→ message_delta ──→ message_stop                            │
│                                                                      │
│  StreamingToolExecutor [src/services/tools/StreamingToolExecutor.ts]  │
│    ├─ 不等 assistant 完整接收完才启动工具                              │
│    ├─ 并发安全工具一旦 Zod schema 解析通过，立刻 Launch                │
│    ├─ 状态流转: queued → executing → completed → yielded             │
│    └─ 某工具抛错可中断未完兄弟节点                                    │
│    → 详见 [03-工具执行流程](03-tool-execution.md)                    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## 深度技术分析

### [1] normalizeMessagesForAPI() — 从混合队列到标准 API 格式

`normalizeMessagesForAPI()` 是 query 循环中最关键的清理器。它解决的核心问题是：内部消息队列包含大量 UI 专属数据（progress、renderData、本地图片路径、打点元数据），但 Anthropic API 只接受标准格式。

清理规则包括：
- 剔除 `progress` 类型消息（它们不是 transcript 的一部分）
- 将富文本 attachment 转换为标准 content block
- 确保 `user` / `assistant` 角色严格交替
- 确保每个 `tool_use` 都有对应的 `tool_result`
- 截断过长的 tool_result 内容

这个函数的存在说明：内部消息模型比 API 消息模型丰富得多，query 循环在两者之间做了一层适配。

### [2] 流式响应的 AsyncGenerator 设计

`query()` 本身是 `AsyncGenerator<StreamEvent>`，这意味着：

- 调用方（REPL 或 SDK）通过 `for await` 消费事件
- 每个 API 事件、工具进度、工具结果都被 yield 出去
- 调用方可以随时通过 `abortController` 中断
- 背压自然由 generator 协议处理

这种设计让 query 循环对上层完全透明——REPL 可以实时渲染，SDK 可以流式转发，测试可以收集所有事件。

### [3] while(true) 的退出条件设计

循环的退出不是靠计数器或超时，而是靠**语义判断**：

- 模型输出不含 `tool_use` → 模型认为任务完成 → `break`
- 这意味着循环次数完全由模型决定
- 理论上可以无限循环（模型持续调用工具）

为了防止失控，系统有几层保护：
- `abortController` 允许用户随时中断
- Auto-Compact 在上下文接近满时自动压缩
- 熔断器在连续 compact 失败 3 次后停止
- `max_tokens` 限制单次输出长度

### [4] Post-Sampling 处理的时机选择

Post-sampling hooks、auto-compact、session memory 提取都在工具执行完成后、下一轮 API 调用前执行。这个时机很关键：

- 工具结果已经回流到 messages，上下文是完整的
- 还没发起新的 API 调用，不会浪费 token
- Session Memory 的 `shouldExtractMemory()` 会寻找"自然断点"（`!hasToolCallsInLastTurn`），避免在 tool_use 链中间截断

## 代码索引

- `src/query.ts` — `query()` 主循环，AsyncGenerator 设计
- `src/QueryEngine.ts` — 无 UI 跨轮会话管理器
- `src/services/api/claude.ts` — Claude API 调用层
- `src/services/tools/toolOrchestration.ts` — `runTools()` 工具调度
- `src/services/tools/StreamingToolExecutor.ts` — 流式工具执行器
- `src/services/compact/autoCompact.ts` — Auto-Compact 触发逻辑
- `src/services/SessionMemory/sessionMemory.ts` — Session Memory 提取判断
