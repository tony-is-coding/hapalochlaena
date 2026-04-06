# 企业级 Agent 平台技术设计文档

**版本**: 2.0
**日期**: 2026-04-06
**状态**: Technical Design
**基于**: 工程评审反馈的架构优化版本

---

## 文档说明

本文档是基于初版设计文档的工程评审反馈，经过架构优化后的技术设计文档。主要变更：

1. **架构模式变更**：从"每 session 一个进程"改为"单进程多 session"
2. **引入 cc_ee 层**：在 cc_core 外增加企业级编排层，负责多租户隔离、会话管理、安全管控
3. **Session 持久化**：Session 状态持久化到 OSS，支持 Pod 重启后恢复
4. **Token 计数优化**：使用 PostgreSQL 行级锁解决并发竞态条件
5. **实施路线图优化**：Phase 1 分解为 Phase 1a（后端核心）和 Phase 1b（前端接入）

---
## 1. 需求设计

### 1.1 业务目标

基于 cc_core (Claude Code Agent Harness) 构建一个企业级 SaaS 多租户 Agent 平台，为企业客户提供安全、可控、可扩展的 AI Agent 服务。

### 1.2 核心需求

#### FR1: 多租户隔离
- **FR1.1**: 租户 = 企业，用户 = 企业员工
- **FR1.2**: 租户间数据完全隔离（会话数据、工作目录、审计日志）
- **FR1.3**: 租户间执行环境隔离（应用层隔离，非进程级隔离）
- **FR1.4**: 租户级配置管理（权限规则、Skill 白名单）

#### FR2: Token 预算管控
- **FR2.1**: 租户级月度 token 配额设置
- **FR2.2**: 实时 token 计量和限流
- **FR2.3**: Token 超限时阻断新的工具调用
- **FR2.4**: Token 使用情况仪表盘（租户管理员可见）

#### FR3: 动态 Skill 配置
- **FR3.1**: 平台维护官方 Skill 仓库
- **FR3.2**: 租户管理员从 Skill 仓库勾选激活
- **FR3.3**: 不同租户可有不同 Skill 组合
- **FR3.4**: Skill 版本管理（租户固定版本，手动升级）

#### FR4: 会话管理
- **FR4.1**: 用户可创建多个会话（同时活跃 1-3 个）
- **FR4.2**: 会话状态持久化（支持 Pod 重启后恢复）
- **FR4.3**: 会话上下文动态组装（用户、租户、历史对话、历史产物、技能背景、脚本文件等）
- **FR4.4**: 会话终止后自动归档到 OSS

#### FR5: 安全管控
- **FR5.1**: 工具调用前安全检查（deny 规则、token 预算）
- **FR5.2**: 工具调用审计日志（完整记录所有工具调用）
- **FR5.3**: Skill 内容安全扫描（官方 Skill 发布前）
- **FR5.4**: Hook 拦截机制（在 cc_ee 层统一拦截）

### 1.3 非功能需求

#### NFR1: 性能
- **NFR1.1**: 支持数百到数千并发 session
- **NFR1.2**: API 响应时间 P99 < 500ms（Phase 5 目标）
- **NFR1.3**: Session 冷启动延迟 < 1s（Phase 5 目标）

#### NFR2: 可用性
- **NFR2.1**: Pod 重启时 session 可恢复（用户无感知）
- **NFR2.2**: 单个 session 故障不影响其他 session

#### NFR3: 可维护性
- **NFR3.1**: 零侵入 cc_core（通过原生扩展点实现所有能力）
- **NFR3.2**: cc_core 升级不影响平台层逻辑

#### NFR4: 可扩展性
- **NFR4.1**: 支持水平扩展（多 Pod 负载均衡）
- **NFR4.2**: 支持未来扩展（租户私有 Skill、用户级 Token 配额、多模型支持）

### 1.4 部署模型

- **部署方式**: SaaS 多租户
- **接入方式**: Web UI（浏览器端对话界面，类似 Claude.ai）
- **执行环境**: 共享机器，单进程多 session，应用层隔离
- **规模预期**: 数百到数千并发 session，每用户 1-3 个活跃 session

---
## 2. 技术架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────┐
│                      Web UI (React)                      │
│              浏览器端对话界面，类似 Claude.ai              │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTP / WebSocket
┌──────────────────────────▼──────────────────────────────┐
│                    API Gateway Layer                     │
│        认证(JWT) · 租户路由 · 限流 · 会话路由             │
└──────┬────────────────────────────────────┬─────────────┘
       │                                    │
