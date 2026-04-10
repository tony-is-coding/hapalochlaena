# Phase 1a: Backend Core Implementation Plan (Part 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete cc_core integration, services, API routes, and end-to-end testing

**Architecture:** Integrate cc_core via `query()` API, implement session lifecycle, build Fastify API routes

**Tech Stack:** Node.js 20, TypeScript 5, Fastify 4, cc_core integration

---

## Task 6: cc_core Integration Layer

**Files:**
- Create: `cc_ee/src/core/types.ts`
- Create: `cc_ee/src/core/session-store.ts`
- Create: `cc_ee/src/core/init.ts`
- Create: `cc_ee/src/core/session-runner.ts`
- Create: `cc_ee/src/core/hook-callbacks.ts`

- [ ] **Step 1: Create types.ts**

```typescript
// src/core/types.ts
import type { SessionId } from '../../../cc_core/bootstrap/state'

export interface SessionInfo {
  tenantId: string
  userId: string
  tenantCwd: string
}

export interface SessionContext {
  sessionId: SessionId
  sessionProjectDir: string | null
  originalCwd: string
  projectRoot: string
  modelUsage: Record<string, any>
  totalCostUSD: number
  totalAPIDuration: number
  totalToolDuration: number
  totalLinesAdded: number
  totalLinesRemoved: number
  sessionBypassPermissionsMode: boolean
}
```

- [ ] **Step 2: Create session-store.ts**

```typescript
// src/core/session-store.ts
import type { SessionId } from '../../../cc_core/bootstrap/state'
import type { SessionInfo } from './types'

class SessionStore {
  private store = new Map<SessionId, SessionInfo>()

  set(sessionId: SessionId, info: SessionInfo): void {
    this.store.set(sessionId, info)
  }

  get(sessionId: SessionId): SessionInfo | undefined {
    return this.store.get(sessionId)
  }

  delete(sessionId: SessionId): void {
    this.store.delete(sessionId)
  }

  has(sessionId: SessionId): boolean {
    return this.store.has(sessionId)
  }
}

export const sessionStore = new SessionStore()
```

- [ ] **Step 3: Create init.ts with HookCallbacks**

```typescript
// src/core/init.ts
import { registerHookCallbacks, setOriginalCwd, getSessionId } from '../../../cc_core/bootstrap/state'
import { sessionStore } from './session-store'
import { tokenService } from '../services/token.service'
import { auditService } from '../services/audit.service'
import { tenantService } from '../services/tenant.service'

export async function initCcCore(baseCwd: string): Promise<void> {
  // Set process base cwd
  setOriginalCwd(baseCwd)

  // Register global HookCallbacks
  registerHookCallbacks({
    PreToolUse: [
      {
        matcher: '*',
        hooks: [
          {
            type: 'callback',
            callback: async (input, toolUseID, signal) => {
              const sessionId = getSessionId()
              const sessionInfo = sessionStore.get(sessionId)

              if (!sessionInfo) {
                return { decision: 'block', reason: 'Session not found' }
              }

              const { tenantId, userId } = sessionInfo

              // Check token budget
              const period = new Date().toISOString().slice(0, 7) // YYYY-MM
              const budget = await tokenService.checkBudget(tenantId, period)

              if (budget.used >= budget.total) {
                await auditService.log({
                  sessionId: sessionId as string,
                  tenantId,
                  userId,
                  toolName: input.tool_name,
                  decision: 'block',
                  reason: 'budget_exhausted',
                })
                return {
                  decision: 'block',
                  reason: 'Token budget exhausted for this month. Contact your administrator.',
                }
              }

              // Check deny rules
              const tenant = await tenantService.getTenant(tenantId)
              if (tenant) {
                const denyRules = tenant.permissionRules.deny || []
                for (const rule of denyRules) {
                  if (rule === input.tool_name || rule === '*') {
                    await auditService.log({
                      sessionId: sessionId as string,
                      tenantId,
                      userId,
                      toolName: input.tool_name,
                      decision: 'block',
                      reason: 'deny_rule',
                      matchedRule: rule,
                    })
                    return {
                      decision: 'block',
                      reason: `Tool blocked by tenant policy: ${rule}`,
                    }
                  }
                }
              }

              // Log approval
              await auditService.log({
                sessionId: sessionId as string,
                tenantId,
                userId,
                toolName: input.tool_name,
                decision: 'allow',
              })

              return { decision: 'approve' }
            },
          },
        ],
      },
    ],
  })
}
```

- [ ] **Step 4: Create session-runner.ts**

