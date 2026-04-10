# 上下文管理流程 - 详细实现

上游: [03-工具执行流程](03-tool-execution.md) | [← 返回总览](README.md) | 下游: [05-多智能体协作](05-multi-agent.md)

## 概览

Claude Code 的上下文管理不是"一段固定 system prompt"，而是一套分层拼装、可缓存、可覆盖、可观测的 Prompt Runtime。它同时管理 System Prompt 组装、CLAUDE.md 注入、Memory 加载、Auto-Compact 压缩、以及 Prompt Cache 优化。

## 完整执行流程

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 上下文组装总链路                                                          │
│ 每次 query() 循环调用 API 前，都要完成以下组装                            │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 【重点】getSystemPrompt() [src/constants/prompts.ts]                      │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  返回 string[] (不是单个字符串，而是 section 数组)                        │
│                                                                          │
│  return [                                                                │
│    │                                                                     │
│    ├─ 静态主干 (高度稳定，利于 prompt cache)                             │
│    │   ├─ getSimpleIntroSection()      // 身份声明 + 安全指令            │
│    │   ├─ getSimpleSystemSection()     // 基础规则                       │
│    │   ├─ getSimpleDoingTasksSection() // coding agent 工作规则          │
│    │   ├─ getActionsSection()          // 执行注意事项                   │
│    │   ├─ getUsingYourToolsSection()   // 工具使用指南                   │
│    │   ├─ getSimpleToneAndStyleSection() // 语气风格                     │
│    │   └─ getOutputEfficiencySection() // 输出效率                       │
│    │                                                                     │
│    ├─ SYSTEM_PROMPT_DYNAMIC_BOUNDARY                                    │
│    │   └─ 缓存分界线: 之前尽量稳定，之后允许变化                         │
│    │   设计要点: 见 [1]                                                  │
│    │                                                                     │
│    └─ 动态段 (依赖运行态)                                                │
│        ├─ session_guidance                                               │
│        ├─ memory → buildMemoryPrompt()                                  │
│        │   → 详见 [06-持久化与恢复](06-persistence.md)                   │
│        ├─ env_info_simple (OS, shell, cwd, model)                       │
│        ├─ language (用户语言偏好)                                        │
│        ├─ output_style                                                   │
│        ├─ mcp_instructions (MCP server 指令)                            │
│        │   └─ DANGEROUS_uncachedSystemPromptSection                     │
│        ├─ scratchpad                                                     │
│        └─ summarize_tool_results                                        │
│  ]                                                                       │
│                                                                          │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 【重点】buildEffectiveSystemPrompt() [src/utils/systemPrompt.ts]          │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  优先级覆盖链 (从高到低):                                                 │
│    │                                                                     │
│    ├─ 0. overrideSystemPrompt                                           │
│    │   └─ 完全替代，其他全部忽略                                         │
│    │                                                                     │
│    ├─ 1. Coordinator system prompt                                      │
│    │   └─ isCoordinatorMode() 时使用调度器专用 prompt                    │
│    │   → 详见 [05-多智能体](05-multi-agent.md)                           │
│    │                                                                     │
│    ├─ 2. Agent system prompt                                            │
│    │   └─ agentDefinition.getSystemPrompt()                             │
│    │   注意: 普通模式下 agent prompt 直接替代默认 prompt                  │
│    │         proactive 模式下追加到默认 prompt 后面                       │
│    │                                                                     │
│    ├─ 3. Custom system prompt (--system-prompt)                         │
│    │   └─ 替代默认 prompt (不是追加)                                     │
│    │                                                                     │
│    ├─ 4. Default system prompt                                          │
│    │   └─ getSystemPrompt() 返回的 section 数组                         │
│    │                                                                     │
│    └─ + appendSystemPrompt (始终追加到末尾)                              │
│        ├─ --append-system-prompt CLI 参数                                │
│        ├─ proactive mode addendum                                       │
│        ├─ tmux teammate addendum                                        │
│        └─ Chrome / assistant addendum                                   │
│                                                                          │
│  设计要点: 见 [2]                                                        │
│                                                                          │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 并行获取运行时上下文 [src/context.ts] [src/utils/queryContext.ts]         │
│                                                                          │
│  const [defaultSystemPrompt, userContext, systemContext] =               │
│    await Promise.all([                                                   │
│      getSystemPrompt(...),                                               │
│      getUserContext(),                                                    │
│      getSystemContext(),                                                  │
│    ])                                                                    │
│                                                                          │
│  userContext:                                                             │
│    ├─ claudeMd → 扫描 .claude/ 目录，读取 CLAUDE.md 文件                │
│    │   └─ getClaudeMds(filterInjectedMemoryFiles(memoryFiles))          │
│    └─ currentDate → "Today's date is 2026-04-06."                       │
│                                                                          │
│  systemContext:                                                           │
│    ├─ gitStatus → 当前 git 状态快照                                     │
│    └─ cacheBreaker → 缓存失效注入项                                     │
│                                                                          │
│  设计要点: 见 [3]                                                        │
│                                                                          │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ Memory 注入 [src/memdir/memdir.ts]                                       │
│                                                                          │
│  buildMemoryPrompt({displayName, memoryDir, extraGuidelines})            │
│    ├─ 同步读取 MEMORY.md (某些路径来自 React render，不能 await)         │
│    ├─ truncateEntrypointContent() 硬截断保护                             │
│    │   └─ MAX_ENTRYPOINT_LINES = 200, MAX_ENTRYPOINT_BYTES = 25000     │
│    ├─ buildMemoryLines() 构造 memory 使用规则                            │
│    │   ├─ 记忆类型分类 (user/feedback/project/reference)                │
│    │   ├─ 禁止保存的内容                                                │
│    │   └─ 双步法: 先写 topic 文件，再在 MEMORY.md 添加索引行            │
│    └─ 拼接 MEMORY.md 当前内容                                           │
│                                                                          │
│  → Memory 体系详见 [06-持久化与恢复](06-persistence.md)                  │
│                                                                          │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   │
                                   ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ 最终发送给 API                                                            │
