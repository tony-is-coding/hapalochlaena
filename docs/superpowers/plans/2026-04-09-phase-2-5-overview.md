# Phase 2-5: Implementation Plans Overview

> **For agentic workers:** These are high-level outlines for Phases 2-5. Detailed task breakdowns will be created when starting each phase.

---

## Phase 2: Multi-Tenant Enhancement & Token Management (3-4 weeks)

**Goal:** Enable true multi-tenant concurrency, enforce token budgets, add LLM Proxy validation

**Prerequisites:** Phase 1a and 1b completed, cc_core STATE concurrent safety transformation completed

### Key Tasks

1. **Enable Concurrent Sessions**
   - Switch from serial mode to `runWithSessionOverride` concurrent mode
   - Remove serial locks in session handling
   - Verify session isolation with concurrent load tests

2. **Token Budget Enforcement**
   - Implement monthly ledger auto-initialization (cron job)
   - Add budget threshold alerts (90% warning)
   - Implement budget exhaustion notifications (email/webhook)
   - Add budget visualization in admin UI

3. **LLM Proxy Implementation**
   - Build transparent proxy for Anthropic API
   - Extract usage from Anthropic responses
   - Write to separate `proxy_token_ledgers` table
   - Implement daily reconciliation job
   - Add alert for >5% discrepancy

4. **Permission Rules Engine**
   - Build admin UI for configuring allow/deny rules
   - Implement real-time rule updates
   - Add rule testing interface
   - Add audit trail for rule changes

### Acceptance Criteria

- [ ] Multiple tenants run concurrent sessions without interference
- [ ] Token budget exhaustion blocks tool calls with clear error message
- [ ] LLM Proxy and cc_ee token counts match within 5%
- [ ] Tenant admin can configure and test permission rules via UI
- [ ] Single Pod handles 100+ concurrent sessions

---

## Phase 3: Skill Repository & Dynamic Configuration (2-3 weeks)

**Goal:** Centralized skill management with tenant-level activation and version control

**Prerequisites:** Phase 2 completed

### Key Tasks

1. **Skill Repository API**
   - `GET /api/skills` - List all skills with filtering
   - `POST /api/skills` - Create new skill (admin only)
   - `PUT /api/skills/:id` - Update skill content
   - `DELETE /api/skills/:id` - Deprecate skill
   - Add skill versioning (semver)

2. **Tenant Skill Management**
   - `POST /api/tenants/:id/skills/:skillId` - Activate skill for tenant
   - `DELETE /api/tenants/:id/skills/:skillId` - Deactivate skill
   - `PUT /api/tenants/:id/skills/:skillId/upgrade` - Upgrade to new version
   - Version pinning and upgrade policies

3. **Skill Security Scanning**
   - Static analysis for dangerous patterns
   - Sensitive data detection
   - Approval workflow (scan → review → publish)
   - Security score calculation

4. **Admin UI for Skills**
   - Skill marketplace/catalog view
   - Skill detail pages with documentation
   - Tenant activation management
   - Version comparison and upgrade UI

### Acceptance Criteria

- [ ] Tenant admin can browse and activate skills via UI
- [ ] New sessions load only tenant-activated skills
- [ ] Different tenants have different skill sets
- [ ] Skills pass security scan before publication
- [ ] Skill versions can be pinned and upgraded independently

---

## Phase 4: Security Hardening & Monitoring (2-3 weeks)

**Goal:** Production-grade security, observability, and operational excellence

**Prerequisites:** Phase 3 completed

### Key Tasks

1. **Audit Log Enhancement**
   - PII redaction in `input_snapshot` field
   - Audit log query API with filtering
   - Export functionality (CSV/JSON)
   - Retention policies and archival

2. **Anomaly Detection & Alerting**
   - Token consumption anomaly detection (spike detection)
   - Tool call frequency anomaly detection
   - Session crash detection and auto-restart
   - Alert routing (email, Slack, PagerDuty)