```typescript
// src/core/session-runner.ts
import { query } from '../../../cc_core/query'
import { runWithCwdOverride } from '../../../cc_core/utils/cwd'
import { sessionStore } from './session-store'
import { tokenService } from '../services/token.service'

export class SessionRunner {
  async *run(sessionId: string, params: any): AsyncGenerator<any> {
    const sessionInfo = sessionStore.get(sessionId as any)
    if (!sessionInfo) {
      throw new Error(`Session ${sessionId} not found`)
    }

    const { tenantId, tenantCwd } = sessionInfo

    // Execute query in per-session cwd context
    const gen = runWithCwdOverride(tenantCwd, () => query(params))

    // Consume generator and extract token usage
    for await (const event of gen) {
      // Extract token usage from AssistantMessage
      if (event.type === 'assistant' && event.message?.usage) {
        const { input_tokens, output_tokens } = event.message.usage
        const total = input_tokens + output_tokens
        const period = new Date().toISOString().slice(0, 7)

        // Atomic update token ledger (async, non-blocking)
        tokenService
          .incrementUsage(tenantId, period, total)
          .catch((err) => console.error('Failed to update token ledger:', err))
      }

      yield event
    }
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add cc_ee/src/core/
git commit -m "feat(cc_ee): add cc_core integration layer

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Service Layer

**Files:**
- Create: `cc_ee/src/services/token.service.ts`
- Create: `cc_ee/src/services/audit.service.ts`
- Create: `cc_ee/src/services/session.service.ts`

- [ ] **Step 1: Create token.service.ts**

```typescript
// src/services/token.service.ts
import { tokenLedgerRepo } from '../repositories/token-ledger.repo'

class TokenService {
  async checkBudget(tenantId: string, period: string): Promise<{ total: number; used: number }> {
    const ledger = await tokenLedgerRepo.findByTenantAndPeriod(tenantId, period)
    if (!ledger) {
      return { total: 0, used: 0 }
    }
    return { total: ledger.totalBudget, used: ledger.used }
  }

  async incrementUsage(tenantId: string, period: string, tokens: number): Promise<void> {
    await tokenLedgerRepo.incrementUsage(tenantId, period, tokens)
  }

  async initializePeriod(tenantId: string, period: string, totalBudget: number): Promise<void> {
    await tokenLedgerRepo.initializePeriod(tenantId, period, totalBudget)
  }
}

export const tokenService = new TokenService()
```

- [ ] **Step 2: Create audit.service.ts**

```typescript
// src/services/audit.service.ts
import { pool } from '../config/database'

interface AuditLogInput {
  sessionId: string
  tenantId: string
  userId: string
  toolName: string
  decision: 'allow' | 'block'
  reason?: string
  matchedRule?: string
}

