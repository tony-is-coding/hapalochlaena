# MCP 集成 - 详细实现

上游: [07-Skill 系统](07-skill-system.md) | [← 返回总览](README.md)

## 概览

Claude Code 对 MCP（Model Context Protocol）做了深度集成：支持四种传输协议（stdio/SSE/WebSocket/HTTP）、完整的 OAuth 认证体系、并发安全管理、认证雪崩防护和 IDE 工具白名单。同时 Claude Code 自身也能作为 MCP Server 对外暴露能力，实现双向 MCP。

## 完整执行流程

```
┌──────────────────────────────────────────────────────────────────────┐
│ MCP 工具命名规则 [src/services/mcp/mcpStringUtils.ts]                │
│                                                                      │
│  buildMcpToolName(serverName, toolName):                             │
│    return `mcp__${serverName}__${toolName}`                          │
│                                                                      │
│  示例:                                                               │
│    mcp__filesystem__read_file                                        │
│    mcp__puppeteer__screenshot                                        │
│    mcp__ide__getDiagnostics                                          │
│                                                                      │
│  统一命名格式让模型无需区分工具来源                                   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 【重点】connectToServer() — 连接管理                                  │
│ [src/services/mcp/client.ts:595]                                     │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  memoize 包裹: 同一 server 配置只建一次连接                          │
│  缓存键: name + JSON(serverRef)                                      │
│                                                                      │
│  根据 serverRef.type 选择传输层:                                     │
│    │                                                                 │
│    ├─ stdio (默认, 最常用)                                           │
│    │   transport = new StdioClientTransport({                        │
│    │     command, args, env                                          │
│    │   })                                                            │
│    │                                                                 │
│    ├─ sse / sse-ide (远程 HTTP 长连接)                               │
│    │   authProvider = new ClaudeAuthProvider(name, serverRef)        │
│    │   transport = new SSEClientTransport(url, {                     │
│    │     authProvider,                                               │
│    │     fetch: wrapFetchWithTimeout(                                │
│    │       wrapFetchWithStepUpDetection(baseFetch, authProvider)     │
│    │     ),                                                          │
│    │   })                                                            │
│    │                                                                 │
│    ├─ ws / ws-ide (WebSocket, IDE 集成)                              │
│    │   transport = new WebSocketTransport(url)                       │
│    │                                                                 │
│    └─ http / streamable-http (HTTP + claude.ai 代理)                 │
│        transport = new StreamableHTTPClientTransport(url, {          │
│          fetch: wrapFetchWithTimeout(                                │
│            createClaudeAiProxyFetch(baseFetch)                       │
│          ),                                                          │
│        })                                                            │
│                                                                      │
│  client = new Client({ name: 'claude-code', version })               │
│  await client.connect(transport)                                     │
│  return { client, transport, ... }                                   │
│                                                                      │
│  设计要点: 见 [1]                                                    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 并发连接控制                                                          │
│                                                                      │
│  getMcpServerConnectionBatchSize():                                  │
│    本地默认 3 个并发 (env: MCP_SERVER_CONNECTION_BATCH_SIZE)         │
│                                                                      │
│  getRemoteMcpServerConnectionBatchSize():                            │
│    远端默认 20 个并发 (env: MCP_REMOTE_SERVER_CONNECTION_BATCH_SIZE) │
│                                                                      │
│  通过 pMap(servers, connectToServer, { concurrency }) 控制           │
│  防止启动时大量 MCP 并发导致系统卡死                                  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ 工具发现 → 工具池融合                                                 │
│                                                                      │
│  client.listTools() → 获取 server 暴露的工具列表                     │
│    │                                                                 │
│    ├─ 描述截断: MAX_MCP_DESCRIPTION_LENGTH = 2048                   │
│    │   └─ 防止 OpenAPI 生成的 15-60KB 超长描述塞满 Context Window    │
│    │                                                                 │
│    ├─ IDE 白名单过滤: isIncludedMcpTool()                            │
│    │   └─ IDE 工具只允许白名单内的通过                                │
│    │                                                                 │
│    └─ assembleToolPool() 融合                                        │
│        └─ 内建优先 + MCP 受控 → 统一 Tool[] 数组                    │
│        → 详见 [03-工具执行流程](03-tool-execution.md)                │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## 超时控制

```
┌──────────────────────────────────────────────────────────────────────┐
│ wrapFetchWithTimeout() [src/services/mcp/client.ts:492]              │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  GET 请求不加超时:                                                   │
│    └─ SSE 是长连接 GET，不能被超时切断                               │
│                                                                      │
│  其他方法:                                                           │
│    用 setTimeout + AbortController (不用 AbortSignal.timeout())      │
│    └─ 原因: AbortSignal.timeout() 在 Bun 中内存泄漏                 │
│       每请求约 2.4KB 在 GC 前一直残留                                │
│                                                                      │
│    timer.unref?.() → 不阻止进程退出                                  │
│                                                                      │
│  设计要点: 见 [2]                                                    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## 认证体系

