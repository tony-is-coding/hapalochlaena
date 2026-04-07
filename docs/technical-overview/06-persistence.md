# 持久化与恢复流程 - 详细实现

上游: [05-多智能体协作](05-multi-agent.md) | [← 返回总览](README.md) | 下游: [07-Skill 系统](07-skill-system.md)

## 概览

Claude Code 的会话不是"内存里聊完就算"。它被实现为一套 append-only JSONL 事件流系统，支持 metadata 尾部重挂、subagent sidechain、远端 ingress 增量同步、以及强健的 resume 恢复流水线。写入层故意做简单，复杂性全部压到恢复路径。

## 完整执行流程

```
┌──────────────────────────────────────────────────────────────────────┐
│ 【重点】存储模型: Append-Only JSONL 事件流                            │
│ [src/utils/sessionStorage.ts]                                        │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  存储路径:                                                            │
│    主 transcript: {projectDir}/{sessionId}.jsonl                     │
│    subagent: {projectDir}/{sessionId}/subagents/agent-{id}.jsonl    │
│                                                                      │
│  什么算 transcript message:                                          │
│    isTranscriptMessage(entry):                                       │
│      entry.type === 'user'       │                                   │
│      entry.type === 'assistant'  │ → 写入 transcript                │
│      entry.type === 'attachment' │                                   │
│      entry.type === 'system'     │                                   │
│      entry.type === 'progress'   → 不是 transcript (排除！)          │
│                                                                      │
│  设计要点: progress 不能进入主链，旧版本混入导致恢复断链 → 见 [1]     │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## 写入路径

```
┌──────────────────────────────────────────────────────────────────────┐
│ 【重点】appendEntry() — 写入分流器                                    │
│ [src/utils/sessionStorage.ts]                                        │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  appendEntry(entry, sessionId)                                       │
│    │                                                                 │
│    ├─ session file 尚未 materialize?                                 │
│    │   └─ pendingEntries.push(entry) → return                       │
│    │                                                                 │
│    ├─ entry 是 metadata (summary/title/tag/mode/worktree/pr)?       │
│    │   └─ enqueueWrite(mainSessionFile, entry) → return             │
│    │                                                                 │
│    ├─ entry.type === 'content-replacement'?                          │
│    │   └─ target = agentId ? sidechain : main → enqueueWrite        │
│    │                                                                 │
│    └─ transcript message:                                            │
│        ├─ entry.isSidechain?                                         │
│        │   └─ enqueueWrite(agentSidechainFile, entry)               │
│        │       (允许与主链重复 UUID → fork 上下文完整)               │
│        │                                                             │
│        └─ 主链:                                                      │
│            if (uuid 之前没写过) {                                    │
│              enqueueWrite(mainSessionFile, entry)                    │
│              messageSet.add(entry.uuid)                              │
│              persistToRemote(sessionId, entry) // 增量同步           │
│            }                                                         │
│                                                                      │
│  核心规则: 主链去重，sidechain 保真，远端只跟主链                     │
│  设计要点: 见 [2]                                                    │
│                                                                      │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 底层写盘: 异步批量 flush                                              │
│ [src/utils/sessionStorage.ts:634]                                    │
│                                                                      │
│  drainWriteQueue():                                                  │
│    for (const [filePath, queue] of writeQueues) {                    │
│      batch = queue.splice(0)                                         │
│      content = batch.map(e => jsonStringify(e) + '\n').join('')     │
│      appendToFile(filePath, content)  // mode 0o600                 │
│    }                                                                 │
│                                                                      │
│  不是每条同步写，而是内存队列 + 批量 flush                            │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## Metadata 尾部重挂

```
┌──────────────────────────────────────────────────────────────────────┐
│ 【重点】reAppendSessionMetadata()                                    │
│ [src/utils/sessionStorage.ts:686]                                    │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  问题: title/tag 早期写入后，被越来越长的对话"挤出 tail window"       │
│  解法: 周期性将 metadata 重挂到 transcript 尾部                       │
│                                                                      │
│  reAppendSessionMetadata(skipTitleRefresh = false):                   │
│    │                                                                 │
│    ├─ tail = readFileTailSync(sessionFile)                           │
│    ├─ refreshTitleAndTagFromTail(tail)  // 吸收外部 SDK 修改         │
│    │                                                                 │
│    └─ 按序 append:                                                   │
│        last-prompt, custom-title, tag,                               │
│        agent-name, agent-color, agent-setting,                       │
│        mode, worktree-state, pr-link                                 │
│                                                                      │
│  两种读取模式:                                                       │
│    ├─ 完整恢复: 读全量 transcript                                    │
│    └─ lite 列表: 只读头尾 64KB (LITE_READ_BUF_SIZE)                 │
│       → metadata 在尾部才能被 lite reader 看到                       │
│                                                                      │
│  设计要点: 见 [3]                                                    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## 远端 Ingress 增量同步

```
┌──────────────────────────────────────────────────────────────────────┐
│ 远端 Ingress [src/services/api/sessionIngress.ts]                    │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  不是上传整个文件，而是 append 链:                                    │
│    每次 PUT 一条 entry                                               │
│    用 Last-Uuid 头做乐观并发控制                                     │
│    409 冲突时吸收服务器最新 UUID 后重试                               │
│                                                                      │
│  单 session 串行化:                                                   │
│    sequentialAppendBySession = new Map()                             │
│    每个 session 一条顺序执行队列                                     │
│    → 本地高频异步追加，远端单 session 串行                            │
│                                                                      │
│  反向 hydrate:                                                       │
│    hydrateRemoteSession(sessionId, ingressUrl)                       │
│    → 拉取远端 logs → 写回本地 JSONL                                  │
│    → 远端不只是备份，还是 hydrate source                             │
│                                                                      │
│  本地 transcript 是运行时主副本                                       │
│  远端 ingress 是可回灌的增量副本                                     │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## Session Memory 提取

