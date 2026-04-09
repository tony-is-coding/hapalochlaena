CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'active',
  token_budget_monthly BIGINT NOT NULL DEFAULT 1000000,
  enabled_skill_ids TEXT[] DEFAULT '{}',
  permission_rules JSONB DEFAULT '{"allow": [], "deny": []}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  email VARCHAR(255) NOT NULL UNIQUE,
  role VARCHAR(50) NOT NULL DEFAULT 'member',
  password_hash VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
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

CREATE TABLE IF NOT EXISTS token_ledgers (
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  period VARCHAR(7) NOT NULL,
  total_budget BIGINT NOT NULL,
  used BIGINT NOT NULL DEFAULT 0,
  last_updated_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (tenant_id, period)
);

CREATE TABLE IF NOT EXISTS tool_audit_logs (
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

CREATE TABLE IF NOT EXISTS skills (
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

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_sessions_tenant_user ON sessions(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_tool_audit_logs_session ON tool_audit_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_audit_logs_tenant ON tool_audit_logs(tenant_id);