```
┌──────────────────────────────────────────────────────────────────────┐
│ 【重点】认证雪崩防护 [src/services/mcp/client.ts:259]                │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  问题: Token 失效 → 100 个并发工具同时发现 401/403                   │
│        → 全部发起 Token 刷新 → "认证雪崩"                            │
│                                                                      │
│  解法: 本地文件缓存认证失败状态                                       │
│    缓存文件: ~/.claude/mcp-needs-auth-cache.json                     │
│    数据结构: Record<serverId, { timestamp: number }>                 │
│                                                                      │
│  setMcpAuthCacheEntry(serverId):                                     │
│    → 异步写入，不阻塞调用方                                          │
│                                                                      │
│  isMcpAuthCached(serverId):                                          │
│    → TTL = 15 分钟                                                   │
│    → 15 分钟内所有调用直接短路返回 needs-auth                        │
│    → 不消耗额外 Token 和网络请求                                     │
│                                                                      │
│  getMcpAuthCache():                                                  │
│    → Promise 结果 memoize，避免并发读重复 fs.readFile                │
│                                                                      │
│  设计要点: 见 [3]                                                    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Session 过期检测与重连                                                │
│ [src/services/mcp/client.ts:193]                                     │
│                                                                      │
│  isMcpSessionExpiredError(error):                                    │
│    HTTP 404 + JSON-RPC 错误码 -32001 → Session 过期                 │
│                                                                      │
│  检测到过期:                                                          │
│    connectToServer.cache.clear()                                     │
│    → 重新 connectToServer() 建立新连接                               │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│ claude.ai 代理专属 [src/services/mcp/client.ts:372]                  │
│                                                                      │
│  createClaudeAiProxyFetch(innerFetch):                               │
│    if (response.status === 401)                                      │
│      → refreshOAuthToken()                                           │
│      → 重试请求 (带更新后的 auth headers)                            │
│                                                                      │
│  无需用户手动重新登录                                                 │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## IDE 工具白名单

```
┌──────────────────────────────────────────────────────────────────────┐
│ IDE 隔离 [src/services/mcp/client.ts:569]                            │
│                                                                      │
│  ALLOWED_IDE_TOOLS = [                                               │
│    'mcp__ide__getDiagnostics',                                       │
│    'mcp__ide__getOpenEditorFiles',                                   │
│    // ... 仅少数高权限工具通过白名单                                  │
│  ]                                                                   │
│                                                                      │
│  isIncludedMcpTool(tool):                                            │
│    non-IDE 工具 → 全部允许                                           │
│    IDE 工具 (mcp__ide__*) → 只允许白名单内的                         │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## 双向 MCP: Claude Code 也是 MCP Server