│ [system prompt sections] + [userContext] + [systemContext]                │
│ + [messages (含 tool_use / tool_result)]                                 │
└──────────────────────────────────────────────────────────────────────────┘
```

## Prompt Cache 工程

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 【重点】Section 缓存机制 [src/constants/systemPromptSections.ts]          │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  两种 section 类型:                                                      │
│                                                                          │
│  systemPromptSection(name, compute)                                      │
│    └─ cacheBreak: false → 结果缓存，同名 section 不重复计算              │
│                                                                          │
│  DANGEROUS_uncachedSystemPromptSection(name, compute, reason)            │
│    └─ cacheBreak: true → 每轮重算，显式声明"这是危险操作"                │
│    └─ 例: mcp_instructions (MCP server 可能动态变化)                     │
│                                                                          │
│  解析逻辑:                                                               │
│    resolveSystemPromptSections(sections)                                  │
│      for each section:                                                   │
│        if (!cacheBreak && cache.has(name)) → 返回缓存                   │
│        else → compute() → 存入缓存 → 返回                              │
│                                                                          │
│  缓存失效时机:                                                           │
│    clearSystemPromptSections() 在以下事件触发:                            │
│    ├─ /clear (清空会话)                                                  │
│    ├─ /compact (压缩上下文)                                              │
│    ├─ enter/exit worktree                                                │
│    └─ resume/restore session                                             │
│                                                                          │
│  SYSTEM_PROMPT_DYNAMIC_BOUNDARY:                                         │
│    ├─ 不是给模型看的，是给缓存系统看的                                    │
│    ├─ boundary 之前 → 尽可能保持稳定 (利于 prompt prefix cache)          │
│    └─ boundary 之后 → 允许更多 session 级变化                            │
│                                                                          │
│  设计要点: 见 [4]                                                        │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Auto-Compact 压缩流程

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 【重点】Auto-Compact [src/services/compact/autoCompact.ts]                │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  触发条件:                                                               │
│    │  有效窗口 = 总窗口 - MAX_OUTPUT_TOKENS_FOR_SUMMARY(20k)            │
│    │  缓冲区 = AUTOCOMPACT_BUFFER_TOKENS(13k)                           │
│    │  当 token 消耗 > 有效窗口 - 缓冲区 时触发                           │
│    │                                                                     │
│  熔断器:                                                                 │
│    │  连续失败 >= MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES(3) → 停止        │
│    │  防止不可恢复的超限反复徒劳请求                                      │
│    │                                                                     │
│  压缩流程:                                                               │
│    │                                                                     │
│    ├─ 1. 预处理: 脱水非关键素材                                          │
│    │   ├─ stripImagesFromMessages()     // 剔除图片                     │
│    │   └─ stripReinjectedAttachments()  // 剔除 skill 附件             │
│    │                                                                     │
│    ├─ 2. Session Memory 快捷路径                                        │
│    │   if (SM 已启用且有最新摘要) {                                      │
│    │     trySessionMemoryCompaction()                                    │
│    │     └─ 直接用 SM 文件充当摘要，不额外调 API                         │
│    │   }                                                                 │
│    │   设计要点: 见 [5]                                                  │
│    │                                                                     │
│    ├─ 3. 常规路径: Forked Agent 生成摘要                                 │
│    │   ├─ 借用主对话的 Prompt Cache                                     │
│    │   └─ 生成 <analysis> + <summary> 结构化摘要                        │
│    │                                                                     │
│    ├─ 4. PTL 防御 (Prompt Too Long)                                     │
│    │   if (compact 请求本身也超限) {                                     │
│    │     truncateHeadForPTLRetry()                                       │
│    │     └─ 每次剥掉 20% 旧分组重试 (最后的救命稻草)                     │
│    │   }                                                                 │
│    │                                                                     │
│    └─ 5. 状态重灌 (State Re-injection)                                  │
│        ├─ createPostCompactFileAttachments()  // 重建文件附件            │
│        ├─ createPlanAttachmentIfNeeded()      // 重建 Plan              │
│        ├─ createSkillAttachmentIfNeeded()     // 重建 Skill             │
│        └─ getDeferredToolsDeltaAttachment()   // 重声明外部工具能力     │
│                                                                          │
│  压缩后模型看到:                                                         │
│    [System 边界宣告] + [精简摘要] + [正在查看的文件]                      │
│    + [进行中的 Plan] + [激活的 MCP/Tools 完整声明]                       │
│                                                                          │
│  设计要点: 见 [6]                                                        │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## Session Memory Compact 快捷路径

```
┌──────────────────────────────────────────────────────────────────────────┐
│ trySessionMemoryCompaction() [src/services/compact/sessionMemoryCompact.ts]│
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  calculateMessagesToKeepIndex():                                         │
│    ├─ 从后向前保留最低限度 token (10K-40K)                               │
│    ├─ 截断位置不能落在 tool_use/tool_result 链中间                       │
│    │   └─ adjustIndexToPreserveAPIInvariants()                          │
│    │       强制向头部平移，合包孤立的 tool_result                        │
│    └─ 不能切断与 Assistant 共享 message.id 的 Thinking 流               │
│                                                                          │
│  优势: 不额外调 API 浪费 token，直接用后台 SM 文件充当摘要              │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

