# cc_ee 后端架构设计

**版本**: 1.0
**基于**: cc_ee 整体架构 v3.0

---

## 1. 目录结构

```
cc_ee/
├── cc_core/                    # Claude Code 核心源码（已存在）
├── src/
│   ├── index.ts               # 主入口，启动 Fastify 服务器
│   ├── config/
│   │   ├── database.ts        # PostgreSQL 连接配置
│   │   ├── oss.ts            # OSS 配置（阿里云/AWS S3）
│   │   └── env.ts            # 环境变量管理
│   │
│   ├── core/                  # cc_core 集成层
│   │   ├── init.ts           # initCcCore() - 进程启动初始化
│   │   ├── session-runner.ts # SessionRunner - 封装 query() 调用
│   │   ├── hook-callbacks.ts # HookCallback 实现
│   │   └── types.ts          # cc_core 相关类型定义
│   │
│   ├── api/                   # API 路由层
│   │   ├── routes/
│   │   │   ├── auth.ts       # 认证相关路由
│   │   │   ├── tenants.ts    # 租户管理
│   │   │   ├── users.ts      # 用户管理
│   │   │   ├── sessions.ts   # Session 管理
│   │   │   ├── skills.ts     # Skill 管理
│   │   │   └── admin.ts      # 管理后台 API
│   │   ├── middleware/
│   │   │   ├── auth.ts       # JWT 认证中间件
│   │   │   ├── rate-limit.ts # 限流中间件
│   │   │   └── error.ts      # 错误处理中间件
│   │   └── schemas/          # Fastify JSON Schema 验证
│   │       ├── auth.ts
│   │       ├── session.ts
│   │       └── tenant.ts
│   │
│   ├── services/              # 业务逻辑层
│   │   ├── auth.service.ts   # 认证服务
│   │   ├── tenant.service.ts # 租户服务
│   │   ├── user.service.ts   # 用户服务
│   │   ├── session.service.ts # Session 生命周期管理
│   │   ├── skill.service.ts  # Skill 管理服务
│   │   ├── token.service.ts  # Token 计费服务
│   │   └── audit.service.ts  # 审计日志服务
│   │
│   ├── repositories/          # 数据访问层
│   │   ├── tenant.repo.ts
│   │   ├── user.repo.ts
│   │   ├── session.repo.ts
│   │   ├── skill.repo.ts
│   │   ├── token-ledger.repo.ts
│   │   └── audit-log.repo.ts
│   │
│   ├── models/                # 数据模型（TypeScript 类型）
│   │   ├── tenant.ts
│   │   ├── user.ts
│   │   ├── session.ts
│   │   ├── skill.ts
│   │   └── token.ts
│   │
│   ├── utils/                 # 工具函数
│   │   ├── jwt.ts            # JWT 生成/验证
│   │   ├── crypto.ts         # 加密工具
│   │   ├── oss.ts            # OSS 上传/下载
│   │   └── logger.ts         # 日志工具
│   │
│   └── websocket/             # WebSocket 处理
│       ├── handler.ts        # WebSocket 连接管理
│       └── events.ts         # WebSocket 事件定义
│
├── migrations/                # 数据库迁移脚本
│   ├── 001_init_schema.sql
│   ├── 002_add_skills.sql
│   └── ...
│
├── tests/                     # 测试
│   ├── unit/
│   ├── integration/
│   └── e2e/
│
├── package.json
├── tsconfig.json
└── .env.example
```

---

## 2. 核心模块设计

### 2.1 主入口 (`src/index.ts`)

```typescript
import Fastify from 'fastify'
import fastifyWebsocket from '@fastify/websocket'
import fastifyJwt from '@fastify/jwt'
import { initCcCore } from './core/init'
import { registerRoutes } from './api/routes'
import { config } from './config/env'

async function start() {
  // 1. 初始化 cc_core（注册 HookCallbacks）
  await initCcCore(config.baseCwd)

  // 2. 创建 Fastify 实例
  const fastify = Fastify({
    logger: true,
    bodyLimit: 10 * 1024 * 1024, // 10MB
  })

  // 3. 注册插件
  await fastify.register(fastifyJwt, {
    secret: config.jwtSecret,
  })
  await fastify.register(fastifyWebsocket)

  // 4. 注册路由
  await registerRoutes(fastify)

  // 5. 启动服务器
  await fastify.listen({
    port: config.port,
    host: '0.0.0.0',
  })

  console.log(`Server listening on ${config.port}`)
}

start().catch(console.error)
```