3. **Monitoring & Observability**
   - Prometheus metrics export
     - Active sessions count
     - Token consumption rate
     - Hook execution latency
     - API response times
   - Grafana dashboards
     - System health overview
     - Per-tenant usage
     - Performance metrics
   - Log aggregation (Loki or ELK)

4. **Resource Limits**
   - Kubernetes resource limits (CPU, memory)
   - Per-session disk quotas
   - Connection pool limits
   - Rate limiting per tenant

### Acceptance Criteria

- [ ] All tool calls have audit logs with PII redacted
- [ ] Token anomalies trigger alerts within 5 minutes
- [ ] Session crashes auto-restart without data loss
- [ ] Monitoring dashboard shows real-time system health
- [ ] Resource limits prevent runaway processes

---

## Phase 5: Performance Optimization & Scaling (Continuous)

**Goal:** Support 2000+ concurrent sessions with sub-second latency

**Prerequisites:** Phase 4 completed

### Key Tasks

1. **Horizontal Scaling**
   - Kubernetes multi-pod deployment
   - Session affinity routing (consistent hashing)
   - Pod auto-scaling based on load
   - Graceful session migration on pod restart

2. **Caching Layer**
   - Redis for tenant configuration (TTL 60s)
   - Redis for skill content (TTL 5min)
   - PostgreSQL query result caching
   - CDN for static assets

3. **Database Optimization**
   - pgBouncer connection pooling
   - Read replicas for analytics queries
   - Partitioning for large tables (audit logs)
   - Index optimization

4. **Performance Testing**
   - Load testing with 2000+ concurrent sessions
   - Latency profiling and optimization
   - Memory leak detection
   - Stress testing for failure scenarios

### Acceptance Criteria

- [ ] System supports 2000+ concurrent sessions
- [ ] Session cold start < 1s
- [ ] API P99 latency < 500ms
- [ ] Pod restart with seamless session recovery
- [ ] Zero downtime deployments

---

## Implementation Strategy

### Phase Execution Order

```
Phase 1a (Backend Core) → Phase 1b (Frontend) → Phase 2 (Multi-Tenant) → Phase 3 (Skills) → Phase 4 (Security) → Phase 5 (Performance)
```

### Parallel Work Opportunities

- **Phase 1a + 1b**: Backend and frontend can be developed in parallel after API protocol is defined
- **Phase 2**: Token management and LLM Proxy can be developed in parallel
- **Phase 3**: Skill repository backend and admin UI can be developed in parallel
- **Phase 4**: Monitoring and security features can be developed in parallel

### Risk Management

| Phase | Key Risk | Mitigation |
|-------|----------|-----------|
| Phase 2 | cc_core STATE transformation complexity | Incremental migration with comprehensive tests |
| Phase 3 | Skill security vulnerabilities | Multi-layer security scanning and manual review |
| Phase 4 | Alert fatigue from false positives | Tunable thresholds and alert aggregation |
| Phase 5 | Performance degradation under load | Continuous load testing and profiling |

---

## Next Steps

1. **Start Phase 1a**: Follow [2026-04-09-phase-1a-backend-core.md](./2026-04-09-phase-1a-backend-core.md) and [2026-04-09-phase-1a-backend-core-part2.md](./2026-04-09-phase-1a-backend-core-part2.md)
2. **Complete Phase 1a acceptance criteria** before moving to Phase 1b
3. **Start Phase 1b**: Follow [2026-04-09-phase-1b-frontend-integration.md](./2026-04-09-phase-1b-frontend-integration.md)
4. **Create detailed Phase 2 plan** when Phase 1b is complete
5. **Iterate through remaining phases** with detailed planning before each phase

---

## Documentation Reference

All implementation plans reference:
- Design documents in `cc_ee_design/`
- Main plan: `docs/superpowers/plans/2026-04-09-cc-ee-implementation.md`
- API protocol: `cc_ee_design/12-api-protocol.md`
- Tech stack: `cc_ee_design/13-tech-stack.md`
