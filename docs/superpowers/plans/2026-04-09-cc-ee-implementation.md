# cc_ee Enterprise Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete enterprise-level multi-tenant platform wrapping Claude Code (cc_core) with backend API (cc_ee) and frontend UI (cc_ee_webui)

**Architecture:**
- Backend: Fastify + TypeScript + PostgreSQL, wraps cc_core in same process using `query()` API
- Frontend: React + TypeScript + Vite, connects via REST API and WebSocket
- Integration: cc_core runs with AsyncLocalStorage for per-session isolation

**Tech Stack:**
- Backend: Node.js 20, TypeScript 5, Fastify 4, PostgreSQL 15, node-postgres 8
- Frontend: React 18, TypeScript 5, Vite 5, Redux Toolkit 2, Ant Design 5
- Infrastructure: Docker, Kubernetes, Redis, Prometheus/Grafana

---

## Implementation Phases

This implementation is divided into 5 phases, each with its own detailed sub-plan:

### Phase 1a: Backend Core (2-3 weeks)
**Goal:** Single-tenant, single-user, single-session end-to-end working system

**Sub-plan:** [2026-04-09-phase-1a-backend-core.md](./2026-04-09-phase-1a-backend-core.md)

**Key Deliverables:**
- PostgreSQL schema initialized
- cc_core STATE concurrent safety transformation (in cc_core repo)
- cc_core integration layer (initCcCore, SessionRunner, HookCallbacks)
- Session lifecycle management (create, terminate, archive, resume)
- Control Plane API (Fastify routes for tenants, users, sessions)
- Token accounting from AssistantMessage.usage

**Acceptance Criteria:**
- [ ] Can create tenant and user via API
- [ ] Can start session and send messages via API
- [ ] PreToolUse HookCallback blocks tools and returns reason to model
- [ ] Token usage extracted from AssistantMessage.usage and written to token_ledgers
- [ ] Session terminates and archives to OSS
- [ ] Session resumes from OSS and continues conversation
- [ ] Two concurrent sessions in single process have independent transcripts and token counts

---

### Phase 1b: Frontend Integration (2-3 weeks)
**Goal:** Users can access platform through browser

**Sub-plan:** [2026-04-09-phase-1b-frontend-integration.md](./2026-04-09-phase-1b-frontend-integration.md)

**Key Deliverables:**
- JWT authentication (login/register)
- React Web UI (login, chat, session list)
- WebSocket streaming for real-time chat
- Admin UI (tenant management, user management, token dashboard)

**Acceptance Criteria:**
- [ ] User can login via Web UI
- [ ] User can create new session and chat with streaming output
- [ ] User can view token usage
- [ ] Tenant admin can manage users

---

### Phase 2: Multi-Tenant Enhancement (3-4 weeks)
**Goal:** True multi-tenant concurrency, token budget enforcement, LLM Proxy validation

**Sub-plan:** [2026-04-09-phase-2-multi-tenant-enhancement.md](./2026-04-09-phase-2-multi-tenant-enhancement.md)

**Key Deliverables:**
- Switch to `runWithSessionOverride` concurrent mode
- Token budget enforcement with alerts
- LLM Proxy for double-validation
- Tenant-level permission rules engine

**Acceptance Criteria:**
- [ ] Multiple tenants run concurrent sessions without interference
- [ ] Token budget exhaustion blocks tool calls with clear error
- [ ] LLM Proxy and cc_ee token counts match within 5%
- [ ] Tenant admin can configure allow/deny rules

---

### Phase 3: Skill Repository (2-3 weeks)
**Goal:** Centralized skill management with tenant-level activation

**Sub-plan:** [2026-04-09-phase-3-skill-repository.md](./2026-04-09-phase-3-skill-repository.md)

**Key Deliverables:**
- Skill repository API (CRUD operations)
- Tenant skill activation/deactivation
- Skill security scanning
- Admin UI for skill management

**Acceptance Criteria:**
- [ ] Tenant admin can activate/deactivate skills via UI
- [ ] New sessions load only tenant-activated skills
- [ ] Different tenants have different skill sets
- [ ] Official skills pass security scan before publication

---

### Phase 4: Security & Monitoring (2-3 weeks)
**Goal:** Production-grade security and observability

**Sub-plan:** [2026-04-09-phase-4-security-monitoring.md](./2026-04-09-phase-4-security-monitoring.md)

**Key Deliverables:**
- Audit log enhancement (PII redaction, query API, export)
- Anomaly detection and alerting
- Prometheus/Grafana monitoring
- Resource limits (K8s, disk quotas)