---

### 2.2 cc_core 集成层 (`src/core/`)

#### 2.2.1 `init.ts` - 进程启动初始化

```typescript
import {
  registerHookCallbacks,
  setOriginalCwd,
  getSessionId,
} from 'cc_core/bootstrap/state'
import { sessionStore } from './session-store'
import { tokenService } from '../services/token.service'
import { auditService } from '../services/audit.service'
import { tenantService } from '../services/tenant.service'

export async function initCcCore(baseCwd: string) {
  // 设置进程基础 cwd
  setOriginalCwd(baseCwd)

  // 注册全局 HookCallback
  registerHookCallbacks({
    PreToolUse: [
      {
        matcher: '*', // 匹配所有工具
        hooks: [
          {
            type: 'callback',
            callback: async (input, toolUseID, signal) => {
              // 1. 获取当前 session ID（AsyncLocalStorage 自动路由）
              const sessionId = getSessionId()
              const sessionInfo = sessionStore.get(sessionId)

              if (!sessionInfo) {
                return {
                  decision: 'block',
                  reason: 'Session not found',
                }
              }

              const { tenantId, userId } = sessionInfo

              // 2. 检查 token 预算（乐观读）
              const budget = await tokenService.checkBudget(tenantId)
              if (budget.used >= budget.total) {
                await auditService.log({
                  sessionId,
                  tenantId,
                  userId,
                  decision: 'block',
                  reason: 'budget_exhausted',
                  toolName: input.tool_name,
                })
                return {
                  decision: 'block',
                  reason: 'Token budget exhausted for this month. Contact your administrator.',
                }
              }

              // 3. 检查 deny 规则
              const tenant = await tenantService.getTenant(tenantId)
              const matchedRule = matchDenyRules(tenant.permissionRules.deny, input)
              if (matchedRule) {
                await auditService.log({
                  sessionId,
                  tenantId,
                  userId,
                  decision: 'block',
                  reason: 'deny_rule',
                  toolName: input.tool_name,
                  ruleMatched: matchedRule,
                })
                return {
                  decision: 'block',
                  reason: `Tool blocked by tenant policy: ${matchedRule}`,
                }
              }

              // 4. 记录审计日志（允许）
              await auditService.log({
                sessionId,
                tenantId,
                userId,
                decision: 'allow',
                toolName: input.tool_name,
              })

              return { decision: 'approve' }
            },
          },
        ],
      },
    ],
  })
}

// 简单的 deny 规则匹配（示例）
function matchDenyRules(rules: any[], input: any): string | null {
  for (const rule of rules) {
    if (rule.toolName === input.tool_name || rule.toolName === '*') {
      // 可以添加更复杂的匹配逻辑（参数匹配等）
      return rule.description || rule.toolName
    }
  }
  return null
}
```

#### 2.2.2 `session-runner.ts` - Session 运行器

```typescript
import { query, QueryParams } from 'cc_core/query'
import { runWithCwdOverride } from 'cc_core/utils/cwd'
import { runWithSessionOverride, buildSessionContext } from 'cc_core/utils/sessionState'
import { tokenService } from '../services/token.service'
import { sessionStore } from './session-store'

export class SessionRunner {
  /**
   * 执行一次 query turn（并发安全版）
   */
  async *run(
    sessionId: string,
    params: QueryParams
  ): AsyncGenerator<any> {
    const sessionInfo = sessionStore.get(sessionId)
    if (!sessionInfo) {
      throw new Error(`Session ${sessionId} not found`)
    }

    const { tenantId, tenantCwd } = sessionInfo

    // 1. 构建 per-session STATE 上下文
    const ctx = await buildSessionContext(sessionId)

    // 2. 在双层 ALS 上下文中执行 query
    const gen = runWithSessionOverride(ctx, () =>
      runWithCwdOverride(tenantCwd, () => query(params))
    )

    // 3. 消费 generator，提取 token usage
    for await (const event of gen) {
      // 提取 token usage
      if (event.type === 'assistant' && event.message?.usage) {
        const { input_tokens, output_tokens } = event.message.usage
        const total = input_tokens + output_tokens

        // 原子更新 token ledger（异步，不阻塞）
        tokenService
          .incrementUsage(tenantId, total)
          .catch((err) => console.error('Failed to update token ledger:', err))
      }

      yield event
    }
  }
}
```