## 深度技术分析

### [1] SYSTEM_PROMPT_DYNAMIC_BOUNDARY — Prompt 缓存分界线

Claude Code 把 prompt 当成缓存对象治理。`SYSTEM_PROMPT_DYNAMIC_BOUNDARY` 是一个特殊标记：

- 它不是给模型看的，而是给缓存系统看的
- boundary 之前的 section（身份、规则、工具指南）高度稳定，利于 Anthropic API 的 prompt prefix cache
- boundary 之后的 section（memory、env info、MCP instructions）允许 session 级变化

这意味着 Claude Code 已经把 prompt prefix cache 当成一级工程问题处理。每次 API 调用，前半段 prompt 大概率命中缓存，只有后半段需要重新处理。

### [2] 覆盖优先级的设计意图

`buildEffectiveSystemPrompt()` 的覆盖链揭示了几个重要设计决策：

- `customSystemPrompt` 是**替代**而非追加——用户完全控制 prompt 内容
- `agentSystemPrompt` 在普通模式下也是替代——agent 可以完全重定义身份
- `appendSystemPrompt` 是唯一的"追加总线"——所有 addendum 都走这条路
- `overrideSystemPrompt` 是最高优先级——用于测试和调试

这种设计让"覆写"和"加尾注"有严格的工程区分。