```
┌──────────────────────────────────────────────────────────────────────┐
│ MCP Server 形态 [src/entrypoints/mcp.ts]                             │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Claude Code 不仅是 MCP Client，还能作为 MCP Server:                │
│                                                                      │
│  作为 Client:                                                        │
│    连接外部 MCP Server → 获取工具 → 融合到工具池                     │
│    → 模型可以调用外部能力                                            │
│                                                                      │
│  作为 Server:                                                        │
│    对外暴露内部工具（Bash, FileRead, FileEdit 等）为 MCP tools       │
│    → 其他 MCP Client 可以调用 Claude Code 的能力                     │
│    → 入口: src/entrypoints/mcp.ts                                   │
│                                                                      │
│  意义:                                                               │
│    ├─ 其他 AI 工具可以复用 Claude Code 的工具层                      │
│    ├─ IDE 扩展可以通过 MCP 协议驱动 Claude Code                     │
│    └─ Claude Code 成为工具能力的中间件                               │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## 深度技术分析

### [1] 四种传输协议的设计选择

| 类型 | 适用场景 | 特点 |
|------|----------|------|
| `stdio` | 本地进程（最常用） | 最简单，通过子进程 stdin/stdout 通信 |
| `sse` | 远程 HTTP 长连接 | 支持 OAuth 认证、Step-up 检测 |
| `ws` / `ws-ide` | IDE 集成 | 长连接，低延迟，适合实时同步 |
| `http` / `streamable-http` | claude.ai 代理 | 自动 Token Refresh，透明重连 |

连接通过 `memoize` 缓存，缓存键是 `name + JSON(serverRef)`。这意味着同一个 server 配置只会建立一次连接，即使多次调用 `connectToServer()`。

### [2] Bun 运行时的超时规避

`wrapFetchWithTimeout()` 不用更简洁的 `AbortSignal.timeout()`，而是用 `setTimeout + AbortController`。原因是 Bun 运行时中 `AbortSignal.timeout()` 存在内存泄漏——每个请求约 2.4KB 在 GC 前一直残留。

另一个细节：GET 请求不加超时，因为 SSE 是通过 GET 建立的长连接，加超时会导致连接被意外切断。

### [3] 认证雪崩防护的设计

传统做法是对 Token Refresh 加锁，但 Claude Code 选择了更简单的方案：
- 认证失败后写入本地文件缓存（`~/.claude/mcp-needs-auth-cache.json`）
- 15 分钟 TTL 内，所有对该 Server 的调用直接短路返回 `needs-auth`
- Promise 结果 memoize，避免并发读同一文件

这种"fail-fast + 时间衰减"的方案比加锁更简洁，代价是可能有几个请求在缓存写入前重复失败，但不会形成雪崩。

### [4] 描述长度截断

```typescript
const MAX_MCP_DESCRIPTION_LENGTH = 2048
```

OpenAPI 生成的 MCP Server 经常把 15-60KB 的 endpoint 文档塞进 `tool.description`。如果不截断，这些超长描述会挤占模型的 Context Window，影响所有工具的使用效果。2048 字符足以保留工具意图，同时控制 p95 尾部。

### [5] MCP 工具在权限系统中的待遇

MCP 工具进入工具池后，和内建工具走完全相同的权限检查路径：
- `checkPermissions()` — 权限判定
- PreToolUse Hooks — 前置拦截
- `filterToolsByDenyRules()` — 规则过滤

唯一的区别是：内建工具在 `assembleToolPool()` 中优先级更高，同名冲突时 MCP 工具被静默丢弃。

## 代码索引

- `src/services/mcp/client.ts:595` — `connectToServer()` 连接管理（memoize + 四种传输）
- `src/services/mcp/client.ts:492` — `wrapFetchWithTimeout()` 超时控制
- `src/services/mcp/client.ts:259` — 认证雪崩防护（Auth Cache）
- `src/services/mcp/client.ts:193` — `isMcpSessionExpiredError()` Session 过期检测
- `src/services/mcp/client.ts:372` — `createClaudeAiProxyFetch()` claude.ai 代理
- `src/services/mcp/client.ts:569` — IDE 工具白名单
- `src/services/mcp/client.ts:218` — `MAX_MCP_DESCRIPTION_LENGTH` 描述截断
- `src/services/mcp/mcpStringUtils.ts` — `buildMcpToolName()` 命名规则
- `src/services/mcp/auth.ts` — OAuth 认证 + Step-up 检测
- `src/utils/mcpWebSocketTransport.ts` — WebSocket 传输层实现
- `src/entrypoints/mcp.ts` — MCP Server 形态入口
- `src/tools.ts:345` — `assembleToolPool()` MCP 工具融合
