# Skill 系统实现 - 详细实现

上游: [06-持久化与恢复](06-persistence.md) | [← 返回总览](README.md) | 下游: [08-MCP 集成](08-mcp-integration.md)

## 概览

Claude Code 通过 Skills 机制实现平台化扩展。核心是把 Markdown 文件 + YAML 元数据 + 可选的 Bash 脚本三者结合，低门槛地为 AI 注入领域能力。Skills 有三种来源（文件系统 / 内建打包 / MCP），统一实例化为 Command 对象挂入命令系统。最精妙的功能是 prompt 内嵌 Shell 执行——在技能被调用前先在宿主机执行命令，输出替换回 prompt。

## 完整执行流程

```
┌──────────────────────────────────────────────────────────────────────┐
│ Skills 三种来源                                                       │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐     │
│  │ File-based      │  │ Bundled         │  │ MCP Skills      │     │
│  │                 │  │                 │  │                 │     │
│  │ ~/.claude/skills│  │ 源码内硬编码    │  │ MCP Server      │     │
│  │ .claude/skills/ │  │ 构建流程打包    │  │ 工具能力映射    │     │
│  │ 项目目录向上爬  │  │                 │  │                 │     │
│  │                 │  │ loadedFrom:     │  │ loadedFrom:     │     │
│  │ loadedFrom:     │  │ 'bundled'       │  │ 'mcp'           │     │
│  │ 'skills'        │  │                 │  │                 │     │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘     │
│           │                    │                     │              │
│           └────────────────────┼─────────────────────┘              │
│                                │                                    │
│                                ▼                                    │
│                     统一实例化为 Command 对象                        │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 【重点】getSkillDirCommands(cwd) — 技能发现                          │
│ [src/skills/loadSkillsDir.ts:638]                                    │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  memoize 包裹 — 同一 cwd 只发现一次                                  │
│                                                                      │
│  并行扫描所有来源:                                                    │
│    │                                                                 │
│    │  const [managed, user, project, additional, legacy] =           │
│    │    await Promise.all([                                          │
│    │                                                                 │
│    ├─ managedSkillsDir   // 策略管理目录 (policySettings)            │
│    ├─ userSkillsDir      // ~/.claude/skills (userSettings)          │
│    ├─ projectSkillsDirs  // 项目目录向上爬取 (projectSettings)       │
│    ├─ additionalDirs     // --add-dir 显式指定                       │
│    └─ legacyCommands     // 旧版 /commands/ 目录                     │
│    │                                                                 │
│    │  ])                                                             │
│    │                                                                 │
│    ▼                                                                 │
│  deduplicateByRealpath([...all])                                     │
│    └─ inode 级去重，防止软链接重复加载                                │
│                                                                      │
│  --bare 模式: 跳过自动发现，只加载 --add-dir 路径                    │
│                                                                      │
│  设计要点: 见 [1]                                                    │
│                                                                      │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ SKILL.md 解析                                                        │
│ [src/skills/loadSkillsDir.ts:185]                                    │
│                                                                      │
│  parseFrontmatter(content) → YAML 元数据                             │
│    │                                                                 │
│    ▼                                                                 │
│  parseSkillFrontmatterFields(frontmatter):                           │
│    name, description, when_to_use,                                   │
│    allowed_tools,    // 限制可用工具集                                │
│    model,            // 指定模型                                     │
│    effort,           // 任务估时: low | medium | high                │
│    user_invocable,   // false = 仅供模型调用, 不出现在 REPL          │
│    paths,            // 条件技能触发路径 (glob pattern)               │
│    context,          // 'inline' | 'fork'                            │
│    agent,            // 绑定到指定 agent 类型                        │
│    shell,            // 'bash' | 'powershell'                        │
│    version                                                           │
│                                                                      │
│  paths 字段是核心魔法 → 见 [2]                                       │
│                                                                      │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 【重点】createSkillCommand() — 技能实例化                             │
│ [src/skills/loadSkillsDir.ts:270]                                    │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  返回 Command 对象:                                                  │
│    type: 'prompt',                                                   │
│    name: skillName,                                                  │
│    paths,             // 条件触发                                    │
│    isHidden: !userInvocable,                                         │
│                                                                      │
│  核心方法: getPromptForCommand(args, toolUseContext)                  │
│    │                                                                 │
│    ├─ 1. substituteArguments(finalContent, args)                     │
│    │      └─ 展开 CLI 参数占位符                                     │
│    │                                                                 │
│    ├─ 2. 展开内置变量                                                │
│    │      ${CLAUDE_SKILL_DIR} → 技能所在目录                         │
│    │      ${CLAUDE_SESSION_ID} → 当前 session ID                    │
│    │                                                                 │
│    └─ 3. executeShellCommandsInPrompt()                              │
│           └─ 执行 prompt 内嵌 Shell (仅受信任来源)                   │
│           └─ loadedFrom !== 'mcp' 时才执行                           │
│    │                                                                 │
│    ▼                                                                 │
│  返回 [{ type: 'text', text: finalContent }]                        │
│  → 作为 user message 注入到 query 循环                               │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## Prompt 内嵌 Shell 执行

```
┌──────────────────────────────────────────────────────────────────────┐
│ 【重点】executeShellCommandsInPrompt()                               │
│ [src/utils/promptShellExecution.ts:69]                               │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Markdown 里嵌入 Shell 命令:                                         │
│                                                                      │
│    内联语法: !`git status --short`                                   │
│    代码块语法:                                                       │
│      ```!                                                            │
│      git log --oneline -5                                            │
│      ```                                                             │
│                                                                      │
│  执行流程:                                                           │
│    │                                                                 │
│    ├─ 选择执行工具:                                                  │
│    │   shell === 'powershell' ? PowerShellTool : BashTool            │
│    │                                                                 │
│    ├─ 扫描两种语法:                                                  │
│    │   BLOCK_PATTERN + INLINE_PATTERN                                │
│    │                                                                 │
│    └─ Promise.all 并行执行所有匹配:                                  │
│        for each match:                                               │
│          1. 权限检查 hasPermissionsToUseTool()                       │
│             └─ 走同一套 ToolPermission 流程                          │
│          2. shellTool.call({ command }, context)                     │
│          3. 输出替换回原始 pattern 位置                               │
│             └─ 用函数形式替换，防 $& 特殊符号污染                    │
│                                                                      │
│  安全切断:                                                           │
│    loadedFrom !== 'mcp' → MCP 来源跳过 Shell 执行                   │
│    → 防止恶意 MCP Server 注入 RCE                                   │
│                                                                      │
│  设计要点: 见 [3]                                                    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## Skill 在 System Prompt 中的注入