### [3] userContext 和 systemContext 为什么不在 prompts.ts 里

有些内容不是 system prompt section，而是独立的 context：

- `CLAUDE.md` 是运行时扫描、读取、拼接后注入的，不是模板里写死的
- `currentDate` 是独立字段，不是主 prompt 文本的一部分
- `gitStatus` 提供的是"本轮推理必须知道的系统状态"

这种分离让常驻规则、会话上下文、系统状态各自独立演进，不会互相干扰。

### [4] Section 缓存纪律

`DANGEROUS_uncachedSystemPromptSection()` 的命名本身就是一种工程纪律：

- 默认 section 都应该缓存
- 如果你要让某段 prompt 每轮重算，必须显式声明"这是危险操作"并说明原因
- 这防止了开发者无意中引入高频变化的 section 破坏 cache 命中率

### [5] Session Memory Compact 快捷路径

这是 Compact 中最具亮点的工程设计。当 Session Memory 已启用且有最新摘要时：

- 不再调用额外的 API 浪费 token 让模型总结
- 直接读取后台 SM 子 Agent 最新沉淀的摘要文件充当断点
- `calculateMessagesToKeepIndex()` 精确裁切，内置防御逻辑避免切断 tool_use/tool_result 链

### [6] 状态重灌 — 压缩后的能力恢复

Compact 最危险的副作用是：过去注册的工具描述、MCP 能力声明、Plan 状态会被连带裁剪。所以 Compact 完成后必须做状态重灌：

- `createPostCompactFileAttachments()` — 重建工作区文件附件
- `createPlanAttachmentIfNeeded()` — 重建进行中的 Plan
- `getDeferredToolsDeltaAttachment()` — 重新全量声明外部工具能力

压缩后模型醒来的第一回合，虽然前世细节没有了，但当前的技能蓝图依然齐装满员。

### [7] 专项 Prompt 家族

主 prompt 之外，还有多个专项 prompt 服务后台任务：

| 专项 Prompt | 文件 | 特点 |
|-------------|------|------|
| Compact | `services/compact/prompt.ts` | 禁止工具、限制格式、强化总结结构 |
| Session Memory | `services/SessionMemory/prompts.ts` | 只允许 Edit 工具、模板约束 |
| Memory Extraction | `services/extractMemories/prompts.ts` | 限制工具集、禁止 MCP/Agent |

这些 prompt 不是定义长期身份，而是在单次任务里强力约束输出协议。

## 代码索引

- `src/constants/prompts.ts` — `getSystemPrompt()` 默认 system prompt section 集合
- `src/utils/systemPrompt.ts` — `buildEffectiveSystemPrompt()` 优先级合成
- `src/context.ts` — `getUserContext()` / `getSystemContext()` 运行时上下文
- `src/utils/queryContext.ts` — `fetchSystemPromptParts()` 共享 prompt 构造
- `src/constants/systemPromptSections.ts` — section 缓存机制
- `src/memdir/memdir.ts:272` — `buildMemoryPrompt()` Memory 注入
- `src/services/compact/autoCompact.ts:241` — `autoCompactIfNeeded()` 触发逻辑
- `src/services/compact/compact.ts` — `compactConversation()` 压缩主流程
- `src/services/compact/sessionMemoryCompact.ts` — SM 快捷路径
- `src/utils/context.ts:18` — `MODEL_CONTEXT_WINDOW_DEFAULT` / `CAPPED_DEFAULT_MAX_TOKENS`
- `src/services/api/dumpPrompts.ts` — prompt 导出审计
- `src/main.tsx` — CLI prompt 参数入口
