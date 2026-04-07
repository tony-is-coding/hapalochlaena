# 数据模型

**版本**: 3.0（经源码验证修正）

---

## 1. 完整 Schema

```sql
-- ─────────────────────────────────────────────
-- 租户表
-- ─────────────────────────────────────────────
CREATE TABLE tenants (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  VARCHAR(255) NOT NULL,
  status                VARCHAR(50) NOT NULL DEFAULT 'active',
  -- active / suspended / deleted
  token_budget_monthly  BIGINT NOT NULL DEFAULT 1000000,
  enabled_skill_ids     TEXT[] DEFAULT '{}',
  -- 格式：['skill-uuid@1.2.0', ...]（Phase 3 加版本）
  permission_rules      JSONB DEFAULT '{"allow": [], "deny": []}',
  -- { allow: string[], deny: string[] }
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 用户表
-- ─────────────────────────────────────────────
CREATE TABLE users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  email       VARCHAR(255) NOT NULL UNIQUE,
  role        VARCHAR(50) NOT NULL DEFAULT 'member',
  -- admin / member
  password_hash VARCHAR(255),
  created_at  TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- Session 表
-- ─────────────────────────────────────────────
CREATE TABLE sessions (
  id                UUID PRIMARY KEY,
  -- = cc_core sessionId（UUID）
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  user_id           UUID NOT NULL REFERENCES users(id),
  working_dir       VARCHAR(512) NOT NULL,
  -- /sessions/{tenant_id}/{session_id}/
  status            VARCHAR(50) NOT NULL DEFAULT 'active',
  -- active / idle / terminated
  node_id           VARCHAR(255),
  -- 运行在哪个 Pod（用于路由和故障排查）
  oss_archive_path  VARCHAR(512),
  -- OSS 归档路径（session 终止后）
  created_at        TIMESTAMP DEFAULT NOW(),
  last_active_at    TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- Token 账本（按租户 + 月份）
-- ─────────────────────────────────────────────
CREATE TABLE token_ledgers (
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  period          VARCHAR(7) NOT NULL,
  -- YYYY-MM
  total_budget    BIGINT NOT NULL,
  used            BIGINT NOT NULL DEFAULT 0,
  last_updated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (tenant_id, period)
);

-- ─────────────────────────────────────────────
-- 工具调用审计日志
-- ─────────────────────────────────────────────
CREATE TABLE tool_audit_logs (
  id              BIGSERIAL PRIMARY KEY,
  session_id      UUID NOT NULL REFERENCES sessions(id),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  user_id         UUID REFERENCES users(id),
  tool_name       VARCHAR(255) NOT NULL,
  input_snapshot  JSONB,
  -- 脱敏后的工具输入参数
  hook_decision   VARCHAR(50) NOT NULL,
  -- allow / block
  block_reason    VARCHAR(255),
  -- token_budget_exhausted / deny_rule_matched
  matched_rule    VARCHAR(255),
  -- 匹配的 deny 规则
  timestamp       TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- Skill 仓库
-- ─────────────────────────────────────────────
CREATE TABLE skills (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL UNIQUE,
  -- 显示名称
  slug          VARCHAR(255) NOT NULL UNIQUE,
  -- 文件名（不含 .md），如 code-review
  description   TEXT,
  content       TEXT NOT NULL,
  -- 完整 Markdown 内容
  is_official   BOOLEAN NOT NULL DEFAULT false,
  allowed_tools TEXT[],
  -- 该 skill 允许使用的工具列表
  version       VARCHAR(50) NOT NULL DEFAULT '1.0.0',
  -- semver
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

-- ─────────────────────────────────────────────
-- 索引
-- ─────────────────────────────────────────────
CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_sessions_tenant_user ON sessions(tenant_id, user_id);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_sessions_node ON sessions(node_id);
CREATE INDEX idx_tool_audit_logs_session ON tool_audit_logs(session_id);
CREATE INDEX idx_tool_audit_logs_tenant ON tool_audit_logs(tenant_id);
CREATE INDEX idx_tool_audit_logs_timestamp ON tool_audit_logs(timestamp);
```

---

## 2. 实体关系

```
tenants (1)
  ├── users (N)
  │     └── sessions (N)
  ├── sessions (N)
  ├── token_ledgers (N, 按月)
  └── enabled_skill_ids → skills (N:M)

sessions (1)
  └── tool_audit_logs (N)
```

---

## 3. 关键字段说明

### 3.1 tenants.permission_rules

```json
{
  "allow": [
    "Read",
    "Write",
    "Edit",
    "Bash(git:*)",
    "Bash(npm:*)"
  ],
  "deny": [
    "Bash(rm -rf:*)",
    "Bash(dd:*)",
    "WebFetch(*)"
  ]
}
```

- `allow`：工具白名单（空数组 = 允许所有）
- `deny`：动态 deny 规则，在 PreToolUse HookCallback 中检查

### 3.2 sessions.node_id

标识 session 运行在哪个 Pod，用于：
- WebSocket 路由（session affinity）
- 故障排查（哪个 Pod 上的 session 出问题）
- Pod 重启时的 session 迁移

### 3.3 token_ledgers.used

通过原子 `UPDATE used = used + $tokens` 更新，无需事务。

PreToolUse 时乐观读（不加锁），允许极小概率超支。

---

## 4. 相比 v2 设计的变更

| 字段 | v2 | v3 | 原因 |
|------|----|----|------|
| sessions.pid | 有 | 删除 | 单进程多 session，pid 无意义 |
| sessions.node_id | 有 | 保留 | 用于路由和故障排查 |
| sessions.oss_archive_path | 有 | 保留 | session 恢复需要 |
| token_ledgers.version | 有（乐观锁备用）| 删除 | 改用原子 UPDATE，不需要乐观锁 |
| skills.slug | 无 | 新增 | 用于文件名（区别于显示名称）|
| tool_audit_logs.block_reason | 无 | 新增 | 记录阻断原因（budget/deny_rule）|
| tool_audit_logs.matched_rule | 无 | 新增 | 记录匹配的 deny 规则 |