┌──────▼──────────────┐          ┌──────────▼──────────────┐
│   Control Plane      │          │    cc_ee Service         │
│  ─────────────────  │          │  ──────────────────────  │
│  · 租户 CRUD         │          │  · 多租户编排            │
│  · 用户管理          │◄────────►│  · 多会话管理            │
│  · Token 预算账本    │          │  · 限流 · 安全 · 鉴权    │
│  · Skill 仓库 & 分配 │          │  · 会话恢复 · 业务转换   │
│  · 权限规则引擎       │          │  · 沙箱隔离              │
└─────────────────────┘          │  · Hook 拦截             │
                                  │  · 动态上下文组装        │
                                  └──────────┬──────────────┘
                                             │ 进程内调用
                          ┌──────────────────▼──────────────────┐
                          │         cc_core (单进程多 session)   │
                          │  ┌──────────┐  ┌──────────┐        │
                          │  │Session A │  │Session B │  ...   │
                          │  │(Tenant1/ │  │(Tenant1/ │        │
                          │  │ User1)   │  │ User2)   │        │
                          │  └──────────┘  └──────────┘        │
                          └────────────────────────────────────┘
                                             │
                          ┌──────────────────▼──────────────────┐
                          │           Anthropic API             │
                          │   (通过 ANTHROPIC_BASE_URL 配置)    │
                          └────────────────────────────────────┘
```

### 2.2 架构分层

| 层 | 职责 | 技术选型 |
|---|---|---|
| **Web UI** | 对话界面、Session 管理 UI、租户管理后台 | React + TypeScript + HTTP/WebSocket |
| **API Gateway** | 认证、路由、限流 | Node.js (Fastify) 或 Nginx |
| **Control Plane** | 租户/用户/Token/Skill 的管理数据面 | Node.js + PostgreSQL |
| **cc_ee Service** | 多租户编排、多会话管理、安全管控、Hook 拦截 | Node.js（与 cc_core 打包在一起）|
| **cc_core** | Agent 核心能力（单进程多 session） | Node.js（原生 cc_core）|

### 2.3 关键架构决策

#### 决策 1: 单进程多 session 架构

**原设计**：每个 session 一个独立的 cc_core 进程，进程级隔离

**新设计**：
- cc_ee 和 cc_core 打包在一起，对外提供 HTTP 服务
- 一个节点下只启动一个 cc_core 进程
- 一个进程下可以同时开启多个会话（session）
- 多个 session 在 cc_ee 层进行多租户、多会话编排
- 应用层隔离（而非进程级隔离）

**理由**：
- 资源利用率更高（避免进程启动开销）
- 简化部署和运维（减少进程管理复杂度）
- cc_core 本身支持多 session 并发（通过配置去除跨 session 共享能力）

#### 决策 2: cc_ee 层作为企业级编排层

**职责**：
1. **多租户隔离**：租户间数据和执行环境隔离
2. **多会话编排**：管理多个 session 的生命周期
3. **限流**：租户级 token 预算检查和限流
4. **安全**：工具调用前安全检查（deny 规则）
5. **鉴权**：用户身份验证和权限检查
6. **会话恢复**：从 OSS 恢复会话上下文
7. **业务转换**：将业务请求转换为 cc_core 可理解的格式
8. **沙箱隔离**：应用层隔离（文件访问范围限制）
9. **Hook 拦截**：在请求进入 cc_core 之前统一拦截
10. **动态上下文组装**：每次会话进入 cc_ee 前动态组装上下文（用户、租户、历史对话、历史产物、技能背景、脚本文件等）

**理由**：
- 零侵入 cc_core（所有企业级能力在 cc_ee 层实现）
- 清晰的职责边界（cc_ee 负责编排，cc_core 负责 Agent 核心能力）
- 易于扩展和维护

#### 决策 3: Session 状态持久化到 OSS

**方案**：
- Session 状态（transcript JSONL、工作目录）持久化到 S3/NFS
- Pod 重启后从 OSS 恢复 session
- Session 终止后打包存储到 OSS（本地归档目录）

**理由**：
- 用户无感知（Pod 重启不影响用户体验）
- 支持会话恢复（用户下次回来可以继续之前的会话）
- 数据持久化（避免数据丢失）

#### 决策 4: Token 计数使用 PostgreSQL 行级锁

**方案**：
- PreToolUse 时用 `SELECT FOR UPDATE` 锁定 token_ledgers 行
- 检查后预扣，PostToolUse 时补齐差额
- 保证强一致性，避免并发竞态条件

**理由**：
- 简单可靠（PostgreSQL 原生支持）
- 强一致性（避免租户超支）
- 性能可接受（Phase 1-3 规模下）

#### 决策 5: LLM Proxy 延后到 Phase 2

**方案**：
- Phase 1 先用 cc_ee 层的 Hook 拦截做 token 计数
- Phase 2 再加 LLM Proxy 做双重校验和对账

**理由**：
- 降低 Phase 1 复杂度
- 验证核心流程后再加增强功能
- 节省 Phase 1 开发时间（~1周）

---
## 3. 数据模型

### 3.1 核心实体

```sql
-- 租户表
CREATE TABLE tenants (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL, -- active/suspended/deleted
  token_budget_monthly BIGINT NOT NULL, -- 月度 token 配额
  token_used_current BIGINT DEFAULT 0,  -- 当前月已消耗
  enabled_skill_ids TEXT[], -- 激活的 skill ID 列表
  permission_rules JSONB,   -- allow/deny 工具规则
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 用户表
CREATE TABLE users (
  id UUID PRIMARY KEY,
  tenant_id UUID REFERENCES tenants(id),
  email VARCHAR(255) NOT NULL UNIQUE,
  role VARCHAR(50) NOT NULL, -- admin/member
  created_at TIMESTAMP DEFAULT NOW()
);

-- Session 表
CREATE TABLE sessions (
  id UUID PRIMARY KEY, -- = cc_core customSessionId
  tenant_id UUID REFERENCES tenants(id),
  user_id UUID REFERENCES users(id),
  working_dir VARCHAR(512) NOT NULL, -- /sessions/{tenant_id}/{session_id}/
  status VARCHAR(50) NOT NULL, -- active/idle/terminated
  node_id VARCHAR(255), -- 标识 session 运行在哪个节点/Pod 上（用于路由和故障排查）
  oss_archive_path VARCHAR(512), -- OSS 归档路径（session 终止后）
  created_at TIMESTAMP DEFAULT NOW(),
  last_active_at TIMESTAMP DEFAULT NOW()
);

-- 工具调用审计日志
CREATE TABLE tool_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID REFERENCES sessions(id),
  tenant_id UUID REFERENCES tenants(id),
  user_id UUID REFERENCES users(id),
  tool_name VARCHAR(255) NOT NULL,
  input_snapshot JSONB, -- 工具输入参数快照
  hook_decision VARCHAR(50), -- allow/block
  tokens_delta INTEGER, -- 本次调用消耗的 token
  timestamp TIMESTAMP DEFAULT NOW()
);