#### 2.2.3 `session-store.ts` - 进程内 Session 映射

```typescript
import { SessionId } from 'cc_core/bootstrap/state'

interface SessionInfo {
  tenantId: string
  userId: string
  tenantCwd: string
}

class SessionStore {
  private store = new Map<SessionId, SessionInfo>()

  set(sessionId: SessionId, info: SessionInfo) {
    this.store.set(sessionId, info)
  }

  get(sessionId: SessionId): SessionInfo | undefined {
    return this.store.get(sessionId)
  }

  delete(sessionId: SessionId) {
    this.store.delete(sessionId)
  }
}

export const sessionStore = new SessionStore()
```

---

### 2.3 API 路由层 (`src/api/routes/`)

#### 2.3.1 `sessions.ts` - Session 管理路由

```typescript
import { FastifyInstance } from 'fastify'
import { sessionService } from '../../services/session.service'
import { SessionRunner } from '../../core/session-runner'

export async function sessionRoutes(fastify: FastifyInstance) {
  const sessionRunner = new SessionRunner()

  // 创建 Session
  fastify.post('/api/sessions', {
    schema: {
      body: {
        type: 'object',
        required: ['projectPath'],
        properties: {
          projectPath: { type: 'string' },
          initialMessage: { type: 'string' },
        },
      },
    },
    preHandler: [fastify.authenticate], // JWT 认证
    handler: async (request, reply) => {
      const { userId, tenantId } = request.user
      const { projectPath, initialMessage } = request.body

      const session = await sessionService.createSession({
        tenantId,
        userId,
        projectPath,
      })

      return { sessionId: session.id }
    },
  })

  // 发送消息（SSE 流式响应）
  fastify.post('/api/sessions/:sessionId/query', {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const { sessionId } = request.params
      const { message } = request.body
      const { userId, tenantId } = request.user

      // 验证 session 所有权
      const session = await sessionService.getSession(sessionId)
      if (session.tenantId !== tenantId || session.userId !== userId) {
        return reply.code(403).send({ error: 'Forbidden' })
      }

      // 设置 SSE 响应头
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })

      // 构建 QueryParams
      const params = await sessionService.buildQueryParams(sessionId, message)

      // 执行 query，流式返回
      try {
        for await (const event of sessionRunner.run(sessionId, params)) {
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
        }
      } catch (error) {
        reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`)
      } finally {
        reply.raw.end()
      }
    },
  })

  // 终止 Session
  fastify.delete('/api/sessions/:sessionId', {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const { sessionId } = request.params
      const { userId, tenantId } = request.user

      await sessionService.terminateSession(sessionId, tenantId, userId)
      return { success: true }
    },
  })

  // 列出 Sessions
  fastify.get('/api/sessions', {
    preHandler: [fastify.authenticate],
    handler: async (request, reply) => {
      const { userId, tenantId } = request.user
      const sessions = await sessionService.listSessions(tenantId, userId)
      return { sessions }
    },
  })
}
```

---

### 2.4 服务层 (`src/services/`)

#### 2.4.1 `session.service.ts` - Session 生命周期管理

```typescript
import { sessionRepo } from '../repositories/session.repo'
import { skillService } from './skill.service'
import { ossUtil } from '../utils/oss'
import { sessionStore } from '../core/session-store'
import fs from 'fs-extra'
import path from 'path'
import tar from 'tar'

