# 企业级 Agent 平台逻辑分层关系架构文档

**版本**: 1.0
**日期**: 2026-04-06
**状态**: Architecture Design
**基于**: 技术设计文档 v2.0

---

## 1. 概述

### 1.1 架构目标

本文档定义企业级 Agent 平台的逻辑分层关系架构，为开发团队提供清晰的模块划分、接口契约和实现指导。

**核心目标**：
1. **清晰的职责边界**：每层有明确的职责，避免职责混淆
2. **松耦合设计**：层与层之间通过接口通信，降低耦合度
3. **可测试性**：每层可独立测试，支持单元测试和集成测试
4. **可扩展性**：支持水平扩展和功能扩展
5. **可维护性**：代码结构清晰，易于理解和维护

### 1.2 核心设计原则

1. **零侵入 cc_core**：所有企业级能力在 cc_ee 层实现，不修改 cc_core 代码
2. **单进程多 session**：一个 cc_core 进程管理多个 session，提高资源利用率
3. **应用层隔离**：通过应用层机制实现租户间隔离，而非进程级隔离
4. **进程内 Hook**：Hook 拦截在 cc_ee 层通过进程内调用实现，避免网络开销
5. **状态持久化**：Session 状态持久化到 OSS，支持故障恢复

### 1.3 关键架构决策

| 决策 | 说明 | 理由 |
|------|------|------|
| **单进程多 session** | 一个 cc_core 进程管理多个 session | 资源利用率高，简化部署 |
| **cc_ee 编排层** | 在 cc_core 外增加企业级编排层 | 零侵入 cc_core，职责清晰 |
| **进程内 Hook** | Hook 拦截通过进程内调用实现 | 零网络开销，简化部署 |
| **PostgreSQL 行级锁** | Token 计数使用行级锁 | 强一致性，避免竞态条件 |
| **OSS 持久化** | Session 状态持久化到 OSS | 支持 Pod 重启后恢复 |

---
## 2. 模块分层架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                        Presentation Layer                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Web UI (React)                         │  │
│  │  - 对话界面  - Session 管理  - 租户管理后台               │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTP / WebSocket
┌────────────────────────────▼────────────────────────────────────┐
│                         Gateway Layer                            │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                  API Gateway (Fastify)                    │  │
│  │  - JWT 认证  - 租户路由  - 限流  - 会话路由               │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────┬───────────────────────────┬────────────────────┘
                 │                           │
┌────────────────▼──────────────┐  ┌─────────▼────────────────────┐
│      Business Logic Layer      │  │   Orchestration Layer        │
│  ┌──────────────────────────┐ │  │  ┌────────────────────────┐ │
│  │   Control Plane Service  │ │  │  │   cc_ee Service        │ │
│  │  - 租户 CRUD             │ │  │  │  - 多租户编排          │ │
│  │  - 用户管理              │◄┼──┼─►│  - 多会话管理          │ │
│  │  - Token 预算账本        │ │  │  │  - Hook 拦截           │ │
│  │  - Skill 仓库 & 分配     │ │  │  │  - 动态上下文组装      │ │
│  │  - 权限规则引擎          │ │  │  │  - Session 持久化      │ │
│  └──────────────────────────┘ │  │  └────────┬───────────────┘ │
└────────────────────────────────┘  └───────────┼─────────────────┘
                                                 │ 进程内调用
                                    ┌────────────▼─────────────────┐
                                    │      Agent Core Layer        │
                                    │  ┌────────────────────────┐ │
                                    │  │  cc_core (单进程多会话) │ │
                                    │  │  - Session A           │ │
                                    │  │  - Session B           │ │
                                    │  │  - Session C           │ │
                                    │  └────────────────────────┘ │
                                    └──────────────────────────────┘
                                                 │
┌────────────────────────────────────────────────▼────────────────┐
│                      Data Access Layer                           │
│  ┌──────────────────┐  ┌──────────────┐  ┌──────────────────┐ │
│  │   PostgreSQL     │  │     OSS      │  │  Anthropic API   │ │
│  │  - 租户数据      │  │  - Session   │  │  - LLM 调用      │ │
│  │  - 用户数据      │  │    归档      │  │                  │ │
│  │  - Token 账本    │  │              │  │                  │ │
│  └──────────────────┘  └──────────────┘  └──────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 各层职责与依赖关系

#### 2.2.1 Presentation Layer（表现层）

**职责**：
- 用户界面展示
- 用户交互处理
- WebSocket 连接管理
- 前端状态管理

**依赖**：
- 依赖 Gateway Layer 提供的 API

**技术栈**：
- React + TypeScript
- WebSocket Client
- State Management (Zustand/Redux)

#### 2.2.2 Gateway Layer（网关层）

**职责**：
- JWT 认证与授权
- 租户路由（根据 tenant_id 路由到对应服务）
- API 限流（防止滥用）
- 会话路由（将请求路由到正确的 cc_ee Service 实例）
- 请求/响应转换

**依赖**：
- 依赖 Business Logic Layer 和 Orchestration Layer

**技术栈**：
- Node.js + Fastify
- JWT 库
- Rate Limiter

#### 2.2.3 Business Logic Layer（业务逻辑层）

**职责**：
- 租户管理（CRUD）
- 用户管理（CRUD）
- Token 预算管理
- Skill 仓库管理
- 权限规则引擎

**依赖**：
- 依赖 Data Access Layer（PostgreSQL）

**技术栈**：
- Node.js + TypeScript
- PostgreSQL Client

#### 2.2.4 Orchestration Layer（编排层）

**职责**：
- 多租户编排
- 多会话管理
- Hook 拦截（PreToolUse/PostToolUse）
- 动态上下文组装
- Session 持久化（归档/恢复）
- 与 cc_core 的集成

**依赖**：
- 依赖 Agent Core Layer（cc_core）
- 依赖 Data Access Layer（PostgreSQL + OSS）

**技术栈**：
- Node.js + TypeScript
- cc_core（作为库引入）

#### 2.2.5 Agent Core Layer（Agent 核心层）

**职责**：
- Agent 核心能力（对话、工具调用、推理）
- 单进程多 session 管理
- Hook 机制
- Skill 加载

**依赖**：
- 依赖 Anthropic API

**技术栈**：
- cc_core（原生）

#### 2.2.6 Data Access Layer（数据访问层）

