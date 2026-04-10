# Phase 1a: Backend Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build single-tenant, single-user, single-session end-to-end working backend system

**Architecture:** Fastify backend wraps cc_core in same process, uses `query()` API with AsyncLocalStorage for session isolation, PostgreSQL for data persistence, OSS for session archives

**Tech Stack:** Node.js 20, TypeScript 5, Fastify 4, PostgreSQL 15, node-postgres 8, AWS SDK S3 3

---

## Prerequisites

Before starting, ensure:
- Node.js 20.x installed
- PostgreSQL 15.x installed and running
- cc_core repository cloned at `cc_ee/cc_core/`
- OSS/S3 compatible storage available (MinIO for local dev)

---

## File Structure Overview

```
cc_ee/
├── src/
│   ├── index.ts                    # Main entry point
│   ├── config/
│   │   ├── database.ts             # PostgreSQL connection
│   │   ├── oss.ts                  # OSS configuration
│   │   └── env.ts                  # Environment variables
│   ├── core/
│   │   ├── init.ts                 # cc_core initialization
│   │   ├── session-runner.ts       # SessionRunner class
│   │   ├── hook-callbacks.ts       # HookCallback implementations
│   │   ├── session-store.ts        # In-process session mapping
│   │   └── types.ts                # Type definitions
│   ├── api/
│   │   ├── routes/
│   │   │   ├── auth.ts             # Authentication routes
│   │   │   ├── tenants.ts          # Tenant management
│   │   │   ├── users.ts            # User management
│   │   │   └── sessions.ts         # Session management
│   │   ├── middleware/
│   │   │   ├── auth.ts             # JWT middleware
│   │   │   └── error.ts            # Error handling
│   │   └── schemas/
│   │       └── session.ts          # Request/response schemas
│   ├── services/
│   │   ├── auth.service.ts         # Authentication logic
│   │   ├── tenant.service.ts       # Tenant operations
│   │   ├── user.service.ts         # User operations
│   │   ├── session.service.ts      # Session lifecycle
│   │   ├── token.service.ts        # Token accounting
│   │   └── audit.service.ts        # Audit logging
│   ├── repositories/
│   │   ├── tenant.repo.ts          # Tenant data access
│   │   ├── user.repo.ts            # User data access
│   │   ├── session.repo.ts         # Session data access
│   │   ├── token-ledger.repo.ts    # Token ledger data access
│   │   └── audit-log.repo.ts       # Audit log data access
│   ├── models/
│   │   ├── tenant.ts               # Tenant types
│   │   ├── user.ts                 # User types
│   │   ├── session.ts              # Session types
│   │   └── token.ts                # Token types
│   └── utils/
│       ├── jwt.ts                  # JWT utilities
│       ├── crypto.ts               # Crypto utilities
│       ├── oss.ts                  # OSS utilities
│       └── logger.ts               # Logger setup
├── migrations/
│   └── 001_init_schema.sql        # Database schema
├── tests/
│   └── integration/
│       └── session.test.ts         # Integration tests
├── package.json
├── tsconfig.json
└── .env.example
```

---

## Task 1: Project Setup

**Files:**
- Create: `cc_ee/package.json`
- Create: `cc_ee/tsconfig.json`
- Create: `cc_ee/.env.example`
- Create: `cc_ee/.gitignore`

- [ ] **Step 1: Initialize package.json**

```bash
cd cc_ee
npm init -y
```

- [ ] **Step 2: Install dependencies**

```bash
npm install fastify @fastify/jwt @fastify/cors pg bcrypt jsonwebtoken uuid tar fs-extra
npm install --save-dev typescript @types/node @types/pg @types/bcrypt @types/jsonwebtoken @types/uuid @types/tar @types/fs-extra tsx vitest
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleResolution": "node",
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Create .env.example**

```env
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cc_ee
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=cc_ee
DATABASE_USER=postgres
DATABASE_PASSWORD=postgres

# Server
PORT=3000
NODE_ENV=development
JWT_SECRET=your-secret-key-change-in-production