```
┌──────────────────────────────────────────────────────────────────────┐
│ Session Memory [src/services/SessionMemory/sessionMemory.ts]         │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  shouldExtractMemory(messages):                                      │
│    │                                                                 │
│    ├─ 条件1: 消息数量达到阈值                                        │
│    ├─ 条件2: !hasToolCallsInLastTurn (不在 tool 链中间)             │
│    ├─ 条件3: 距上次提取间隔足够                                      │
│    └─ 条件4: SM 功能已启用                                           │
│                                                                      │
│  触发后:                                                              │
│    runForkedAgent()                                                  │
│      ├─ fork 一个子 agent                                            │
│      ├─ 使用专用 SM prompt (限制工具集, 禁 MCP/Agent)               │
│      ├─ 子 agent 提取关键信息写入 SM 文件                            │
│      └─ SM 文件后续可被 compact 快捷路径复用                         │
│                                                                      │
│  → compact 复用 SM: 见 [04-上下文管理](04-context-mgmt.md)           │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## Resume 恢复流水线

```
┌──────────────────────────────────────────────────────────────────────┐
│ 【重点】loadTranscriptFile() — 重建会话图                             │
│ [src/utils/sessionStorage.ts]                                        │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  不是简单的 "parseJSONL → 返回数组"                                   │
│                                                                      │
│  步骤1: 大文件优化                                                   │
│    │  if (size > SKIP_PRECOMPACT_THRESHOLD) {                        │
│    │    scan = readTranscriptForLoad(filePath, size)                  │
│    │    buf = scan.postBoundaryBuf  // 只读 boundary 之后             │
│    │    metadata = scanPreBoundaryMetadata()  // 补扫头部 metadata    │
│    │  }                                                              │
│    │                                                                 │
│  步骤2: 按 entry type 分流                                           │
│    │  for (entry of parseJSONL(buf)) {                               │
│    │    ├─ legacy progress → 桥接到 progressBridge map               │
│    │    ├─ transcript message:                                       │
│    │    │   if (parentUuid 指向 legacy progress)                     │
│    │    │     → 重连到 progressBridge[parent]                        │
│    │    │   messages.set(uuid, entry)                                │
│    │    ├─ summary → summaries map                                   │
│    │    ├─ custom-title → titles map                                 │
│    │    ├─ content-replacement → replacements map                    │
│    │    └─ marble-origami-commit → contextCollapseCommits            │
│    │  }                                                              │
│    │                                                                 │
│  步骤3: 链路修复                                                     │
│    │  applyPreservedSegmentRelinks(messages)                         │
│    │  applySnipRemovals(messages)                                    │
│    │    └─ 被 snip 的消息删除后，修复幸存消息的 parentUuid           │
│    │       沿被删消息的 parentUuid 向前走直到找到存在的祖先           │
│    │                                                                 │
│  步骤4: 重算叶节点                                                   │
│    │  leafUuids = recomputeLeaves(messages)                          │
│    │                                                                 │
│  设计要点: 见 [4]                                                    │
│                                                                      │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ buildConversationChain() — 从叶节点回溯构建链                         │
│ [src/utils/sessionStorage.ts:2069]                                   │
│                                                                      │
│  从 leafMessage 沿 parentUuid 回溯                                   │
│  transcript.reverse()                                                │
│  recoverOrphanedParallelToolResults(messages, transcript, seen)      │
│    └─ 补回并行 tool_use 的兄弟节点和孤立 tool_result                 │
│                                                                      │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 【重点】loadConversationForResume() — resume 编排                     │
│ [src/utils/conversationRecovery.ts]                                  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  步骤1: 解析来源                                                     │
│    │  log = resolveSourceToLogOrJsonl(source)                        │
│    │  if (lite log) → loadFullLog(log)                               │
│    │                                                                 │
│  步骤2: 恢复关联状态                                                  │
│    │  copyPlanForResume(log, sessionId)                               │
│    │  copyFileHistoryForResume(log)                                   │
│    │                                                                 │
│  步骤3: 一致性审计                                                   │
│    │  checkResumeConsistency(messages)                                │
│    │  → 对比 checkpoint messageCount 与实际 chain 长度               │
│    │                                                                 │
│  步骤4: 状态恢复                                                     │
│    │  restoreSkillStateFromMessages(messages)                         │
│    │  deserializeMessagesWithInterruptDetection(messages)             │
│    │    ├─ 过滤 unresolved tool_use                                  │
│    │    ├─ 过滤 orphaned thinking-only messages                     │
│    │    └─ 检测中断 turn → 注入 "Continue from where you left off"  │
│    │                                                                 │
│  步骤5: 运行时接管                                                   │
│    │  processSessionStartHooks('resume', {sessionId})                │
│    │                                                                 │
│  返回:                                                               │
│    messages, turnInterruptionState,                                  │
│    fileHistorySnapshots, contentReplacements,                        │
│    contextCollapseCommits, session metadata                          │
│                                                                      │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ ResumeConversation.tsx — UI 接管                                     │
│ [src/screens/ResumeConversation.tsx]                                  │
│                                                                      │
│  switchSession(sessionId)                                            │
│  → renameRecordingForSession()                                       │
│  → resetSessionFilePointer()                                         │
│  → restoreCostStateForSession()                                      │
│  → restoreAgentFromSession()                                         │
│  → restoreSessionMetadata()                                          │
│  → restoreWorktreeForResume()                                        │
│  → adoptResumedSessionFile()                                         │
│  → restoreContextCollapse()                                          │
│  → render(<REPL initialMessages={messages} />)                       │
│                                                                      │
│  resume 不是"把旧 transcript 打开看看"                                │
│  而是一次完整的运行时状态接管                                         │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## 深度技术分析