-- Skill 仓库
CREATE TABLE skills (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  content TEXT NOT NULL, -- SKILL.md 完整内容
  is_official BOOLEAN DEFAULT false, -- 平台官方 skill
  allowed_tools TEXT[], -- 该 skill 允许使用的工具列表
  version VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Token 账本（按租户 + 月份聚合）
CREATE TABLE token_ledgers (
  tenant_id UUID REFERENCES tenants(id),
  period VARCHAR(7) NOT NULL, -- YYYY-MM
  total_budget BIGINT NOT NULL,
  used BIGINT DEFAULT 0,
  last_updated_at TIMESTAMP DEFAULT NOW(),
  version INTEGER DEFAULT 0, -- 用于乐观锁（备用方案）
  PRIMARY KEY (tenant_id, period)
);

-- 索引
CREATE INDEX idx_sessions_tenant_user ON sessions(tenant_id, user_id);
CREATE INDEX idx_sessions_status ON sessions(status);
CREATE INDEX idx_tool_audit_logs_session ON tool_audit_logs(session_id);
CREATE INDEX idx_tool_audit_logs_tenant ON tool_audit_logs(tenant_id);
CREATE INDEX idx_tool_audit_logs_timestamp ON tool_audit_logs(timestamp);
```

### 3.2 数据关系

- 一个租户有多个用户
- 一个用户可以有多个 session（但同时活跃的通常 1-3 个）
- Token 预算在租户级统计，不分配到用户
- Skill 由平台维护，租户通过 `enabled_skill_ids` 选择激活

### 3.3 数据模型变更说明

**相比初版设计的变更**：

1. **删除 sessions 表的 pid 字段**：
   - 原因：单进程多 session 架构下，所有 session 共享同一个进程，pid 字段无意义
   - 替代：增加 `node_id` 字段，标识 session 运行在哪个节点/Pod 上

2. **增加 sessions 表的 oss_archive_path 字段**：
   - 原因：支持 session 终止后归档到 OSS
   - 用途：记录 OSS 归档路径，用于会话恢复

3. **增加 token_ledgers 表的 version 字段**：
   - 原因：备用方案（如果行级锁性能不足，可以改用乐观锁）
   - 用途：乐观锁版本号

---
## 4. Session 生命周期与上下文组装

### 4.1 Session 启动流程

```
1. 用户在 Web UI 发起 "新建对话"
   ↓
2. API Gateway 验证 JWT → 提取 tenant_id + user_id
   ↓
3. Control Plane 检查 token 预算
   - 查询 token_ledgers: used >= total_budget → 返回 429 Too Many Requests
   - 通过 → 继续
   ↓
4. cc_ee Service 执行：
   a. 检查是否有可恢复的 session（从 OSS 查询）
      - 有 → 从 OSS 恢复 session 上下文（见 4.3）
      - 无 → 创建新 session

   b. 动态组装 session 上下文（见 4.2）：
      - 用户信息（user_id, email, role）
      - 租户信息（tenant_id, name, permission_rules）
      - 历史对话（从 OSS 恢复 transcript JSONL）
      - 历史产物（从 OSS 恢复工作目录）
      - 技能背景（从数据库读取 enabled_skill_ids，生成 skill 文件）
      - 脚本文件（如有）

   c. 生成 managed-settings.json（见 4.4）

   d. 将上下文写入 cc_core 工作目录：
      - /sessions/{tenant_id}/{session_id}/.claude/settings.json
      - /sessions/{tenant_id}/{session_id}/.claude/skills/{skill_name}.md
      - /sessions/{tenant_id}/{session_id}/{session_id}.jsonl (transcript)
      - /sessions/{tenant_id}/{session_id}/ (工作目录)

   e. 调用 cc_core 启动 session（进程内调用）

   f. 记录 session 到数据库（sessions 表）
   ↓
5. cc_core 启动 session，返回 session_id
   ↓
6. cc_ee 返回 session_id 给 Web UI
```

### 4.2 动态上下文组装

每次会话进入 cc_ee 前，cc_ee 层动态组装会话上下文，包括：

#### 4.2.1 用户信息
```json
{
  "user_id": "uuid",
  "email": "user@example.com",
  "role": "member",
  "tenant_id": "uuid",
  "tenant_name": "Acme Corp"
}
```

#### 4.2.2 租户配置
```json
{
  "tenant_id": "uuid",
  "permission_rules": {
    "allow": ["Bash(git:*)", "Read", "Write", "Edit"],
    "deny": ["Bash(rm -rf:*)", "Bash(dd:*)"]
  },
  "enabled_skill_ids": ["skill-a@1.2.0", "skill-b@2.0.1"]
}
```

#### 4.2.3 历史对话
- 从 OSS 恢复 transcript JSONL（如果是恢复的 session）
- 或创建新的空 transcript（如果是新 session）

#### 4.2.4 历史产物
- 从 OSS 恢复工作目录（如果是恢复的 session）
- 或创建新的空工作目录（如果是新 session）

#### 4.2.5 技能背景
- 从数据库读取 `tenants.enabled_skill_ids`
- 从 `skills` 表读取对应的 `content`
- 写入 `/sessions/{tenant_id}/{session_id}/.claude/skills/{skill_name}.md`

#### 4.2.6 脚本文件
- 如果用户上传了脚本文件，写入工作目录

### 4.3 Session 恢复流程

```
1. 用户在 Web UI 选择 "恢复会话"
   ↓
2. API Gateway 验证 JWT → 提取 tenant_id + user_id
   ↓
3. cc_ee Service 执行：
   a. 从数据库查询 session（sessions 表）
      - 检查 session.tenant_id == tenant_id
      - 检查 session.user_id == user_id
      - 检查 session.status == 'terminated'

   b. 从 OSS 下载 session 归档包（session.oss_archive_path）
      - transcript JSONL
      - 工作目录

   c. 解压归档包到本地工作目录：
      - /sessions/{tenant_id}/{session_id}/{session_id}.jsonl
      - /sessions/{tenant_id}/{session_id}/ (工作目录)

   d. 动态组装 session 上下文（见 4.2）

   e. 调用 cc_core 恢复 session（进程内调用）

   f. 更新 session 状态到数据库（status = 'active'）
   ↓
4. cc_core 恢复 session，返回 session_id
   ↓
5. cc_ee 返回 session_id 给 Web UI
```

### 4.4 动态生成的 managed-settings.json

每次 session 启动时，cc_ee 根据租户配置动态生成：

```json
{
  "allowManagedHooksOnly": true,
  "permissions": {
    "allow": ["<租户配置的工具白名单>"],
    "deny": [
      "Bash(rm -rf:*)",
      "Bash(dd:*)",
      "<租户配置的拒绝规则>"
    ],
    "additionalDirectories": ["/sessions/{tenant_id}/{session_id}/"]
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "function",
            "function": "cc_ee.preToolUseHook"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "function",
            "function": "cc_ee.postToolUseHook"
          }
        ]
      }
    ]
  },
  "enabledPlugins": {
    "<plugin-id>": true
  }
}
```

**关键配置说明**：

- `allowManagedHooksOnly: true`：锁定租户只能使用平台注入的 hooks，屏蔽所有用户级 hook
- `permissions.additionalDirectories`：限制文件访问范围在 session 工作目录内
- `hooks`：使用 `type: "function"` 而非 `type: "http"`，直接在 cc_ee 层拦截（进程内调用，无网络开销）

### 4.5 Session 终止与归档流程

```
1. 用户在 Web UI 点击 "结束会话" 或 session 超时
   ↓