# OSS (S3 compatible)
OSS_ENDPOINT=http://localhost:9000
OSS_ACCESS_KEY=minioadmin
OSS_SECRET_KEY=minioadmin
OSS_BUCKET=cc-ee-sessions
OSS_REGION=us-east-1

# cc_core
CC_CORE_BASE_CWD=/tmp/cc_ee_sessions
```

- [ ] **Step 5: Create .gitignore**

```
node_modules/
dist/
.env
.env.local
*.log
.DS_Store
/sessions/
```

- [ ] **Step 6: Add scripts to package.json**

```json
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest",
    "migrate": "node -r tsx/register migrations/run.ts"
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add cc_ee/package.json cc_ee/tsconfig.json cc_ee/.env.example cc_ee/.gitignore
git commit -m "feat(cc_ee): initialize project structure

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Database Schema

**Files:**
- Create: `cc_ee/migrations/001_init_schema.sql`
- Create: `cc_ee/migrations/run.ts`

- [ ] **Step 1: Create migration SQL**

```sql
-- migrations/001_init_schema.sql

-- Tenants table
CREATE TABLE tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  token_budget_monthly BIGINT NOT NULL DEFAULT 1000000,
  enabled_skill_ids TEXT[] DEFAULT '{}',
  permission_rules JSONB DEFAULT '{"allow": [], "deny": []}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Users table
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  email VARCHAR(255) NOT NULL UNIQUE,
  role VARCHAR(50) NOT NULL DEFAULT 'member',
  password_hash VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Sessions table
CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES users(id),
  working_dir VARCHAR(512) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  node_id VARCHAR(255),
  oss_archive_path VARCHAR(512),
  created_at TIMESTAMP DEFAULT NOW(),
  last_active_at TIMESTAMP DEFAULT NOW()
);

-- Token ledgers table
CREATE TABLE token_ledgers (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  period VARCHAR(7) NOT NULL,
  total_budget BIGINT NOT NULL,
  used BIGINT NOT NULL DEFAULT 0,
  last_updated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (tenant_id, period)
);

-- Tool audit logs table
CREATE TABLE tool_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES sessions(id),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID REFERENCES users(id),
  tool_name VARCHAR(255) NOT NULL,
  input_snapshot JSONB,
  hook_decision VARCHAR(50) NOT NULL,
  block_reason VARCHAR(255),
  matched_rule VARCHAR(255),
  timestamp TIMESTAMP DEFAULT NOW()
);

-- Skills table
CREATE TABLE skills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  slug VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  content TEXT NOT NULL,
  is_official BOOLEAN NOT NULL DEFAULT false,
  allowed_tools TEXT[],
  version VARCHAR(50) NOT NULL DEFAULT '1.0.0',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_sessions_tenant_user ON sessions(tenant_id, user_id);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_node ON sessions(node_id);
CREATE INDEX idx_tool_audit_logs_session ON tool_audit_logs(session_id);
CREATE INDEX idx_tool_audit_logs_tenant ON tool_audit_logs(tenant_id);
CREATE INDEX idx_tool_audit_logs_timestamp ON tool_audit_logs(timestamp);
```

- [ ] **Step 2: Create migration runner**

```typescript
// migrations/run.ts
import { Pool } from 'pg'
import fs from 'fs'
import path from 'path'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/cc_ee'
})

async function runMigration() {
  const sql = fs.readFileSync(path.join(__dirname, '001_init_schema.sql'), 'utf-8')

  try {
    await pool.query(sql)
    console.log('Migration completed successfully')
  } catch (error) {
    console.error('Migration failed:', error)
    process.exit(1)
  } finally {
    await pool.end()
  }
}

runMigration()
```

- [ ] **Step 3: Run migration**

```bash
npm run migrate
```

Expected: Tables created successfully

- [ ] **Step 4: Verify schema**

```bash
psql -U postgres -d cc_ee -c "\dt"
```

Expected: List of tables (tenants, users, sessions, token_ledgers, tool_audit_logs, skills)

- [ ] **Step 5: Commit**