**职责**：
- 数据持久化
- 数据查询
- 事务管理

**技术栈**：
- PostgreSQL（结构化数据）
- OSS（Session 归档）
- Anthropic API（LLM 调用）

### 2.3 接口契约

#### 2.3.1 层间通信协议

| 层间通信 | 协议 | 数据格式 |
|---------|------|---------|
| Presentation ↔ Gateway | HTTP/WebSocket | JSON |
| Gateway ↔ Business Logic | HTTP | JSON |
| Gateway ↔ Orchestration | HTTP | JSON |
| Orchestration ↔ Agent Core | 进程内调用 | TypeScript 对象 |
| Business Logic ↔ Data Access | SQL | 结构化数据 |
| Orchestration ↔ Data Access | SQL + HTTP | 结构化数据 + 二进制 |

#### 2.3.2 错误处理契约

所有层间通信遵循统一的错误处理契约：

```typescript
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}
```

错误码规范：
- `AUTH_*`: 认证相关错误（401）
- `PERM_*`: 权限相关错误（403）
- `NOTFOUND_*`: 资源不存在（404）
- `CONFLICT_*`: 冲突错误（409）
- `LIMIT_*`: 限流/配额错误（429）
- `INTERNAL_*`: 内部错误（500）

---
## 3. 核心模块设计

### 3.1 cc_ee Service 模块

#### 3.1.1 模块职责

cc_ee Service 是企业级编排层的核心，负责：
- 多租户编排与隔离
- 多会话生命周期管理
- Hook 拦截（PreToolUse/PostToolUse）
- 动态上下文组装
- Session 持久化（归档/恢复）
- 与 cc_core 的集成

#### 3.1.2 核心类设计

```typescript
/**
 * cc_ee Service 主类
 * 负责协调所有企业级能力
 */
class CcEeService {
  private sessionManager: SessionManager;
  private hookInterceptor: HookInterceptor;
  private contextAssembler: ContextAssembler;
  private sessionPersistence: SessionPersistence;
  private ccCoreAdapter: CcCoreAdapter;

  constructor(
    private config: CcEeConfig,
    private db: DatabaseClient,
    private oss: OssClient
  ) {
    this.sessionManager = new SessionManager(db, oss);
    this.hookInterceptor = new HookInterceptor(db);
    this.contextAssembler = new ContextAssembler(db);
    this.sessionPersistence = new SessionPersistence(oss);
    this.ccCoreAdapter = new CcCoreAdapter();
  }

  /**
   * 启动新 Session
   */
  async startSession(request: StartSessionRequest): Promise<StartSessionResponse> {
    // 1. 检查 token 预算
    await this.checkTokenBudget(request.tenantId);

    // 2. 动态组装上下文
    const context = await this.contextAssembler.assemble(request);

    // 3. 生成 managed-settings.json
    const settings = await this.generateManagedSettings(request.tenantId);

    // 4. 写入工作目录
    await this.writeSessionContext(context, settings);

    // 5. 调用 cc_core 启动 session
    const sessionId = await this.ccCoreAdapter.startSession(context);

    // 6. 记录到数据库
    await this.sessionManager.recordSession(sessionId, request);

    return { sessionId };
  }

  /**
   * 恢复 Session
   */
  async resumeSession(sessionId: string): Promise<void> {
    // 1. 从数据库查询 session
    const session = await this.sessionManager.getSession(sessionId);

    // 2. 从 OSS 下载归档包
    const archive = await this.sessionPersistence.download(session.ossArchivePath);

    // 3. 解压到工作目录
    await this.sessionPersistence.extract(archive, session.workingDir);

    // 4. 动态组装上下文
    const context = await this.contextAssembler.assemble({
      tenantId: session.tenantId,
      userId: session.userId,
      sessionId: session.id
    });

    // 5. 调用 cc_core 恢复 session
    await this.ccCoreAdapter.resumeSession(sessionId, context);

    // 6. 更新数据库状态
    await this.sessionManager.updateStatus(sessionId, 'active');
  }

  /**
   * 终止 Session
   */
  async terminateSession(sessionId: string): Promise<void> {
    // 1. 调用 cc_core 终止 session
    await this.ccCoreAdapter.terminateSession(sessionId);

    // 2. 打包 session 上下文
    const session = await this.sessionManager.getSession(sessionId);
    const archive = await this.sessionPersistence.pack(session.workingDir);

    // 3. 上传到 OSS
    const ossPath = await this.sessionPersistence.upload(archive, session.tenantId, sessionId);

    // 4. 更新数据库
    await this.sessionManager.updateSession(sessionId, {
      status: 'terminated',
      ossArchivePath: ossPath
    });

    // 5. 清理本地工作目录（异步）
    this.sessionPersistence.cleanup(session.workingDir).catch(console.error);
  }
}

/**
 * Session 管理器
 * 负责 Session 的生命周期管理
 */
class SessionManager {
  constructor(
    private db: DatabaseClient,
    private oss: OssClient
  ) {}

  async recordSession(sessionId: string, request: StartSessionRequest): Promise<void> {
    await this.db.query(`
      INSERT INTO sessions (id, tenant_id, user_id, working_dir, status, node_id)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      sessionId,
      request.tenantId,
      request.userId,
      `/sessions/${request.tenantId}/${sessionId}/`,
      'active',
      process.env.NODE_ID
    ]);
  }

  async getSession(sessionId: string): Promise<Session> {
    const result = await this.db.query(`
      SELECT * FROM sessions WHERE id = $1
    `, [sessionId]);

    if (result.rows.length === 0) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    return result.rows[0];
  }

  async updateStatus(sessionId: string, status: SessionStatus): Promise<void> {
    await this.db.query(`
      UPDATE sessions SET status = $1, last_active_at = NOW() WHERE id = $2
    `, [status, sessionId]);
  }

  async updateSession(sessionId: string, updates: Partial<Session>): Promise<void> {
    const fields = Object.keys(updates).map((key, i) => `${key} = $${i + 2}`).join(', ');
    const values = Object.values(updates);

    await this.db.query(`
      UPDATE sessions SET ${fields} WHERE id = $1
    `, [sessionId, ...values]);
  }
}

/**
 * Hook 拦截器
 * 负责 PreToolUse 和 PostToolUse 的拦截逻辑
 */
class HookInterceptor {
  constructor(private db: DatabaseClient) {}