2. cc_ee Service 执行：
   a. 调用 cc_core 终止 session（进程内调用）

   b. 打包 session 上下文：
      - transcript JSONL
      - 工作目录

   c. 上传归档包到 OSS：
      - 路径：/archives/{tenant_id}/{session_id}/{timestamp}.tar.gz

   d. 更新 session 状态到数据库：
      - status = 'terminated'
      - oss_archive_path = '/archives/{tenant_id}/{session_id}/{timestamp}.tar.gz'

   e. 清理本地工作目录（异步）
   ↓
3. cc_ee 返回成功给 Web UI
```

---
## 5. Hook 拦截机制（cc_ee 层）

### 5.1 Hook 拦截架构

在新架构中，Hook 拦截在 **cc_ee 层**实现，而非独立的 HTTP 服务。

```
cc_ee Service
  ├── preToolUseHook(tool_name, input, session_context)
  │   ├── 检查 token 预算
  │   ├── 检查 deny 规则
  │   ├── 写入审计日志
  │   └── 返回 allow/block 决策
  │
  └── postToolUseHook(tool_name, output, usage, session_context)
      ├── 更新 token 账本
      ├── 更新 session last_active_at
      └── 写入审计日志
```

### 5.2 PreToolUse Hook（工具执行前）

**触发时机**：cc_core 准备执行工具调用前

**输入参数**：
```typescript
interface PreToolUseInput {
  tool_name: string;
  input: Record<string, any>;
  session_context: {
    session_id: string;
    tenant_id: string;
    user_id: string;
  };
}
```

**处理逻辑**：

```typescript
async function preToolUseHook(params: PreToolUseInput): Promise<HookResult> {
  const { tool_name, input, session_context } = params;
  const { tenant_id, session_id, user_id } = session_context;

  // 1. 检查 token 预算（使用 PostgreSQL 行级锁）
  const tokenCheck = await checkTokenBudget(tenant_id);
  if (!tokenCheck.allowed) {
    await logToolAudit({
      session_id,
      tenant_id,
      user_id,
      tool_name,
      input_snapshot: input,
      hook_decision: 'block',
      reason: 'token_budget_exhausted'
    });

    return {
      exit_code: 2,
      stderr: 'Token budget exhausted for this month. Please contact your administrator.'
    };
  }

  // 2. 检查 deny 规则
  const tenant = await getTenant(tenant_id);
  const denyRules = tenant.permission_rules.deny || [];

  for (const rule of denyRules) {
    if (matchRule(tool_name, input, rule)) {
      await logToolAudit({
        session_id,
        tenant_id,
        user_id,
        tool_name,
        input_snapshot: input,
        hook_decision: 'block',
        reason: 'deny_rule_matched'
      });

      return {
        exit_code: 2,
        stderr: `Tool blocked by tenant policy: ${rule}`
      };
    }
  }

  // 3. 记录审计日志（允许执行）
  await logToolAudit({
    session_id,
    tenant_id,
    user_id,
    tool_name,
    input_snapshot: input,
    hook_decision: 'allow'
  });

  // 4. 返回允许执行
  return {
    exit_code: 0,
    stderr: ''
  };
}
```

**Token 预算检查（使用 PostgreSQL 行级锁）**：

```typescript
async function checkTokenBudget(tenant_id: string): Promise<{ allowed: boolean }> {
  const period = getCurrentPeriod(); // YYYY-MM

  // 使用 SELECT FOR UPDATE 锁定行
  const result = await db.query(`
    SELECT total_budget, used
    FROM token_ledgers
    WHERE tenant_id = $1 AND period = $2
    FOR UPDATE
  `, [tenant_id, period]);

  if (result.rows.length === 0) {
    // 如果没有记录，创建一个
    await db.query(`
      INSERT INTO token_ledgers (tenant_id, period, total_budget, used)
      VALUES ($1, $2, (SELECT token_budget_monthly FROM tenants WHERE id = $1), 0)
    `, [tenant_id, period]);

    return { allowed: true };
  }

  const { total_budget, used } = result.rows[0];

  // 检查是否超限
  if (used >= total_budget) {
    return { allowed: false };
  }

  return { allowed: true };
}
```

**响应格式**：

```typescript
interface HookResult {
  exit_code: 0 | 2;  // 0=允许, 2=阻断
  stderr: string;    // exit_code=2 时，错误信息会返回给模型
}
```

**关键机制**：`exit_code=2` 是 cc_core 的原生语义，会将 stderr 返回给模型，工具调用被阻断。**完全不需要 patch cc_core**。

### 5.3 PostToolUse Hook（工具执行后）

**触发时机**：cc_core 执行工具调用后

**输入参数**：
```typescript
interface PostToolUseInput {
  tool_name: string;
  output: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  session_context: {
    session_id: string;
    tenant_id: string;
    user_id: string;
  };
}
```

**处理逻辑**：

```typescript
async function postToolUseHook(params: PostToolUseInput): Promise<void> {
  const { tool_name, output, usage, session_context } = params;
  const { tenant_id, session_id, user_id } = session_context;

  // 1. 更新 token 账本（使用 PostgreSQL 行级锁）
  await updateTokenUsage(tenant_id, usage.input_tokens + usage.output_tokens);

  // 2. 更新 session last_active_at
  await db.query(`
    UPDATE sessions
    SET last_active_at = NOW()
    WHERE id = $1
  `, [session_id]);

  // 3. 写入审计日志（补充 tokens_delta）
  await db.query(`
    UPDATE tool_audit_logs
    SET tokens_delta = $1
    WHERE session_id = $2 AND tool_name = $3 AND timestamp = (
      SELECT MAX(timestamp) FROM tool_audit_logs WHERE session_id = $2 AND tool_name = $3
    )
  `, [usage.input_tokens + usage.output_tokens, session_id, tool_name]);
}
```

**Token 使用更新（使用 PostgreSQL 行级锁）**：

```typescript
async function updateTokenUsage(tenant_id: string, tokens: number): Promise<void> {
  const period = getCurrentPeriod(); // YYYY-MM

  // 使用 SELECT FOR UPDATE 锁定行，然后更新
  await db.query(`
    UPDATE token_ledgers
    SET used = used + $1, last_updated_at = NOW()
    WHERE tenant_id = $2 AND period = $3
  `, [tokens, tenant_id, period]);
}
```

### 5.4 Hook 配置（managed-settings.json）

在 managed-settings.json 中，hooks 配置为 `type: "function"`，直接在 cc_ee 层拦截（进程内调用，无网络开销）：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "function",
            "function": "cc_ee.preToolUseHook"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "function",
            "function": "cc_ee.postToolUseHook"
          }
        ]
      }
    ]
  }
}
```