```bash
git add cc_ee/migrations/
git commit -m "feat(cc_ee): add database schema migration

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Configuration Layer

**Files:**
- Create: `cc_ee/src/config/env.ts`
- Create: `cc_ee/src/config/database.ts`
- Create: `cc_ee/src/config/oss.ts`

- [ ] **Step 1: Create env.ts**

```typescript
// src/config/env.ts
import { config as dotenvConfig } from 'dotenv'

dotenvConfig()

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',

  database: {
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT || '5432', 10),
    database: process.env.DATABASE_NAME || 'cc_ee',
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || 'postgres',
  },

  oss: {
    endpoint: process.env.OSS_ENDPOINT || 'http://localhost:9000',
    accessKey: process.env.OSS_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.OSS_SECRET_KEY || 'minioadmin',
    bucket: process.env.OSS_BUCKET || 'cc-ee-sessions',
    region: process.env.OSS_REGION || 'us-east-1',
  },

  ccCore: {
    baseCwd: process.env.CC_CORE_BASE_CWD || '/tmp/cc_ee_sessions',
  },
}
```

- [ ] **Step 2: Create database.ts**

```typescript
// src/config/database.ts
import { Pool } from 'pg'
import { config } from './env'

export const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.database,
  user: config.database.user,
  password: config.database.password,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
})

pool.on('error', (err) => {
  console.error('Unexpected database error:', err)
})
```

- [ ] **Step 3: Create oss.ts**

```typescript
// src/config/oss.ts
import { S3Client } from '@aws-sdk/client-s3'
import { config } from './env'

export const s3Client = new S3Client({
  endpoint: config.oss.endpoint,
  region: config.oss.region,
  credentials: {
    accessKeyId: config.oss.accessKey,
    secretAccessKey: config.oss.secretKey,
  },
  forcePathStyle: true, // Required for MinIO
})
```

- [ ] **Step 4: Install AWS SDK**

```bash
npm install @aws-sdk/client-s3
```

- [ ] **Step 5: Test database connection**

```typescript
// Test in src/index.ts temporarily
import { pool } from './config/database'

pool.query('SELECT NOW()').then(res => {
  console.log('Database connected:', res.rows[0])
}).catch(err => {
  console.error('Database connection failed:', err)
})
```

- [ ] **Step 6: Run test**

```bash
npm run dev
```

Expected: "Database connected: { now: '2026-04-09...' }"

- [ ] **Step 7: Commit**

```bash
git add cc_ee/src/config/
git commit -m "feat(cc_ee): add configuration layer

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Data Models

**Files:**
- Create: `cc_ee/src/models/tenant.ts`
- Create: `cc_ee/src/models/user.ts`
- Create: `cc_ee/src/models/session.ts`
- Create: `cc_ee/src/models/token.ts`

- [ ] **Step 1: Create tenant.ts**

```typescript
// src/models/tenant.ts
export interface Tenant {
  id: string
  name: string
  status: 'active' | 'suspended' | 'deleted'
  tokenBudgetMonthly: number
  enabledSkillIds: string[]
  permissionRules: {
    allow: string[]
    deny: string[]
  }
  createdAt: Date
  updatedAt: Date
}

export interface CreateTenantInput {
  name: string
  tokenBudgetMonthly?: number
  permissionRules?: {
    allow: string[]
    deny: string[]
  }
}
```

- [ ] **Step 2: Create user.ts**

```typescript
// src/models/user.ts
export interface User {
  id: string
  tenantId: string
  email: string
  role: 'admin' | 'member'
  passwordHash: string
  createdAt: Date
}

export interface CreateUserInput {
  tenantId: string
  email: string
  password: string
  role?: 'admin' | 'member'
}
```

- [ ] **Step 3: Create session.ts**

```typescript
// src/models/session.ts
export interface Session {
  id: string
  tenantId: string
  userId: string
  workingDir: string
  status: 'active' | 'idle' | 'terminated'
  nodeId: string | null
  ossArchivePath: string | null
  createdAt: Date
  lastActiveAt: Date
}

export interface CreateSessionInput {
  tenantId: string
  userId: string
  projectPath?: string
}
```

- [ ] **Step 4: Create token.ts**

```typescript
// src/models/token.ts
export interface TokenLedger {
  tenantId: string
  period: string // YYYY-MM
  totalBudget: number
  used: number
  lastUpdatedAt: Date
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
}
```