  /**
   * PreToolUse Hook
   * 在工具执行前进行检查
   */
  async preToolUseHook(params: PreToolUseInput): Promise<HookResult> {
    const { tool_name, input, session_context } = params;
    const { tenant_id, session_id, user_id } = session_context;

    // 1. 检查 token 预算（使用 PostgreSQL 行级锁）
    const tokenCheck = await this.checkTokenBudget(tenant_id);
    if (!tokenCheck.allowed) {
      await this.logToolAudit({
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
    const tenant = await this.getTenant(tenant_id);
    const denyRules = tenant.permission_rules.deny || [];

    for (const rule of denyRules) {
      if (this.matchRule(tool_name, input, rule)) {
        await this.logToolAudit({
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
    await this.logToolAudit({
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

  /**
   * PostToolUse Hook
   * 在工具执行后进行记录和更新
   */
  async postToolUseHook(params: PostToolUseInput): Promise<void> {
    const { tool_name, output, usage, session_context } = params;
    const { tenant_id, session_id, user_id } = session_context;

    // 1. 更新 token 账本（使用 PostgreSQL 行级锁）
    await this.updateTokenUsage(tenant_id, usage.input_tokens + usage.output_tokens);

    // 2. 更新 session last_active_at
    await this.db.query(`
      UPDATE sessions SET last_active_at = NOW() WHERE id = $1
    `, [session_id]);

    // 3. 写入审计日志（补充 tokens_delta）
    await this.db.query(`
      UPDATE tool_audit_logs
      SET tokens_delta = $1
      WHERE session_id = $2 AND tool_name = $3 AND timestamp = (
        SELECT MAX(timestamp) FROM tool_audit_logs WHERE session_id = $2 AND tool_name = $3
      )
    `, [usage.input_tokens + usage.output_tokens, session_id, tool_name]);
  }

  /**
   * 检查 token 预算（使用 PostgreSQL 行级锁）
   */
  private async checkTokenBudget(tenant_id: string): Promise<{ allowed: boolean }> {
    const period = this.getCurrentPeriod(); // YYYY-MM

    // 使用 SELECT FOR UPDATE 锁定行
    const result = await this.db.query(`
      SELECT total_budget, used
      FROM token_ledgers
      WHERE tenant_id = $1 AND period = $2
      FOR UPDATE
    `, [tenant_id, period]);

    if (result.rows.length === 0) {
      // 如果没有记录，创建一个
      await this.db.query(`
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

  /**
   * 更新 token 使用量（使用 PostgreSQL 行级锁）
   */
  private async updateTokenUsage(tenant_id: string, tokens: number): Promise<void> {
    const period = this.getCurrentPeriod(); // YYYY-MM

    // 使用 SELECT FOR UPDATE 锁定行，然后更新
    await this.db.query(`
      UPDATE token_ledgers
      SET used = used + $1, last_updated_at = NOW()
      WHERE tenant_id = $2 AND period = $3
    `, [tokens, tenant_id, period]);
  }

  private getCurrentPeriod(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  private async getTenant(tenant_id: string): Promise<Tenant> {
    const result = await this.db.query(`
      SELECT * FROM tenants WHERE id = $1
    `, [tenant_id]);

    return result.rows[0];
  }

  private matchRule(tool_name: string, input: any, rule: string): boolean {
    // 规则匹配逻辑（简化版）
    // 实际实现需要支持通配符、正则表达式等
    return tool_name === rule || rule.includes('*');
  }

  private async logToolAudit(log: ToolAuditLog): Promise<void> {
    await this.db.query(`
      INSERT INTO tool_audit_logs (session_id, tenant_id, user_id, tool_name, input_snapshot, hook_decision)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      log.session_id,
      log.tenant_id,
      log.user_id,
      log.tool_name,
      JSON.stringify(log.input_snapshot),
      log.hook_decision
    ]);
  }
}

/**
 * 上下文组装器
 * 负责动态组装 Session 上下文
 */
class ContextAssembler {
  constructor(private db: DatabaseClient) {}

  async assemble(request: StartSessionRequest): Promise<SessionContext> {
    // 1. 获取用户信息
    const user = await this.getUser(request.userId);

    // 2. 获取租户配置
    const tenant = await this.getTenant(request.tenantId);

    // 3. 获取 Skill 列表
    const skills = await this.getSkills(tenant.enabled_skill_ids);

    return {
      user: {
        user_id: user.id,
        email: user.email,
        role: user.role,
        tenant_id: tenant.id,
        tenant_name: tenant.name
      },
      tenant: {
        tenant_id: tenant.id,
        permission_rules: tenant.permission_rules,
        enabled_skill_ids: tenant.enabled_skill_ids
      },
      skills: skills.map(skill => ({
        id: skill.id,
        name: skill.name,
        content: skill.content,
        version: skill.version
      }))
    };
  }

  private async getUser(userId: string): Promise<User> {
    const result = await this.db.query(`
      SELECT * FROM users WHERE id = $1
    `, [userId]);

    return result.rows[0];
  }

  private async getTenant(tenantId: string): Promise<Tenant> {
    const result = await this.db.query(`
      SELECT * FROM tenants WHERE id = $1
    `, [tenantId]);

    return result.rows[0];
  }

  private async getSkills(skillIds: string[]): Promise<Skill[]> {
    if (skillIds.length === 0) {
      return [];
    }

    const result = await this.db.query(`
      SELECT * FROM skills WHERE id = ANY($1)
    `, [skillIds]);

    return result.rows;
  }
}

/**
 * Session 持久化
 * 负责 Session 的归档和恢复
 */
class SessionPersistence {
  constructor(private oss: OssClient) {}

  async pack(workingDir: string): Promise<Buffer> {
    // 打包工作目录为 tar.gz
    // 实现略
    return Buffer.from('');
  }

  async upload(archive: Buffer, tenantId: string, sessionId: string): Promise<string> {
    const timestamp = Date.now();
    const ossPath = `/archives/${tenantId}/${sessionId}/${timestamp}.tar.gz`;

    await this.oss.put(ossPath, archive);

    return ossPath;
  }

  async download(ossPath: string): Promise<Buffer> {
    return await this.oss.get(ossPath);
  }

  async extract(archive: Buffer, workingDir: string): Promise<void> {
    // 解压 tar.gz 到工作目录
    // 实现略
  }

  async cleanup(workingDir: string): Promise<void> {
    // 清理本地工作目录
    // 实现略
  }
}

/**
 * cc_core 适配器
 * 负责与 cc_core 的集成
 */
class CcCoreAdapter {
  async startSession(context: SessionContext): Promise<string> {
    // 调用 cc_core 启动 session
    // 实现略
    return 'session-id';
  }

  async resumeSession(sessionId: string, context: SessionContext): Promise<void> {
    // 调用 cc_core 恢复 session
    // 实现略
  }

  async terminateSession(sessionId: string): Promise<void> {
    // 调用 cc_core 终止 session
    // 实现略
  }
}
```

---
### 3.2 Control Plane 模块

#### 3.2.1 模块职责

Control Plane 负责管理平台的业务数据和规则：
- 租户管理（CRUD）
- 用户管理（CRUD）
- Token 预算管理
- Skill 仓库管理
- 权限规则引擎

#### 3.2.2 核心类设计

```typescript
/**
 * Control Plane Service 主类
 */
class ControlPlaneService {
  private tenantService: TenantService;
  private userService: UserService;
  private tokenBudgetService: TokenBudgetService;
  private skillService: SkillService;
  private permissionService: PermissionService;

  constructor(private db: DatabaseClient) {
    this.tenantService = new TenantService(db);
    this.userService = new UserService(db);
    this.tokenBudgetService = new TokenBudgetService(db);
    this.skillService = new SkillService(db);
    this.permissionService = new PermissionService(db);
  }
}

/**
 * 租户服务
 */
class TenantService {
  constructor(private db: DatabaseClient) {}

  async createTenant(data: CreateTenantRequest): Promise<Tenant> {
    const result = await this.db.query(`
      INSERT INTO tenants (id, name, status, token_budget_monthly, permission_rules)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `, [
      uuidv4(),
      data.name,
      'active',
      data.token_budget_monthly,
      JSON.stringify(data.permission_rules || {})
    ]);

    return result.rows[0];
  }

  async getTenant(tenantId: string): Promise<Tenant> {
    const result = await this.db.query(`
      SELECT * FROM tenants WHERE id = $1
    `, [tenantId]);

    if (result.rows.length === 0) {
      throw new Error(`Tenant not found: ${tenantId}`);
    }

    return result.rows[0];
  }

  async updateTenant(tenantId: string, updates: Partial<Tenant>): Promise<Tenant> {
    const fields = Object.keys(updates).map((key, i) => `${key} = $${i + 2}`).join(', ');
    const values = Object.values(updates);

    const result = await this.db.query(`
      UPDATE tenants SET ${fields}, updated_at = NOW() WHERE id = $1 RETURNING *
    `, [tenantId, ...values]);

    return result.rows[0];
  }

  async deleteTenant(tenantId: string): Promise<void> {
    await this.db.query(`
      UPDATE tenants SET status = 'deleted', updated_at = NOW() WHERE id = $1
    `, [tenantId]);
  }

  async listTenants(filters?: TenantFilters): Promise<Tenant[]> {
    let query = 'SELECT * FROM tenants WHERE status != $1';
    const params: any[] = ['deleted'];

    if (filters?.status) {
      query += ` AND status = $${params.length + 1}`;
      params.push(filters.status);
    }

    query += ' ORDER BY created_at DESC';

    const result = await this.db.query(query, params);
    return result.rows;
  }
}

/**
 * Token 预算服务
 */
class TokenBudgetService {
  constructor(private db: DatabaseClient) {}

  async getTokenUsage(tenantId: string, period?: string): Promise<TokenUsage> {
    const currentPeriod = period || this.getCurrentPeriod();

    const result = await this.db.query(`
      SELECT total_budget, used, last_updated_at
      FROM token_ledgers
      WHERE tenant_id = $1 AND period = $2
    `, [tenantId, currentPeriod]);

    if (result.rows.length === 0) {
      // 如果没有记录，从租户表获取预算
      const tenant = await this.db.query(`
        SELECT token_budget_monthly FROM tenants WHERE id = $1
      `, [tenantId]);

      return {
        total_budget: tenant.rows[0].token_budget_monthly,
        used: 0,
        remaining: tenant.rows[0].token_budget_monthly,
        period: currentPeriod
      };
    }

    const { total_budget, used } = result.rows[0];

    return {
      total_budget,
      used,
      remaining: total_budget - used,
      period: currentPeriod
    };
  }

  async updateTokenBudget(tenantId: string, newBudget: number): Promise<void> {
    await this.db.query(`
      UPDATE tenants SET token_budget_monthly = $1, updated_at = NOW() WHERE id = $2
    `, [newBudget, tenantId]);
  }

  private getCurrentPeriod(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
}

/**
 * Skill 服务
 */
class SkillService {
  constructor(private db: DatabaseClient) {}

  async createSkill(data: CreateSkillRequest): Promise<Skill> {
    const result = await this.db.query(`
      INSERT INTO skills (id, name, description, content, is_official, allowed_tools, version)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [
      uuidv4(),
      data.name,
      data.description,
      data.content,
      data.is_official || false,
      data.allowed_tools || [],
      data.version || '1.0.0'
    ]);

    return result.rows[0];
  }

  async getSkill(skillId: string): Promise<Skill> {
    const result = await this.db.query(`
      SELECT * FROM skills WHERE id = $1
    `, [skillId]);

    if (result.rows.length === 0) {
      throw new Error(`Skill not found: ${skillId}`);
    }

    return result.rows[0];
  }

  async listSkills(filters?: SkillFilters): Promise<Skill[]> {
    let query = 'SELECT * FROM skills WHERE 1=1';
    const params: any[] = [];

    if (filters?.is_official !== undefined) {
      query += ` AND is_official = $${params.length + 1}`;
      params.push(filters.is_official);
    }

    query += ' ORDER BY created_at DESC';

    const result = await this.db.query(query, params);
    return result.rows;
  }

  async updateSkill(skillId: string, updates: Partial<Skill>): Promise<Skill> {
    const fields = Object.keys(updates).map((key, i) => `${key} = $${i + 2}`).join(', ');
    const values = Object.values(updates);

    const result = await this.db.query(`
      UPDATE skills SET ${fields} WHERE id = $1 RETURNING *
    `, [skillId, ...values]);

    return result.rows[0];
  }

  async deleteSkill(skillId: string): Promise<void> {
    await this.db.query(`
      DELETE FROM skills WHERE id = $1
    `, [skillId]);
  }

  async enableSkillForTenant(tenantId: string, skillId: string): Promise<void> {
    await this.db.query(`
      UPDATE tenants
      SET enabled_skill_ids = array_append(enabled_skill_ids, $1)
      WHERE id = $2 AND NOT ($1 = ANY(enabled_skill_ids))
    `, [skillId, tenantId]);
  }

  async disableSkillForTenant(tenantId: string, skillId: string): Promise<void> {
    await this.db.query(`
      UPDATE tenants
      SET enabled_skill_ids = array_remove(enabled_skill_ids, $1)
      WHERE id = $2
    `, [skillId, tenantId]);
  }
}
```

### 3.3 API Gateway 模块

#### 3.3.1 模块职责

API Gateway 负责：
- JWT 认证与授权
- 租户路由
- API 限流
- 会话路由
- 请求/响应转换

#### 3.3.2 核心类设计

```typescript
/**
 * API Gateway 主类
 */
class ApiGateway {
  private authMiddleware: AuthMiddleware;
  private rateLimiter: RateLimiter;
  private tenantRouter: TenantRouter;
  private sessionRouter: SessionRouter;

  constructor(
    private config: GatewayConfig,
    private controlPlane: ControlPlaneClient,
    private ccEeService: CcEeServiceClient
  ) {
    this.authMiddleware = new AuthMiddleware(config.jwtSecret);
    this.rateLimiter = new RateLimiter(config.rateLimit);
    this.tenantRouter = new TenantRouter();
    this.sessionRouter = new SessionRouter();
  }

  async handleRequest(req: Request): Promise<Response> {
    try {
      // 1. 认证
      const authContext = await this.authMiddleware.authenticate(req);

      // 2. 限流
      await this.rateLimiter.checkLimit(authContext.tenantId, authContext.userId);

      // 3. 路由
      const route = this.getRoute(req.path);

      // 4. 转发请求
      const response = await this.forwardRequest(route, req, authContext);

      return response;
    } catch (error) {
      return this.handleError(error);
    }
  }

  private getRoute(path: string): Route {
    if (path.startsWith('/api/tenants')) {
      return { service: 'control-plane', path };
    } else if (path.startsWith('/api/sessions')) {
      return { service: 'cc-ee', path };
    } else {
      throw new Error(`Unknown route: ${path}`);
    }
  }

  private async forwardRequest(
    route: Route,
    req: Request,
    authContext: AuthContext
  ): Promise<Response> {
    if (route.service === 'control-plane') {
      return await this.controlPlane.request(route.path, req.body, authContext);
    } else if (route.service === 'cc-ee') {
      return await this.ccEeService.request(route.path, req.body, authContext);
    } else {
      throw new Error(`Unknown service: ${route.service}`);
    }
  }

  private handleError(error: any): Response {
    if (error.code === 'AUTH_FAILED') {
      return { status: 401, body: { error: 'Unauthorized' } };
    } else if (error.code === 'RATE_LIMIT_EXCEEDED') {
      return { status: 429, body: { error: 'Too many requests' } };
    } else {
      return { status: 500, body: { error: 'Internal server error' } };
    }
  }
}

/**
 * 认证中间件
 */
class AuthMiddleware {
  constructor(private jwtSecret: string) {}

  async authenticate(req: Request): Promise<AuthContext> {
    const token = this.extractToken(req);

    if (!token) {
      throw { code: 'AUTH_FAILED', message: 'No token provided' };
    }

    try {
      const payload = jwt.verify(token, this.jwtSecret) as JwtPayload;

      return {
        tenantId: payload.tenant_id,
        userId: payload.user_id,
        role: payload.role
      };
    } catch (error) {
      throw { code: 'AUTH_FAILED', message: 'Invalid token' };
    }
  }

  private extractToken(req: Request): string | null {
    const authHeader = req.headers['authorization'];

    if (!authHeader) {
      return null;
    }

    const parts = authHeader.split(' ');

    if (parts.length !== 2 || parts[0] !== 'Bearer') {
      return null;
    }

    return parts[1];
  }
}

/**
 * 限流器
 */
class RateLimiter {
  private limits: Map<string, RateLimitState> = new Map();

  constructor(private config: RateLimitConfig) {}

  async checkLimit(tenantId: string, userId: string): Promise<void> {
    const key = `${tenantId}:${userId}`;
    const now = Date.now();

    let state = this.limits.get(key);

    if (!state) {
      state = {
        count: 0,
        resetAt: now + this.config.windowMs
      };
      this.limits.set(key, state);
    }

    // 重置窗口
    if (now >= state.resetAt) {
      state.count = 0;
      state.resetAt = now + this.config.windowMs;
    }

    // 检查限制
    if (state.count >= this.config.maxRequests) {
      throw { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' };
    }

    state.count++;
  }
}
```

---
## 4. 关键流程设计

### 4.1 Session 启动流程

```
用户          Web UI       API Gateway    Control Plane    cc_ee Service    cc_core       PostgreSQL    OSS
 │              │               │                │                │              │              │           │
 │─新建对话────►│               │                │                │              │              │           │
 │              │               │                │                │              │              │           │
 │              │─POST /sessions─►               │                │              │              │           │
 │              │  +JWT         │                │                │              │              │           │
 │              │               │                │                │              │              │           │
 │              │               │─验证JWT────────►│                │              │              │           │
 │              │               │                │                │              │              │           │
 │              │               │                │─检查token预算──►│              │              │           │
 │              │               │                │                │              │              │           │
 │              │               │                │                │◄─SELECT──────┤              │           │
 │              │               │                │                │  token_ledgers              │           │
 │              │               │                │                │              │              │           │
 │              │               │                │◄───────────────┤              │              │           │
 │              │               │                │  预算OK        │              │              │           │
 │              │               │                │                │              │              │           │
 │              │               │─startSession───────────────────►│              │              │           │
 │              │               │                │                │              │              │           │
 │              │               │                │                │─组装上下文───►│              │           │
 │              │               │                │                │  (用户/租户/skill)           │           │
 │              │               │                │                │              │              │           │
 │              │               │                │                │◄─────────────┤              │           │
 │              │               │                │                │              │              │           │
 │              │               │                │                │─生成settings─►│              │           │
 │              │               │                │                │              │              │           │
 │              │               │                │                │─写入工作目录─►│              │           │
 │              │               │                │                │              │              │           │
 │              │               │                │                │─startSession─►│              │           │
 │              │               │                │                │  (进程内调用) │              │           │
 │              │               │                │                │              │              │           │
 │              │               │                │                │              │◄─启动session─┤           │
 │              │               │                │                │              │              │           │
 │              │               │                │                │◄─sessionId───┤              │           │
 │              │               │                │                │              │              │           │
 │              │               │                │                │─INSERT───────────────────►  │           │
 │              │               │                │                │  sessions表  │              │           │
 │              │               │                │                │              │              │           │
 │              │               │◄───────────────────────────────┤              │              │           │
 │              │               │  {sessionId}   │                │              │              │           │
 │              │               │                │                │              │              │           │
 │              │◄──────────────┤                │                │              │              │           │
 │              │  {sessionId}  │                │                │              │              │           │
 │              │               │                │                │              │              │           │
 │◄─────────────┤               │                │                │              │              │           │
   显示对话界面
```

### 4.2 Token 计数流程（PreToolUse + PostToolUse）

```
cc_core      cc_ee Service    PostgreSQL
  │               │                │
  │─工具调用前────►│                │
  │ preToolUseHook│                │
  │               │                │
  │               │─SELECT FOR UPDATE─►
  │               │  token_ledgers │
  │               │                │
  │               │◄───────────────┤
  │               │  {budget, used}│
  │               │                │
  │               │─检查: used < budget
  │               │                │
  │               │  [如果超限]    │
  │◄──exit_code=2─┤                │
  │  "预算耗尽"    │                │
  │               │                │
  │  [如果通过]    │                │
  │◄──exit_code=0─┤                │
  │               │                │
  │─执行工具──────►│                │
  │               │                │
  │─工具调用后────►│                │
  │ postToolUseHook                │
  │ {usage}       │                │
  │               │                │
  │               │─UPDATE─────────►│
  │               │  token_ledgers │
  │               │  used += tokens│
  │               │                │
  │               │◄───────────────┤
  │               │                │
  │◄──────────────┤                │
```

### 4.3 Session 持久化流程

#### 4.3.1 Session 归档流程

```
用户      Web UI    cc_ee Service    cc_core    OSS
 │           │            │              │        │
 │─结束会话─►│            │              │        │
 │           │            │              │        │
 │           │─terminate─►│              │        │
 │           │            │              │        │
 │           │            │─terminate────►│        │
 │           │            │              │        │
 │           │            │◄─────────────┤        │
 │           │            │              │        │
 │           │            │─打包上下文────►│        │
 │           │            │  (transcript+ │        │
 │           │            │   workingDir) │        │
 │           │            │              │        │
 │           │            │◄─archive.tar.gz       │
 │           │            │              │        │
 │           │            │─upload───────────────►│
 │           │            │              │        │
 │           │            │◄──────────────────────┤
 │           │            │  ossPath     │        │
 │           │            │              │        │
 │           │            │─UPDATE sessions       │
 │           │            │  status='terminated'  │
 │           │            │  oss_archive_path     │
 │           │            │              │        │
 │           │◄───────────┤              │        │
 │           │  success   │              │        │
 │           │            │              │        │
 │◄──────────┤            │              │        │
```

#### 4.3.2 Session 恢复流程

```
用户      Web UI    cc_ee Service    PostgreSQL    OSS    cc_core
 │           │            │                │         │        │
 │─恢复会话─►│            │                │         │        │
 │           │            │                │         │        │
 │           │─resume────►│                │         │        │
 │           │            │                │         │        │
 │           │            │─SELECT─────────►│         │        │
 │           │            │  sessions      │         │        │
 │           │            │                │         │        │
 │           │            │◄───────────────┤         │        │
 │           │            │  {session}     │         │        │
 │           │            │                │         │        │
 │           │            │─download───────────────►│        │
 │           │            │  ossPath       │         │        │
 │           │            │                │         │        │
 │           │            │◄────────────────────────┤        │
 │           │            │  archive.tar.gz         │        │
 │           │            │                │         │        │
 │           │            │─解压到工作目录──►│         │        │
 │           │            │                │         │        │
 │           │            │─组装上下文──────►│         │        │
 │           │            │                │         │        │
 │           │            │─resumeSession──────────────────►│
 │           │            │                │         │        │
 │           │            │◄────────────────────────────────┤
 │           │            │                │         │        │
 │           │            │─UPDATE─────────►│         │        │
 │           │            │  status='active'         │        │
 │           │            │                │         │        │
 │           │◄───────────┤                │         │        │
 │           │  success   │                │         │        │
 │           │            │                │         │        │
 │◄──────────┤            │                │         │        │
```

---
## 5. 接口规范

### 5.1 核心类型定义

```typescript
/**
 * 租户
 */
interface Tenant {
  id: string;
  name: string;
  status: 'active' | 'suspended' | 'deleted';
  token_budget_monthly: number;
  token_used_current: number;
  enabled_skill_ids: string[];
  permission_rules: PermissionRules;
  created_at: Date;
  updated_at: Date;
}

/**
 * 权限规则
 */
interface PermissionRules {
  allow: string[];
  deny: string[];
}

/**
 * 用户
 */
interface User {
  id: string;
  tenant_id: string;
  email: string;
  role: 'admin' | 'member';
  created_at: Date;
}

/**
 * Session
 */
interface Session {
  id: string;
  tenant_id: string;
  user_id: string;
  working_dir: string;
  status: 'active' | 'idle' | 'terminated';
  node_id: string;
  oss_archive_path?: string;
  created_at: Date;
  last_active_at: Date;
}

/**
 * Skill
 */
interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;
  is_official: boolean;
  allowed_tools: string[];
  version: string;
  created_at: Date;
}

/**
 * Token 账本
 */
interface TokenLedger {
  tenant_id: string;
  period: string; // YYYY-MM
  total_budget: number;
  used: number;
  last_updated_at: Date;
  version: number;
}

/**
 * 工具审计日志
 */
interface ToolAuditLog {
  id: number;
  session_id: string;
  tenant_id: string;
  user_id: string;
  tool_name: string;
  input_snapshot: any;
  hook_decision: 'allow' | 'block';
  tokens_delta?: number;
  timestamp: Date;
}

/**
 * Session 上下文
 */
interface SessionContext {
  user: {
    user_id: string;
    email: string;
    role: string;
    tenant_id: string;
    tenant_name: string;
  };
  tenant: {
    tenant_id: string;
    permission_rules: PermissionRules;
    enabled_skill_ids: string[];
  };
  skills: Array<{
    id: string;
    name: string;
    content: string;
    version: string;
  }>;
}

/**
 * Hook 输入参数
 */
interface PreToolUseInput {
  tool_name: string;
  input: Record<string, any>;
  session_context: {
    session_id: string;
    tenant_id: string;
    user_id: string;
  };
}

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

/**
 * Hook 返回结果
 */
interface HookResult {
  exit_code: 0 | 2;
  stderr: string;
}

/**
 * API 响应
 */
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
}
```

### 5.2 cc_ee Service 接口

```typescript
/**
 * cc_ee Service 对外接口
 */
interface ICcEeService {
  /**
   * 启动新 Session
   */
  startSession(request: StartSessionRequest): Promise<StartSessionResponse>;

  /**
   * 恢复 Session
   */
  resumeSession(sessionId: string): Promise<void>;

  /**
   * 终止 Session
   */
  terminateSession(sessionId: string): Promise<void>;

  /**
   * 获取 Session 状态
   */
  getSessionStatus(sessionId: string): Promise<SessionStatus>;

  /**
   * 发送消息到 Session
   */
  sendMessage(sessionId: string, message: string): Promise<MessageResponse>;
}

interface StartSessionRequest {
  tenantId: string;
  userId: string;
  resumeFromSessionId?: string;
}

interface StartSessionResponse {
  sessionId: string;
  workingDir: string;
}

interface SessionStatus {
  sessionId: string;
  status: 'active' | 'idle' | 'terminated';
  lastActiveAt: Date;
}

interface MessageResponse {
  messageId: string;
  response: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}
```

### 5.3 Control Plane 接口

```typescript
/**
 * Control Plane 对外接口
 */
interface IControlPlaneService {
  // 租户管理
  createTenant(data: CreateTenantRequest): Promise<Tenant>;
  getTenant(tenantId: string): Promise<Tenant>;
  updateTenant(tenantId: string, updates: Partial<Tenant>): Promise<Tenant>;
  deleteTenant(tenantId: string): Promise<void>;
  listTenants(filters?: TenantFilters): Promise<Tenant[]>;

  // 用户管理
  createUser(data: CreateUserRequest): Promise<User>;
  getUser(userId: string): Promise<User>;
  updateUser(userId: string, updates: Partial<User>): Promise<User>;
  deleteUser(userId: string): Promise<void>;
  listUsers(tenantId: string): Promise<User[]>;

  // Token 预算管理
  getTokenUsage(tenantId: string, period?: string): Promise<TokenUsage>;
  updateTokenBudget(tenantId: string, newBudget: number): Promise<void>;

  // Skill 管理
  createSkill(data: CreateSkillRequest): Promise<Skill>;
  getSkill(skillId: string): Promise<Skill>;
  updateSkill(skillId: string, updates: Partial<Skill>): Promise<Skill>;
  deleteSkill(skillId: string): Promise<void>;
  listSkills(filters?: SkillFilters): Promise<Skill[]>;
  enableSkillForTenant(tenantId: string, skillId: string): Promise<void>;
  disableSkillForTenant(tenantId: string, skillId: string): Promise<void>;
}

interface CreateTenantRequest {
  name: string;
  token_budget_monthly: number;
  permission_rules?: PermissionRules;
}

interface CreateUserRequest {
  tenant_id: string;
  email: string;
  role: 'admin' | 'member';
}

interface CreateSkillRequest {
  name: string;
  description: string;
  content: string;
  is_official?: boolean;
  allowed_tools?: string[];
  version?: string;
}

interface TokenUsage {
  total_budget: number;
  used: number;
  remaining: number;
  period: string;
}

interface TenantFilters {
  status?: string;
}

interface SkillFilters {
  is_official?: boolean;
}
```

### 5.4 API Gateway 接口

```typescript
/**
 * API Gateway HTTP 接口
 */

// POST /api/auth/login
interface LoginRequest {
  email: string;
  password: string;
}

interface LoginResponse {
  token: string;
  user: User;
  tenant: Tenant;
}

// POST /api/sessions
interface CreateSessionRequest {
  resumeFromSessionId?: string;
}

interface CreateSessionResponse {
  sessionId: string;
}

// POST /api/sessions/:sessionId/messages
interface SendMessageRequest {
  message: string;
}

interface SendMessageResponse {
  messageId: string;
  response: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// GET /api/sessions/:sessionId
interface GetSessionResponse {
  session: Session;
}

// DELETE /api/sessions/:sessionId
interface TerminateSessionResponse {
  success: boolean;
}

// GET /api/tenants/:tenantId/token-usage
interface GetTokenUsageResponse {
  usage: TokenUsage;
}

// GET /api/skills
interface ListSkillsResponse {
  skills: Skill[];
}

// POST /api/tenants/:tenantId/skills/:skillId/enable
interface EnableSkillResponse {
  success: boolean;
}
```

---
## 6. 目录结构

### 6.1 推荐的项目目录结构

```
enterprise-agent-platform/
├── packages/
│   ├── web-ui/                    # Web UI (React)
│   │   ├── src/
│   │   │   ├── components/        # React 组件
│   │   │   ├── pages/             # 页面组件
│   │   │   ├── hooks/             # 自定义 hooks
│   │   │   ├── services/          # API 服务
│   │   │   ├── store/             # 状态管理
│   │   │   └── utils/             # 工具函数
│   │   ├── public/
│   │   └── package.json
│   │
│   ├── api-gateway/               # API Gateway
│   │   ├── src/
│   │   │   ├── middleware/        # 中间件（认证、限流）
│   │   │   ├── routes/            # 路由定义
│   │   │   ├── services/          # 业务服务
│   │   │   └── index.ts           # 入口文件
│   │   ├── tests/
│   │   └── package.json
│   │
│   ├── control-plane/             # Control Plane Service
│   │   ├── src/
│   │   │   ├── services/
│   │   │   │   ├── tenant.service.ts
│   │   │   │   ├── user.service.ts
│   │   │   │   ├── token-budget.service.ts
│   │   │   │   └── skill.service.ts
│   │   │   ├── repositories/      # 数据访问层
│   │   │   ├── models/            # 数据模型
│   │   │   ├── routes/            # API 路由
│   │   │   └── index.ts
│   │   ├── tests/
│   │   └── package.json
│   │
│   ├── cc-ee/                     # cc_ee Service
│   │   ├── src/
│   │   │   ├── core/
│   │   │   │   ├── cc-ee.service.ts
│   │   │   │   ├── session-manager.ts
│   │   │   │   ├── hook-interceptor.ts
│   │   │   │   ├── context-assembler.ts
│   │   │   │   ├── session-persistence.ts
│   │   │   │   └── cc-core-adapter.ts
│   │   │   ├── hooks/             # Hook 实现
│   │   │   │   ├── pre-tool-use.hook.ts
│   │   │   │   └── post-tool-use.hook.ts
│   │   │   ├── routes/            # API 路由
│   │   │   ├── types/             # TypeScript 类型定义
│   │   │   └── index.ts
│   │   ├── tests/
│   │   └── package.json
│   │
│   ├── shared/                    # 共享代码
│   │   ├── src/
│   │   │   ├── types/             # 共享类型定义
│   │   │   ├── utils/             # 共享工具函数
│   │   │   ├── constants/         # 共享常量
│   │   │   └── errors/            # 错误定义
│   │   └── package.json
│   │
│   └── cc-core/                   # cc_core（原生）
│       └── ...                    # cc_core 原有结构
│
├── infrastructure/                # 基础设施配置
│   ├── kubernetes/                # K8s 配置
│   │   ├── api-gateway.yaml
│   │   ├── control-plane.yaml
│   │   ├── cc-ee.yaml
│   │   └── postgres.yaml
│   ├── terraform/                 # Terraform 配置
│   └── docker/                    # Docker 配置
│       ├── Dockerfile.api-gateway
│       ├── Dockerfile.control-plane
│       └── Dockerfile.cc-ee
│
├── database/                      # 数据库相关
│   ├── migrations/                # 数据库迁移脚本
│   │   ├── 001_create_tenants.sql
│   │   ├── 002_create_users.sql
│   │   ├── 003_create_sessions.sql
│   │   ├── 004_create_skills.sql
│   │   └── 005_create_token_ledgers.sql
│   └── seeds/                     # 种子数据
│
├── docs/                          # 文档
│   ├── architecture/              # 架构文档
│   ├── api/                       # API 文档
│   └── deployment/                # 部署文档
│
├── scripts/                       # 脚本
│   ├── setup.sh                   # 环境设置脚本
│   ├── deploy.sh                  # 部署脚本
│   └── test.sh                    # 测试脚本
│
├── .github/                       # GitHub 配置
│   └── workflows/                 # CI/CD 工作流
│       ├── test.yml
│       ├── build.yml
│       └── deploy.yml
│
├── package.json                   # 根 package.json（monorepo）
├── tsconfig.json                  # 根 TypeScript 配置
├── .gitignore
└── README.md
```

### 6.2 各目录职责说明

#### packages/web-ui
- **职责**: 用户界面，提供对话界面、Session 管理、租户管理后台
- **技术栈**: React + TypeScript + WebSocket
- **关键文件**:
  - `src/services/api.ts`: API 客户端
  - `src/store/session.store.ts`: Session 状态管理
  - `src/components/Chat/`: 对话组件

#### packages/api-gateway
- **职责**: API 网关，负责认证、路由、限流
- **技术栈**: Node.js + Fastify
- **关键文件**:
  - `src/middleware/auth.middleware.ts`: JWT 认证
  - `src/middleware/rate-limiter.middleware.ts`: 限流
  - `src/routes/index.ts`: 路由配置

#### packages/control-plane
- **职责**: 业务逻辑层，管理租户、用户、Token、Skill
- **技术栈**: Node.js + TypeScript + PostgreSQL
- **关键文件**:
  - `src/services/tenant.service.ts`: 租户服务
  - `src/services/token-budget.service.ts`: Token 预算服务
  - `src/repositories/`: 数据访问层

#### packages/cc-ee
- **职责**: 企业级编排层，负责多租户编排、会话管理、Hook 拦截
- **技术栈**: Node.js + TypeScript + cc_core
- **关键文件**:
  - `src/core/cc-ee.service.ts`: 主服务
  - `src/core/hook-interceptor.ts`: Hook 拦截器
  - `src/core/session-manager.ts`: Session 管理器

#### packages/shared
- **职责**: 共享代码，提供类型定义、工具函数、常量
- **技术栈**: TypeScript
- **关键文件**:
  - `src/types/index.ts`: 共享类型定义
  - `src/errors/index.ts`: 错误定义

#### infrastructure/
- **职责**: 基础设施配置，包括 K8s、Terraform、Docker
- **关键文件**:
  - `kubernetes/cc-ee.yaml`: cc_ee Service 部署配置
  - `terraform/main.tf`: Terraform 主配置

#### database/
- **职责**: 数据库相关，包括迁移脚本和种子数据
- **关键文件**:
  - `migrations/`: 数据库迁移脚本（按顺序执行）

---

## 7. 总结

本架构文档定义了企业级 Agent 平台的完整逻辑分层关系，包括：

1. **清晰的分层架构**：Presentation → Gateway → Business Logic + Orchestration → Agent Core → Data Access
2. **核心模块设计**：cc_ee Service、Control Plane、API Gateway 的详细类设计和接口定义
3. **关键流程设计**：Session 生命周期、Token 计数、Session 持久化的完整时序图
4. **接口规范**：TypeScript 接口定义，确保各层之间的契约清晰
5. **目录结构**：推荐的 monorepo 结构，支持多包管理

**关键架构特点**：
- **零侵入 cc_core**：所有企业级能力在 cc_ee 层实现
- **单进程多 session**：提高资源利用率
- **进程内 Hook**：零网络开销
- **PostgreSQL 行级锁**：强一致性 token 计数
- **OSS 持久化**：支持 Pod 重启后恢复

**下一步**：
1. 按照目录结构初始化项目
2. 实现核心模块（从 cc_ee Service 开始）
3. 编写单元测试和集成测试
4. 部署到 Kubernetes 集群

---