**关键优势**：
- **零网络开销**：进程内调用，无 HTTP 往返
- **简化部署**：无需独立的 Hook Interceptor 服务
- **统一认证**：无需 Hook Interceptor 认证机制（因为在同一进程内）

---
## 6. Skill 仓库与动态分配

### 6.1 平台 Skill 仓库

```
PostgreSQL skills 表
  ├── 官方 Skill（平台预置，is_official=true）
  │   ├── 版本化管理（version 字段）
  │   └── 平台团队维护
  └── （未来扩展：租户私有 Skill，需审核）
```

### 6.2 租户管理员操作流

```
1. 在 Admin UI 浏览 Skill 仓库（列表展示 name, description, version）
   ↓
2. 勾选激活 skill → 写入 tenants.enabled_skill_ids[]
   ↓
3. 下次新建 Session 时：
   - cc_ee Service 从数据库读取 enabled_skill_ids
   - 将对应 skills.content 写入 session 工作目录的 .claude/skills/
   ↓
4. cc_core 启动自动加载（存量 session 需重启才能感知变化）
```

### 6.3 Skill 版本策略

- **固定版本**：租户激活 skill 时，记录当前版本号（如 `enabled_skill_ids = ["skill-a@1.2.0"]`）
- **手动升级**：平台升级 skill 不自动推送给租户，租户管理员手动选择升级
- **原因**：避免生产环境突变，租户可以在测试环境验证新版本后再升级