- [ ] **Step 5: Commit**

```bash
git add cc_ee/src/models/
git commit -m "feat(cc_ee): add data models

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Repository Layer

**Files:**
- Create: `cc_ee/src/repositories/tenant.repo.ts`
- Create: `cc_ee/src/repositories/user.repo.ts`
- Create: `cc_ee/src/repositories/session.repo.ts`
- Create: `cc_ee/src/repositories/token-ledger.repo.ts`

- [ ] **Step 1: Create tenant.repo.ts**

```typescript
// src/repositories/tenant.repo.ts
import { pool } from '../config/database'
import { Tenant, CreateTenantInput } from '../models/tenant'

export class TenantRepository {
  async create(input: CreateTenantInput): Promise<Tenant> {
    const result = await pool.query(
      `INSERT INTO tenants (name, token_budget_monthly, permission_rules)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [
        input.name,
        input.tokenBudgetMonthly || 1000000,
        JSON.stringify(input.permissionRules || { allow: [], deny: [] })
      ]
    )
    return this.mapRow(result.rows[0])
  }

  async findById(id: string): Promise<Tenant | null> {
    const result = await pool.query(
      'SELECT * FROM tenants WHERE id = $1',
      [id]
    )
    return result.rows[0] ? this.mapRow(result.rows[0]) : null
  }

  async findAll(): Promise<Tenant[]> {
    const result = await pool.query('SELECT * FROM tenants ORDER BY created_at DESC')
    return result.rows.map(row => this.mapRow(row))
  }

  private mapRow(row: any): Tenant {
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      tokenBudgetMonthly: parseInt(row.token_budget_monthly, 10),
      enabledSkillIds: row.enabled_skill_ids || [],
      permissionRules: row.permission_rules,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}

export const tenantRepo = new TenantRepository()
```

- [ ] **Step 2: Create user.repo.ts**

```typescript
// src/repositories/user.repo.ts
import { pool } from '../config/database'
import { User, CreateUserInput } from '../models/user'
import bcrypt from 'bcrypt'

export class UserRepository {
  async create(input: CreateUserInput): Promise<User> {
    const passwordHash = await bcrypt.hash(input.password, 10)

    const result = await pool.query(
      `INSERT INTO users (tenant_id, email, role, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.tenantId, input.email, input.role || 'member', passwordHash]
    )
    return this.mapRow(result.rows[0])
  }

  async findById(id: string): Promise<User | null> {
    const result = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [id]
    )
    return result.rows[0] ? this.mapRow(result.rows[0]) : null
  }

  async findByEmail(email: string): Promise<User | null> {
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    )
    return result.rows[0] ? this.mapRow(result.rows[0]) : null
  }

  async findByTenant(tenantId: string): Promise<User[]> {
    const result = await pool.query(
      'SELECT * FROM users WHERE tenant_id = $1 ORDER BY created_at DESC',
      [tenantId]
    )
    return result.rows.map(row => this.mapRow(row))
  }

  private mapRow(row: any): User {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      email: row.email,
      role: row.role,
      passwordHash: row.password_hash,
      createdAt: row.created_at,
    }
  }
}

export const userRepo = new UserRepository()
```

- [ ] **Step 3: Create session.repo.ts**

```typescript
// src/repositories/session.repo.ts
import { pool } from '../config/database'
import { Session } from '../models/session'

export class SessionRepository {
  async create(data: {
    id: string
    tenantId: string
    userId: string
    workingDir: string
    nodeId: string
  }): Promise<Session> {
    const result = await pool.query(
      `INSERT INTO sessions (id, tenant_id, user_id, working_dir, status, node_id)
       VALUES ($1, $2, $3, $4, 'active', $5)
       RETURNING *`,
      [data.id, data.tenantId, data.userId, data.workingDir, data.nodeId]
    )
    return this.mapRow(result.rows[0])
  }

  async findById(id: string): Promise<Session | null> {
    const result = await pool.query(
      'SELECT * FROM sessions WHERE id = $1',
      [id]
    )
    return result.rows[0] ? this.mapRow(result.rows[0]) : null
  }