class SessionService {
  /**
   * 创建新 Session
   */
  async createSession(params: {
    tenantId: string
    userId: string
    projectPath: string
  }) {
    const { tenantId, userId, projectPath } = params

    // 1. 生成 session ID
    const sessionId = generateSessionId()

    // 2. 创建工作目录
    const tenantCwd = `/sessions/${tenantId}/${sessionId}`
    await fs.ensureDir(tenantCwd)
    await fs.ensureDir(path.join(tenantCwd, '.claude/skills'))

    // 3. 写入 Skill 文件
    const skills = await skillService.getActivatedSkills(tenantId)
    for (const skill of skills) {
      await fs.writeFile(
        path.join(tenantCwd, '.claude/skills', `${skill.name}.md`),
        skill.content
      )
    }

    // 4. 插入数据库
    const session = await sessionRepo.create({
      id: sessionId,
      tenantId,
      userId,
      workingDir: tenantCwd,
      status: 'active',
      nodeId: process.env.NODE_ID || 'local',
    })

    // 5. 注册进程内映射
    sessionStore.set(sessionId, { tenantId, userId, tenantCwd })

    return session
  }

  /**
   * 终止 Session 并归档
   */
  async terminateSession(sessionId: string, tenantId: string, userId: string) {
    const session = await sessionRepo.findById(sessionId)
    if (!session || session.tenantId !== tenantId || session.userId !== userId) {
      throw new Error('Session not found or access denied')
    }

    // 1. 打包工作目录
    const archivePath = `/tmp/${sessionId}.tar.gz`
    await tar.create(
      {
        gzip: true,
        file: archivePath,
        cwd: path.dirname(session.workingDir),
      },
      [path.basename(session.workingDir)]
    )

    // 2. 上传到 OSS
    const ossPath = `archives/${tenantId}/${sessionId}/${Date.now()}.tar.gz`
    await ossUtil.upload(archivePath, ossPath)

    // 3. 更新数据库
    await sessionRepo.update(sessionId, {
      status: 'terminated',
      ossArchivePath: ossPath,
    })

    // 4. 清理本地工作目录（异步）
    fs.remove(session.workingDir).catch(console.error)

    // 5. 清理进程内映射
    sessionStore.delete(sessionId)
  }

  /**
   * 恢复 Session
   */
  async resumeSession(sessionId: string, tenantId: string, userId: string) {
    const session = await sessionRepo.findById(sessionId)
    if (!session || session.tenantId !== tenantId || session.userId !== userId) {
      throw new Error('Session not found or access denied')
    }

    if (session.status !== 'terminated') {
      throw new Error('Session is not terminated')
    }

    // 1. 从 OSS 下载归档
    const archivePath = `/tmp/${sessionId}.tar.gz`
    await ossUtil.download(session.ossArchivePath, archivePath)

    // 2. 解压到工作目录
    await tar.extract({
      file: archivePath,
      cwd: path.dirname(session.workingDir),
    })

    // 3. 重新写入 Skill 文件（可能有版本更新）
    const skills = await skillService.getActivatedSkills(tenantId)
    for (const skill of skills) {
      await fs.writeFile(
        path.join(session.workingDir, '.claude/skills', `${skill.name}.md`),
        skill.content
      )
    }

    // 4. 更新数据库
    await sessionRepo.update(sessionId, {
      status: 'active',
      nodeId: process.env.NODE_ID || 'local',
    })

    // 5. 注册进程内映射
    sessionStore.set(sessionId, {
      tenantId,
      userId,
      tenantCwd: session.workingDir,
    })

    return session
  }

  /**
   * 构建 QueryParams
   */
  async buildQueryParams(sessionId: string, userMessage: string) {
    // 从 transcript 加载历史消息
    const messages = await this.loadTranscript(sessionId)
    messages.push({ role: 'user', content: userMessage })

    // 构建 QueryParams（简化版）
    return {
      messages,
      systemPrompt: { sections: [] },
      userContext: {},
      systemContext: {},
      canUseTool: () => true,
      toolUseContext: {},
      querySource: 'cc_ee',
    }
  }

  private async loadTranscript(sessionId: string): Promise<any[]> {
    // 从 JSONL 文件加载历史消息
    // 实现略
    return []
  }
}

export const sessionService = new SessionService()

function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}
```

---

### 2.5 数据访问层 (`src/repositories/`)

#### 2.5.1 `session.repo.ts`

```typescript
import { pool } from '../config/database'