### 6.4 Skill 安全扫描

**官方 Skill 发布前进行安全扫描**：

1. **静态分析**：
   - 检查恶意命令（如 `rm -rf`, `dd`, `curl | bash`）
   - 检查敏感信息泄露（如硬编码的 API key、密码）
   - 检查不安全的工具调用模式

2. **人工审核**：
   - 平台团队审核 Skill 内容
   - 确保 Skill 符合平台规范

3. **版本控制**：
   - 每次 Skill 更新都需要重新扫描和审核
   - 版本号递增（如 1.2.0 → 1.2.1）

---
## 7. 安全边界总结

| 威胁 | 防御机制 |
|---|---|
| **租户间数据泄露** | 应用层隔离：每个 session 独立工作目录，`additionalDirectories` 限制文件访问范围 |
| **Token 超支** | PreToolUse hook 检查账本（PostgreSQL 行级锁），超限返回 exit_code=2 阻断 |
| **恶意工具调用** | `deny` 规则 + PreToolUse 动态拦截，`allowManagedHooksOnly` 锁定 |
| **用户注入恶意 hook** | `allowManagedHooksOnly=true` 屏蔽所有非 managed 层 hook |
| **Session 中途修改配置** | cc_core 的 hooks snapshot 机制（session 启动时快照，中途修改无效）|
| **进程级资源耗尽** | 进程级资源限制（CPU、内存、磁盘），通过 Docker/K8s 限制 |
| **文件系统隔离** | `permissions.additionalDirectories` 限制访问范围，deny 规则阻断危险命令 |
| **Skill 内容安全** | 官方 Skill 发布前进行安全扫描（静态分析 + 人工审核）|
| **Session 数据泄露** | Session 终止后自动归档到 OSS，本地工作目录清理 |