class AuditService {
  async log(input: AuditLogInput): Promise<void> {
    await pool.query(
      `INSERT INTO tool_audit_logs (session_id, tenant_id, user_id, tool_name, hook_decision, block_reason, matched_rule)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.sessionId,
        input.tenantId,
        input.userId,
        input.toolName,
        input.decision,
        input.reason || null,
        input.matchedRule || null,
      ]
    )
  }
}

export const auditService = new AuditService()
```

- [ ] **Step 3: Create session.service.ts**

```typescript
// src/services/session.service.ts
import { sessionRepo } from '../repositories/session.repo'
import { sessionStore } from '../core/session-store'
import fs from 'fs-extra'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

class SessionService {
  async createSession(params: {
    tenantId: string
    userId: string
    projectPath?: string
  }): Promise<{ sessionId: string }> {
    const { tenantId, userId, projectPath = '/default' } = params

    const sessionId = uuidv4()
    const tenantCwd = `/tmp/cc_ee_sessions/${tenantId}/${sessionId}`

    // Create working directory
    await fs.ensureDir(tenantCwd)
    await fs.ensureDir(path.join(tenantCwd, '.claude/skills'))

    // Insert into database
    await sessionRepo.create({
      id: sessionId,
      tenantId,
      userId,
      workingDir: tenantCwd,
      nodeId: process.env.NODE_ID || 'local',
    })

    // Register in-process mapping
    sessionStore.set(sessionId as any, { tenantId, userId, tenantCwd })

    return { sessionId }
  }

  async terminateSession(sessionId: string, tenantId: string, userId: string): Promise<void> {
    const session = await sessionRepo.findById(sessionId)
    if (!session || session.tenantId !== tenantId || session.userId !== userId) {
      throw new Error('Session not found or access denied')
    }

    // Update database
    await sessionRepo.update(sessionId, { status: 'terminated' })

    // Clean up in-process mapping
    sessionStore.delete(sessionId as any)

    // Clean up working directory (async)
    fs.remove(session.workingDir).catch(console.error)
  }
}

export const sessionService = new SessionService()
```

- [ ] **Step 4: Create tenant.service.ts**

```typescript
// src/services/tenant.service.ts
import { tenantRepo } from '../repositories/tenant.repo'
import { Tenant } from '../models/tenant'

class TenantService {
  async getTenant(tenantId: string): Promise<Tenant | null> {
    return tenantRepo.findById(tenantId)
  }

  async createTenant(input: { name: string; tokenBudgetMonthly?: number }): Promise<Tenant> {
    return tenantRepo.create(input)
  }
}

export const tenantService = new TenantService()
```

- [ ] **Step 5: Commit**

```bash
git add cc_ee/src/services/
git commit -m "feat(cc_ee): add service layer

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: API Routes

**Files:**
- Create: `cc_ee/src/api/routes/sessions.ts`
- Create: `cc_ee/src/api/routes/tenants.ts`
- Create: `cc_ee/src/api/routes/users.ts`
- Create: `cc_ee/src/api/middleware/auth.ts`

- [ ] **Step 1: Create auth middleware**

```typescript
// src/api/middleware/auth.ts
import { FastifyRequest, FastifyReply } from 'fastify'

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  try {
    await request.jwtVerify()
  } catch (err) {
    reply.code(401).send({ error: 'Unauthorized' })
  }
}
```

- [ ] **Step 2: Create sessions.ts routes**

```typescript
// src/api/routes/sessions.ts
import { FastifyInstance } from 'fastify'
import { sessionService } from '../../services/session.service'
import { SessionRunner } from '../../core/session-runner'
import { authMiddleware } from '../middleware/auth'

export async function sessionRoutes(fastify: FastifyInstance) {
  const sessionRunner = new SessionRunner()

  // Create session
  fastify.post('/api/sessions', {
    preHandler: [authMiddleware],
    handler: async (request, reply) => {
      const { userId, tenantId } = request.user as any
      const { projectPath } = request.body as any

      const session = await sessionService.createSession({
        tenantId,
        userId,
        projectPath,
      })

      return { sessionId: session.sessionId }
    },
  })

  // Send message (SSE streaming)
  fastify.post('/api/sessions/:sessionId/query', {
    preHandler: [authMiddleware],
    handler: async (request, reply) => {
      const { sessionId } = request.params as any
      const { message } = request.body as any

      // Set SSE headers
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })

      // Build QueryParams (simplified)
      const params = {
        messages: [{ role: 'user', content: message }],
        systemPrompt: { sections: [] },
        userContext: {},
        systemContext: {},
        canUseTool: () => true,
        toolUseContext: {},
        querySource: 'cc_ee',
      }

      try {
        for await (const event of sessionRunner.run(sessionId, params)) {
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
        }
      } catch (error: any) {
        reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: error.message })}\n\n`)
      } finally {
        reply.raw.end()
      }
    },
  })

  // Terminate session
  fastify.delete('/api/sessions/:sessionId', {
    preHandler: [authMiddleware],
    handler: async (request, reply) => {
      const { sessionId } = request.params as any
      const { userId, tenantId } = request.user as any

      await sessionService.terminateSession(sessionId, tenantId, userId)
      return { success: true }
    },
  })
}
```

- [ ] **Step 3: Create tenants.ts routes**

```typescript
// src/api/routes/tenants.ts
import { FastifyInstance } from 'fastify'
import { tenantService } from '../../services/tenant.service'

export async function tenantRoutes(fastify: FastifyInstance) {
  fastify.post('/api/tenants', {
    handler: async (request, reply) => {
      const { name, tokenBudgetMonthly } = request.body as any

      const tenant = await tenantService.createTenant({
        name,
        tokenBudgetMonthly,
      })

      return tenant
    },
  })
}
```

- [ ] **Step 4: Create users.ts routes**

```typescript
// src/api/routes/users.ts
import { FastifyInstance } from 'fastify'
import { userRepo } from '../../repositories/user.repo'

export async function userRoutes(fastify: FastifyInstance) {
  fastify.post('/api/users', {
    handler: async (request, reply) => {
      const { tenantId, email, password, role } = request.body as any

      const user = await userRepo.create({
        tenantId,
        email,
        password,
        role,
      })

      return { id: user.id, email: user.email, role: user.role }
    },
  })
}
```

- [ ] **Step 5: Commit**

```bash
git add cc_ee/src/api/
git commit -m "feat(cc_ee): add API routes

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Main Entry Point

**Files:**
- Create: `cc_ee/src/index.ts`

- [ ] **Step 1: Create index.ts**

```typescript
// src/index.ts
import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fastifyCors from '@fastify/cors'
import { config } from './config/env'
import { initCcCore } from './core/init'
import { sessionRoutes } from './api/routes/sessions'
import { tenantRoutes } from './api/routes/tenants'
import { userRoutes } from './api/routes/users'

async function start() {
  // Initialize cc_core
  await initCcCore(config.ccCore.baseCwd)

  // Create Fastify instance
  const fastify = Fastify({
    logger: true,
    bodyLimit: 10 * 1024 * 1024,
  })

  // Register plugins
  await fastify.register(fastifyJwt, {
    secret: config.jwtSecret,
  })

  await fastify.register(fastifyCors, {
    origin: true,
    credentials: true,
  })

  // Register routes
  await fastify.register(sessionRoutes)
  await fastify.register(tenantRoutes)
  await fastify.register(userRoutes)

  // Health check
  fastify.get('/health', async () => {
    return { status: 'healthy', version: '1.0.0' }
  })

  // Start server
  await fastify.listen({
    port: config.port,
    host: '0.0.0.0',
  })

  console.log(`Server listening on port ${config.port}`)
}

start().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
```

- [ ] **Step 2: Test server startup**

```bash
npm run dev
```

Expected: "Server listening on port 3000"

- [ ] **Step 3: Test health endpoint**

```bash
curl http://localhost:3000/health
```

Expected: `{"status":"healthy","version":"1.0.0"}`

- [ ] **Step 4: Commit**

```bash
git add cc_ee/src/index.ts
git commit -m "feat(cc_ee): add main entry point

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Integration Test

**Files:**
- Create: `cc_ee/tests/integration/session.test.ts`

- [ ] **Step 1: Install test dependencies**

```bash
npm install --save-dev vitest @vitest/ui
```

- [ ] **Step 2: Create integration test**

```typescript
// tests/integration/session.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { pool } from '../../src/config/database'
import { tenantService } from '../../src/services/tenant.service'
import { userRepo } from '../../src/repositories/user.repo'
import { sessionService } from '../../src/services/session.service'

describe('Session Integration Test', () => {
  let tenantId: string
  let userId: string

  beforeAll(async () => {
    // Create test tenant
    const tenant = await tenantService.createTenant({
      name: 'Test Tenant',
      tokenBudgetMonthly: 1000000,
    })
    tenantId = tenant.id

    // Create test user
    const user = await userRepo.create({
      tenantId,
      email: 'test@example.com',
      password: 'password123',
      role: 'member',
    })
    userId = user.id
  })

  afterAll(async () => {
    // Cleanup
    await pool.query('DELETE FROM users WHERE tenant_id = $1', [tenantId])
    await pool.query('DELETE FROM tenants WHERE id = $1', [tenantId])
    await pool.end()
  })

  it('should create a session', async () => {
    const session = await sessionService.createSession({
      tenantId,
      userId,
      projectPath: '/test',
    })

    expect(session.sessionId).toBeDefined()
    expect(typeof session.sessionId).toBe('string')
  })

  it('should terminate a session', async () => {
    const session = await sessionService.createSession({
      tenantId,
      userId,
      projectPath: '/test',
    })

    await sessionService.terminateSession(session.sessionId, tenantId, userId)

    const dbSession = await pool.query('SELECT * FROM sessions WHERE id = $1', [session.sessionId])
    expect(dbSession.rows[0].status).toBe('terminated')
  })
})
```

- [ ] **Step 3: Run tests**

```bash
npm test
```

Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add cc_ee/tests/
git commit -m "test(cc_ee): add integration tests

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Acceptance Criteria Verification

After completing all tasks, verify:

- [ ] Can create tenant via API
- [ ] Can create user via API
- [ ] Can start session and send messages via API
- [ ] PreToolUse HookCallback blocks tools and returns reason to model
- [ ] Token usage extracted from AssistantMessage.usage and written to token_ledgers
- [ ] Session terminates successfully
- [ ] Integration tests pass

---

## Next Steps

After Phase 1a completion:
1. Proceed to [Phase 1b: Frontend Integration](./2026-04-09-phase-1b-frontend-integration.md)
2. Implement React Web UI
3. Add JWT authentication
4. Build admin dashboard