class SessionRepository {
  async create(data: {
    id: string
    tenantId: string
    userId: string
    workingDir: string
    status: string
    nodeId: string
  }) {
    const result = await pool.query(
      `INSERT INTO sessions (id, tenant_id, user_id, working_dir, status, node_id, created_at, last_active_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       RETURNING *`,
      [data.id, data.tenantId, data.userId, data.workingDir, data.status, data.nodeId]
    )
    return result.rows[0]
  }

  async findById(id: string) {
    const result = await pool.query('SELECT * FROM sessions WHERE id = $1', [id])
    return result.rows[0]
  }

  async update(id: string, data: Partial<any>) {
    const fields = Object.keys(data)
      .map((key, i) => `${key} = $${i + 2}`)
      .join(', ')
    const values = Object.values(data)

    await pool.query(`UPDATE sessions SET ${fields} WHERE id = $1`, [id, ...values])
  }

  async listByTenantAndUser(tenantId: string, userId: string) {
    const result = await pool.query(
      'SELECT * FROM sessions WHERE tenant_id = $1 AND user_id = $2 ORDER BY created_at DESC',
      [tenantId, userId]
    )
    return result.rows
  }
}

export const sessionRepo = new SessionRepository()
```

---

## 3. 技术栈

| 组件 | 技术选型 | 版本 | 说明 |
|------|---------|------|------|
| **运行时** | Node.js | 20.x | LTS 版本 |
| **语言** | TypeScript | 5.x | 类型安全 |
| **Web 框架** | Fastify | 4.x | 高性能，原生 TypeScript 支持 |
| **数据库** | PostgreSQL | 15.x | 关系型数据库 |
| **ORM/查询** | node-postgres (pg) | 8.x | 原生 SQL，性能最优 |
| **认证** | @fastify/jwt | 7.x | JWT 认证 |
| **WebSocket** | @fastify/websocket | 8.x | 实时通信 |
| **OSS** | @aws-sdk/client-s3 | 3.x | S3 兼容存储 |
| **日志** | pino | 8.x | Fastify 内置，高性能 |
| **测试** | Vitest | 1.x | 快速单元测试 |
| **E2E 测试** | Playwright | 1.x | 端到端测试 |

---

## 4. 部署架构

```
┌─────────────────────────────────────────────────────────┐
│                    Load Balancer (Nginx)                 │
└──────────────────────────┬──────────────────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
┌───────▼────────┐ ┌───────▼────────┐ ┌───────▼────────┐
│  cc_ee Pod 1   │ │  cc_ee Pod 2   │ │  cc_ee Pod 3   │
│  (Node.js)     │ │  (Node.js)     │ │  (Node.js)     │
└───────┬────────┘ └───────┬────────┘ └───────┬────────┘
        │                  │                  │
        └──────────────────┼──────────────────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
┌───────▼────────┐ ┌───────▼────────┐ ┌───────▼────────┐
│  PostgreSQL    │ │  Redis Cache   │ │  OSS Storage   │
│  (Primary +    │ │  (租户配置/    │ │  (Session      │
│   Replicas)    │ │   Skill 缓存)  │ │   归档)        │
└────────────────┘ └────────────────┘ └────────────────┘
```

---

## 5. 关键设计决策

### 5.1 为什么选择 Fastify？

- **性能**：比 Express 快 2-3 倍
- **TypeScript 原生支持**：类型安全的路由和 schema 验证
- **插件生态**：JWT、WebSocket、CORS 等开箱即用
- **JSON Schema 验证**：内置请求/响应验证

### 5.2 为什么不用 ORM？

- **性能**：原生 SQL 性能最优，无 ORM 开销
- **灵活性**：复杂查询（如 token 原子更新）更直观
- **学习曲线**：团队熟悉 SQL，无需学习 ORM DSL

### 5.3 为什么用 node-postgres 而非 Prisma？

- **原子操作**：`UPDATE ... SET used = used + $1` 无需事务
- **性能**：无 ORM 层开销
- **迁移**：使用原生 SQL 迁移脚本，更可控

---

## 6. 下一步

1. **Phase 1a 实施**：按照 `09-roadmap.md` Phase 1a 任务清单实施
2. **数据库 Schema**：参考 `07-data-model.md` 创建迁移脚本
3. **API 协议**：参考 `12-api-protocol.md` 实现路由
4. **前端对接**：参考 `11-frontend-architecture.md` 对接 API