### 7.1 应用层隔离机制

在单进程多 session 架构下，隔离机制从进程级变为应用层：

1. **文件系统隔离**：
   - 每个 session 独立工作目录：`/sessions/{tenant_id}/{session_id}/`
   - `permissions.additionalDirectories` 限制文件访问范围
   - cc_core 的 sandbox 机制（bubblewrap/macOS sandbox）仍然生效

2. **内存隔离**：
   - cc_core 配置去除跨 session 共享能力
   - 每个 session 感觉自己是独立在跑的

3. **执行隔离**：
   - 每个 session 的工具调用独立执行
   - 一个 session 的错误不影响其他 session

### 7.2 安全边界变更说明

**相比初版设计的变更**：

1. **从进程级隔离变为应用层隔离**：
   - 原因：单进程多 session 架构
   - 影响：需要在 cc_ee 层实现更严格的隔离机制

2. **Hook 拦截从 HTTP 服务变为进程内调用**：
   - 原因：简化部署，降低延迟
   - 影响：无需 Hook Interceptor 认证机制

3. **Session 持久化到 OSS**：
   - 原因：支持 Pod 重启后恢复
   - 影响：需要实现 OSS 归档和恢复机制

---
## 8. 实施路线图

### Phase 1a：后端核心（2-3 周）

**目标**：搭建后端核心架构，实现单租户单用户单 session 的端到端流程

**任务**：
1. 数据库 schema 设计与初始化
2. Control Plane API 开发（租户/用户 CRUD）
3. cc_ee Service 开发：
   - 多租户编排层框架
   - Session 生命周期管理
   - managed-settings.json 动态生成
   - Hook 拦截机制（PreToolUse/PostToolUse）
   - 动态上下文组装
4. cc_ee + cc_core 打包集成
5. Session 持久化到 OSS（归档和恢复）

**验收标准**：
- 能创建租户和用户
- 能通过 API 启动一个 cc_core session
- PreToolUse hook 能阻断工具调用
- PostToolUse hook 能记录 token 消耗
- Session 终止后能归档到 OSS
- Session 能从 OSS 恢复

---

### Phase 1b：前端接入（2-3 周）

**目标**：实现 Web UI 和 API Gateway，用户可以通过浏览器使用平台

**任务**：
1. API Gateway 开发（认证、路由、限流）
2. Web UI 基础框架：
   - 登录/注册界面
   - 对话界面（类似 Claude.ai）
   - Session 管理界面
3. WebSocket 连接管理（基础版本）
4. 租户管理后台（Admin UI）：
   - 租户/用户管理
   - Token 使用情况仪表盘
   - Skill 管理界面

**验收标准**：
- 用户能通过 Web UI 登录
- 用户能创建新会话并对话
- 用户能查看 token 使用情况
- 租户管理员能勾选激活 skill

---

### Phase 2：多租户隔离与 Token 管控增强（3-4 周）

**目标**：实现多租户并发、token 预算限流、LLM Proxy 双重校验

**任务**：
1. cc_ee Service 多 session 并发管理
2. Token 预算检查逻辑优化（PostgreSQL 行级锁）
3. Token 账本更新逻辑优化
4. **LLM Proxy 开发**（新增）：
   - 透明代理 Anthropic API
   - Token 计量校验
   - 每日批量对账机制
5. 租户级 permission 规则引擎完善
6. Web UI 租户管理后台增强

**验收标准**：
- 能同时运行多个租户的 session，互不干扰
- Token 超限时，新工具调用被阻断
- LLM Proxy 和 Hook 拦截的 token 计数误差 < 5%
- 租户管理员能配置 permission 规则

---