### [1] 为什么 progress 不能进入 transcript

旧版本把 `progress` 混进 transcript 后，恢复时会把真实对话链截断。因为 `progress` 消息频率极高（工具执行进度），如果它们参与 `parentUuid` 链，恢复时需要处理大量非真实对话节点，且容易因为 progress 消息缺失导致链断裂。

设计原则：transcript 只保留真正影响上下文重建的消息，高频 UI 状态从持久化层排除。

### [2] 主链去重 vs sidechain 保真

这解决了两个互相冲突的需求：
- **主 transcript 不能重复写同一个 UUID**——否则 resume 遇到重复链路，远端 ingress 遇到 409 冲突
- **sidechain 必须允许 UUID 重复**——fork child 继承父 context，那些消息在主链已经存在，但 sidechain 需要完整保留才能独立恢复

### [3] metadata 尾部重挂的三层意义

1. **让 lite reader 从 tail 64KB 快速读到关键 metadata**——session 列表页不需要 parse 整个 transcript
2. **让 resume 后未发新消息的 session 也能落盘 metadata**——`adoptResumedSessionFile()` 确保有写入目标
3. **兼容外部 SDK 修改**——先从 tail 吸收外部改过的新 title/tag，再重挂，避免本地缓存覆盖回旧值

### [4] transcript 是可修复的图结构

`loadTranscriptFile()` 重建的不是线性数组，而是一张会话图。需要修复的场景包括：

| 场景 | 修复方法 |
|------|----------|
| legacy progress 混入主链 | progressBridge map 桥接 |
| snip 删除后 parentUuid 断裂 | 沿被删消息向前走找存活祖先 |
| 并行 tool_use 的兄弟节点丢失 | recoverOrphanedParallelToolResults() |
| compact boundary 之前的冗余历史 | 只读 boundary 之后 + 补扫头部 metadata |

这说明 append-only 的写入简洁性，是以恢复路径的复杂性为代价的。但这种取舍在日志系统设计中是经典的正确选择——写路径简单意味着崩溃后更容易保留证据。

### [5] resume 是运行时接管

`/resume` 恢复的不只是消息数组，还包括：sessionId、cost tracker、agent identity、skill state、worktree 状态、context collapse、file history。它还会重新执行 session start hooks、检测中断 turn 并注入 continuation prompt。

这意味着 resume 不是静态回放，而是在重建一个可继续运行的完整会话运行时。

## 代码索引

- `src/utils/sessionStorage.ts` — 核心存储层（appendEntry / loadTranscriptFile / reAppendSessionMetadata / buildConversationChain）
- `src/utils/sessionStoragePortable.ts` — lite reader（LITE_READ_BUF_SIZE=64KB / readTranscriptForLoad）
- `src/utils/conversationRecovery.ts` — `loadConversationForResume()` resume 编排
- `src/screens/ResumeConversation.tsx` — UI 层 resume 接管
- `src/services/api/sessionIngress.ts` — 远端 ingress 增量同步
- `src/services/SessionMemory/sessionMemory.ts` — `shouldExtractMemory()` / `runForkedAgent()`