**Acceptance Criteria:**
- [ ] All tool calls have audit logs with redacted PII
- [ ] Token anomaly alerts within 5 minutes
- [ ] Session crashes auto-restart
- [ ] Monitoring dashboard shows system health

---

### Phase 5: Performance Optimization (Continuous)
**Goal:** Support 2000+ concurrent sessions

**Sub-plan:** [2026-04-09-phase-5-performance-optimization.md](./2026-04-09-phase-5-performance-optimization.md)

**Key Deliverables:**
- Horizontal scaling (K8s multi-pod)
- Session affinity routing
- Redis caching (tenant config, skills)
- Performance testing

**Acceptance Criteria:**
- [ ] 2000+ concurrent sessions supported
- [ ] Session cold start < 1s
- [ ] API P99 latency < 500ms
- [ ] Pod restart with seamless session recovery

---

## Design Documents Reference

All sub-plans reference these design documents in `cc_ee_design/`:

1. **01-architecture.md** - Overall system architecture
2. **02-cc-core-integration.md** - cc_core integration strategy
3. **03-session-lifecycle.md** - Session management
4. **04-hook-system.md** - HookCallback implementation
5. **05-token-accounting.md** - Token tracking
6. **06-skill-system.md** - Skill management
7. **07-data-model.md** - PostgreSQL schema
8. **08-security.md** - Security considerations
9. **09-roadmap.md** - Implementation roadmap
10. **10-backend-architecture.md** - Backend structure
11. **11-frontend-architecture.md** - Frontend structure
12. **12-api-protocol.md** - API specification
13. **13-tech-stack.md** - Technology choices

---

## Critical Path

```
Phase 1a (Backend Core)
  ├── Database Schema ──────────────────┐
  ├── cc_core STATE Transformation ─────┤
  ├── cc_core Integration Layer ────────┤
  ├── Session Lifecycle ────────────────┤
  └── Control Plane API ────────────────┤
                                        │
Phase 1b (Frontend) ◄──────────────────┘
  ├── JWT Authentication
  ├── Web UI (Chat)
  └── Admin UI
                │
Phase 2 ◄───────┘
  ├── Concurrent Sessions
  ├── Token Budget
  └── LLM Proxy
                │
Phase 3 ◄───────┘
  └── Skill Repository
                │
Phase 4 ◄───────┘
  └── Security & Monitoring
                │
Phase 5 ◄───────┘
  └── Performance Optimization
```

---

## Development Workflow

### For Each Phase:

1. **Read the sub-plan** - Understand all tasks and file structure
2. **Set up environment** - Install dependencies, configure database
3. **Execute tasks sequentially** - Follow TDD approach (test → implement → commit)
4. **Verify acceptance criteria** - Test each criterion before moving to next phase
5. **Document deviations** - Update plans if approach changes

### TDD Discipline:

Every implementation task follows this pattern:
1. Write failing test
2. Run test to verify it fails
3. Write minimal implementation
4. Run test to verify it passes
5. Commit with descriptive message

### Commit Messages:

```
feat: add session creation API endpoint
test: add token budget exhaustion test
fix: correct WebSocket reconnection logic
refactor: extract session runner to separate module
docs: update API protocol for new endpoints
```

---

## Risk Mitigation

| Risk | Impact | Mitigation | Phase |
|------|--------|-----------|-------|
| cc_core STATE transformation scope | High | Incremental migration + comprehensive tests | 1a |
| Serial bottleneck before transformation | Medium | Phase 1a works in serial mode, Phase 2 enables concurrency | 1a, 2 |
| Token count accuracy | Medium | LLM Proxy double-validation in Phase 2 | 2 |
| OSS archive failure | High | Local backup + failure alerts | 1a |
| Session isolation weakness | High | Strict file access rules + deny rules + audits | 1a, 4 |

---

## Next Steps

1. **Start with Phase 1a**: Read [2026-04-09-phase-1a-backend-core.md](./2026-04-09-phase-1a-backend-core.md)
2. **Set up development environment**:
   - Install Node.js 20, PostgreSQL 15
   - Clone cc_core repository
   - Create cc_ee and cc_ee_webui directories
3. **Execute Phase 1a tasks** using subagent-driven-development or executing-plans skill
4. **Verify acceptance criteria** before proceeding to Phase 1b

---

## Execution Options

**Plan complete and saved. Two execution options:**

**1. Subagent-Driven (recommended)** - Dispatch fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