### Phase 3：Skill 仓库与动态配置（2-3 周）

**目标**：实现 Skill 管理和租户级动态分配

**任务**：
1. Skill 仓库数据模型与 API
2. 平台官方 Skill 预置（从 cc_core 的 bundled skills 迁移）
3. cc_ee Service 的 Skill 注入逻辑
4. Web UI Skill 管理界面（租户管理员勾选激活）
5. Skill 版本管理机制
6. Skill 安全扫描（静态分析 + 人工审核）

**验收标准**：
- 租户管理员能在 UI 上勾选 skill
- 新建 session 时，只加载租户激活的 skill
- 不同租户的 session 有不同的 skill 集合
- 官方 Skill 发布前经过安全扫描

---

### Phase 4：安全加固与监控（2-3 周）

**目标**：生产级安全和可观测性

**任务**：
1. 工具调用审计日志完善（input_snapshot 脱敏）
2. 异常检测与告警（token 异常消耗、工具调用频率异常）
3. Session 健康检查与自动重启
4. 进程资源限制（CPU、内存、磁盘）
5. 监控仪表盘（Grafana + Prometheus）
6. 日志聚合（ELK 或 Loki）

**验收标准**：
- 所有工具调用都有审计日志
- Token 异常消耗能在 5 分钟内告警
- Session 崩溃能自动重启
- 监控仪表盘能实时展示系统健康状态

---

### Phase 5：性能优化与扩展（持续）

**目标**：支撑数千并发 session

**任务**：
1. cc_ee Service 水平扩展（多 Pod 负载均衡）
2. Session 路由优化（session affinity）
3. PostgreSQL 读写分离与连接池优化
4. Redis 缓存热点数据（租户配置、skill 内容）
5. WebSocket 连接管理优化（心跳、断线重连）
6. 压力测试与性能调优

**验收标准**：
- 支持 2000+ 并发 session
- Session 冷启动延迟 < 1s
- API 响应时间 P99 < 500ms

---
## 9. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| **单进程多 session 的故障隔离** | 一个 session 的问题可能影响其他 session | cc_core 配置去除跨 session 共享能力；异常检测与自动重启 |
| **Token 计数不准确** | 租户超支或误拦截 | PostgreSQL 行级锁 + LLM Proxy 双重校验；定期对账；人工复核异常 |
| **Skill 注入失败** | Session 启动失败 | Skill 内容预校验；启动失败自动回滚 |
| **OSS 归档失败** | Session 数据丢失 | 本地备份 + OSS 双写；归档失败告警 |
| **cc_core 版本升级** | 新版本 API 不兼容 | 版本锁定；升级前在测试环境验证；灰度发布 |
| **应用层隔离不足** | 租户间数据泄露 | 严格的文件访问范围限制；定期安全审计 |

---
## 10. 未来扩展

### 10.1 租户私有 Skill

- 租户可以上传自己的 Skill（Markdown + YAML frontmatter）
- 平台审核后上线（安全扫描、语法检查）
- 租户私有 Skill 只对该租户可见

### 10.2 用户级 Token 配额

- 在租户总配额下，再分配用户子配额
- 用户超限时，只阻断该用户的 session，不影响其他用户

### 10.3 多模型支持

- 支持切换不同的 LLM 模型（GPT-4、Claude、开源模型）
- 租户级模型配置

### 10.4 Session 协作

- 多个用户可以加入同一个 session
- 实时协作编辑

---
## 11. 总结

本设计方案通过 **cc_ee 编排层 + 单进程多 session** 的架构，在 **零侵入 cc_core** 的前提下，实现了企业级 SaaS 多租户 Agent 平台的核心能力：

1. **多租户隔离**：应用层隔离 + 文件系统级隔离
2. **Token 管控**：PostgreSQL 行级锁 + LLM Proxy 双重计量
3. **动态 Skill**：managed-settings.json + 租户级配置
4. **Session 持久化**：OSS 归档和恢复，支持 Pod 重启

关键优势：
- **零改造**：完全利用 cc_core 的原生扩展点
- **安全可控**：多层防御，租户间完全隔离
- **易于维护**：cc_core 升级不影响平台层逻辑
- **高效部署**：单进程多 session，资源利用率高

关键架构变更（相比初版设计）：
- **从"每 session 一个进程"改为"单进程多 session"**
- **引入 cc_ee 层作为企业级编排层**
- **Hook 拦截从 HTTP 服务变为进程内调用**
- **Session 状态持久化到 OSS**
- **Token 计数使用 PostgreSQL 行级锁**
- **实施路线图优化：Phase 1 分解为 Phase 1a 和 Phase 1b**

下一步：按照实施路线图，从 Phase 1a 开始逐步实现。

---