  async findByTenantAndUser(tenantId: string, userId: string): Promise<Session[]> {
    const result = await pool.query(
      'SELECT * FROM sessions WHERE tenant_id = $1 AND user_id = $2 ORDER BY created_at DESC',
      [tenantId, userId]
    )
    return result.rows.map(row => this.mapRow(row))
  }

  async update(id: string, data: Partial<Session>): Promise<void> {
    const fields: string[] = []
    const values: any[] = []
    let paramIndex = 1

    if (data.status) {
      fields.push(`status = $${paramIndex++}`)
      values.push(data.status)
    }
    if (data.ossArchivePath) {
      fields.push(`oss_archive_path = $${paramIndex++}`)
      values.push(data.ossArchivePath)
    }
    if (data.lastActiveAt) {
      fields.push(`last_active_at = $${paramIndex++}`)
      values.push(data.lastActiveAt)
    }

    if (fields.length === 0) return

    values.push(id)
    await pool.query(
      `UPDATE sessions SET ${fields.join(', ')} WHERE id = $${paramIndex}`,
      values
    )
  }

  private mapRow(row: any): Session {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      workingDir: row.working_dir,
      status: row.status,
      nodeId: row.node_id,
      ossArchivePath: row.oss_archive_path,
      createdAt: row.created_at,
      lastActiveAt: row.last_active_at,
    }
  }
}

export const sessionRepo = new SessionRepository()
```

- [ ] **Step 4: Create token-ledger.repo.ts**

```typescript
// src/repositories/token-ledger.repo.ts
import { pool } from '../config/database'
import { TokenLedger } from '../models/token'

export class TokenLedgerRepository {
  async findByTenantAndPeriod(tenantId: string, period: string): Promise<TokenLedger | null> {
    const result = await pool.query(
      'SELECT * FROM token_ledgers WHERE tenant_id = $1 AND period = $2',
      [tenantId, period]
    )
    return result.rows[0] ? this.mapRow(result.rows[0]) : null
  }

  async initializePeriod(tenantId: string, period: string, totalBudget: number): Promise<void> {
    await pool.query(
      `INSERT INTO token_ledgers (tenant_id, period, total_budget, used)
       VALUES ($1, $2, $3, 0)
       ON CONFLICT (tenant_id, period) DO NOTHING`,
      [tenantId, period, totalBudget]
    )
  }

  async incrementUsage(tenantId: string, period: string, tokens: number): Promise<void> {
    await pool.query(
      `UPDATE token_ledgers
       SET used = used + $1, last_updated_at = NOW()
       WHERE tenant_id = $2 AND period = $3`,
      [tokens, tenantId, period]
    )
  }

  private mapRow(row: any): TokenLedger {
    return {
      tenantId: row.tenant_id,
      period: row.period,
      totalBudget: parseInt(row.total_budget, 10),
      used: parseInt(row.used, 10),
      lastUpdatedAt: row.last_updated_at,
    }
  }
}

export const tokenLedgerRepo = new TokenLedgerRepository()
```

- [ ] **Step 5: Commit**

```bash
git add cc_ee/src/repositories/
git commit -m "feat(cc_ee): add repository layer

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Acceptance Criteria Checklist

After completing all tasks, verify:

- [ ] Can create tenant via API
- [ ] Can create user via API
- [ ] Can start session and send messages via API
- [ ] PreToolUse HookCallback blocks tools and returns reason to model
- [ ] Token usage extracted from AssistantMessage.usage and written to token_ledgers
- [ ] Session terminates and archives to OSS
- [ ] Session resumes from OSS and continues conversation
- [ ] Two concurrent sessions have independent transcripts and token counts

---

## Next Steps

After Phase 1a completion:
1. Proceed to [Phase 1b: Frontend Integration](./2026-04-09-phase-1b-frontend-integration.md)
2. Implement Web UI with React
3. Add JWT authentication
4. Build admin dashboard

---

**Note:** This is Part 1 of the Phase 1a plan. Due to length constraints, the remaining tasks (Task 6-15) covering cc_core integration, session lifecycle, API routes, and services will be in a continuation document.