```
┌──────────────────────────────────────────────────────────────────────┐
│ Skill → System Prompt 注入路径                                       │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  模型如何知道有哪些技能可用?                                          │
│                                                                      │
│  getSystemPrompt() 的 system-reminder section:                       │
│    ├─ 列出所有 user_invocable 技能的 name + description             │
│    ├─ 列出 when_to_use 触发条件                                     │
│    └─ 包裹在 <system-reminder> XML 标记中                            │
│                                                                      │
│  模型看到的格式:                                                      │
│    <system-reminder>                                                 │
│    The following skills are available:                                │
│    - commit: Use this skill to create git commits...                 │
│    - review: Pre-landing PR review...                                │
│    </system-reminder>                                                │
│                                                                      │
│  模型调用 skill:                                                     │
│    使用 Skill tool → 触发 getPromptForCommand()                     │
│    → shell 执行 → 变量替换 → 返回最终 prompt                        │
│    → 作为 user message 注入 query 循环                               │
│                                                                      │
│  条件技能 (paths 字段):                                              │
│    当用户操作匹配 glob pattern 的文件时自动激活                       │
│    → 不需要用户显式调用                                              │
│                                                                      │
│  设计要点: 见 [4]                                                    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## 深度技术分析

### [1] 技能发现的多级并行扫描

`getSkillDirCommands()` 的设计体现了几个工程考量：

- **memoize 缓存**：同一个 `cwd` 只扫描一次，避免重复 IO
- **Promise.all 并行**：5 个来源同时扫描，不串行等待
- **inode 级去重**：通过 `fs.realpath()` 取真实路径，防止软链接导致同一个 skill 被加载两次
- **--bare 模式**：跳过自动发现，只加载显式指定的路径——用于受控环境（CI/CD）

来源优先级：策略管理 > 用户级 > 项目级 > --add-dir > 旧版 commands。这种分层让组织管理员可以通过策略目录覆盖用户的自定义 skill。

### [2] paths 字段 — 条件技能触发

声明了 `paths` 的技能是**条件技能（Conditional Skill）**。当用户操作或修改了匹配该 glob pattern 的文件时，技能自动激活并注入上下文。

这是一种精准触发的 Hook 订阅模式：
- 避免所有技能同时加载造成的认知过载
- 只在相关文件被触及时才激活
- glob pattern 支持 `**/*.tsx`、`src/api/**` 等灵活匹配

### [3] 内嵌 Shell 的安全设计

`executeShellCommandsInPrompt()` 是 Skills 系统最精妙但也最危险的功能。安全保障有三层：

1. **来源隔离**：`loadedFrom !== 'mcp'` → MCP 来源的技能跳过 Shell 执行，防止恶意远程 MCP Server 注入 RCE
2. **权限复用**：所有 Shell 命令执行前都走 `hasPermissionsToUseTool()`，遵从同一套 ToolPermission 流程
3. **输出净化**：用函数形式 `replace(match, () => output)` 替换，防止 `$&` 等正则特殊替换符号被 PowerShell 输出污染

这意味着 skill 里的 `!`command`` 不是"绕过权限系统的后门"，而是走了和 BashTool 完全相同的权限检查路径。

### [4] Skill 指令注入的 XML 包裹

Skill 信息在 system prompt 中被包裹在 `<system-reminder>` XML 标记中。这种设计的意图：

- **让模型知道这是系统注入的信息**，不是用户输入
- **支持动态增减**：skill 列表可能因为条件触发而变化
- **结构化解析**：模型可以清晰区分"可用技能列表"和其他 prompt 内容

### [5] Skill 的三种来源统一为 Command

不管是文件系统的 `SKILL.md`、源码内打包的 bundled skill、还是 MCP Server 映射的能力，最终都统一实例化为 `Command` 对象。这意味着：

- 模型不需要区分技能来源
- 权限系统统一处理
- 命令系统的 `/` 补全统一展示
- 扩展新的技能来源只需要实现 `createSkillCommand()` 接口

## 代码索引

- `src/skills/loadSkillsDir.ts:638` — `getSkillDirCommands()` 技能发现入口
- `src/skills/loadSkillsDir.ts:185` — `parseSkillFrontmatterFields()` YAML 解析
- `src/skills/loadSkillsDir.ts:270` — `createSkillCommand()` 技能实例化
- `src/skills/bundledSkills.ts` — 内建打包技能
- `src/utils/promptShellExecution.ts:69` — `executeShellCommandsInPrompt()` 内嵌 Shell
- `src/constants/prompts.ts` — skill 信息注入 system prompt
