# 实施路线图

**版本**: 3.0（经源码验证）

---

## Phase 1a：后端核心（2-3 周）

**目标**：单租户单用户单 session 端到端跑通

### 任务

1. **数据库初始化**
   - 创建 PostgreSQL schema（tenants, users, sessions, token_ledgers, tool_audit_logs, skills）
   - 初始化测试数据（1 个租户，1 个用户）

2. **cc_core 集成层**
   - cc_ee 与 cc_core 打包（package.json 依赖配置）
   - `initCcCore()`：进程启动时调用 `registerHookCallbacks()`
   - `SessionRunner`：封装 `switchSession()` + `runWithCwdOverride()` + `query()`
   - 从 `AssistantMessage.usage` 读取 token usage，原子更新 token_ledgers

3. **Session 生命周期管理**
   - 创建 session 工作目录（`/sessions/{tenant_id}/{session_id}/`）
   - Skill 文件注入（`.claude/skills/*.md`）
   - Session 终止与 OSS 归档
   - Session 恢复（从 OSS 下载解压）

4. **Hook 拦截**
   - PreToolUse HookCallback：token 预算检查 + deny 规则检查 + 审计日志
   - PostToolUse HookCallback：更新 session last_active_at

5. **Control Plane API**（Fastify）
   - `POST /api/tenants` — 创建租户
   - `POST /api/users` — 创建用户
   - `POST /api/sessions` — 创建 session
   - `POST /api/sessions/:id/query` — 发送消息（SSE 流式响应）
   - `DELETE /api/sessions/:id` — 终止 session

6. **managed-settings.json**
   - 配置 `allowManagedHooksOnly: true`
   - 配置平台级静态 deny 规则

### 验收标准

- [ ] 能创建租户和用户
- [ ] 能通过 API 启动 session 并发送消息
- [ ] PreToolUse HookCallback 能阻断工具调用，reason 返回给模型
- [ ] token usage 从 AssistantMessage.usage 读取并写入 token_ledgers
- [ ] Session 终止后能归档到 OSS
- [ ] Session 能从 OSS 恢复并继续对话

---

## Phase 1b：前端接入（2-3 周）

**目标**：用户可以通过浏览器使用平台

### 任务

1. **API Gateway**（Fastify）
   - JWT 认证（登录/注册）
   - 租户路由（从 JWT 提取 tenant_id）
   - 基础限流（per-user 请求频率）

2. **Web UI**（React + TypeScript）
   - 登录/注册界面
   - 对话界面（类似 Claude.ai，支持流式输出）
   - Session 列表与管理
   - WebSocket 连接管理

3. **Admin UI**
   - 租户管理（创建、配置）
   - 用户管理
   - Token 使用情况仪表盘

### 验收标准

- [ ] 用户能通过 Web UI 登录
- [ ] 用户能创建新会话并对话（流式输出）
- [ ] 用户能查看 token 使用情况
- [ ] 租户管理员能管理用户

---

## Phase 2：多租户增强与 Token 管控（3-4 周）

**目标**：多租户并发、token 预算限流、LLM Proxy 双重校验

### 任务

1. **多 session 并发**
   - Worker 进程模型（每个 worker 串行处理 session）
   - Session affinity 路由（同一 session 路由到同一 Pod）
   - 进程级 sessionStore 并发安全

2. **Token 预算限流**
   - 月度账本自动初始化（月初 cron job）
   - 预算即将耗尽告警（90% 阈值）
   - 预算耗尽通知（邮件/Webhook）

3. **LLM Proxy**
   - 透明代理 Anthropic API（`ANTHROPIC_BASE_URL` 配置）
   - 从 Anthropic 响应读取 usage，写入 proxy_token_ledgers
   - 每日批量对账（cc_ee 计数 vs LLM Proxy 计数）
   - 差异 > 5% 触发告警

4. **租户级权限规则引擎**
   - Admin UI 配置 allow/deny 规则
   - 规则变更实时生效（下次工具调用时）

### 验收标准

- [ ] 多租户并发 session 互不干扰
- [ ] Token 超限时工具调用被阻断，模型收到明确错误信息
- [ ] LLM Proxy 和 cc_ee 的 token 计数误差 < 5%
- [ ] 租户管理员能配置 allow/deny 规则

---

## Phase 3：Skill 仓库与动态配置（2-3 周）

**目标**：Skill 管理和租户级动态分配

### 任务

1. **Skill 仓库 API**
   - `GET /api/skills` — 列出所有官方 skill
   - `POST /api/skills` — 创建 skill（平台管理员）
   - `PUT /api/skills/:id` — 更新 skill（触发安全扫描）

2. **租户 Skill 管理**
   - `POST /api/tenants/:id/skills/:skillId` — 激活 skill（版本锁定）
   - `DELETE /api/tenants/:id/skills/:skillId` — 停用 skill
   - `PUT /api/tenants/:id/skills/:skillId/upgrade` — 升级到最新版本

3. **Skill 安全扫描**
   - 静态分析（危险命令模式、敏感信息检测）
   - 发布流程（扫描通过 → 人工审核 → 上线）

4. **Admin UI Skill 管理界面**
   - Skill 仓库浏览（名称、描述、版本）
   - 租户 Skill 激活/停用
   - Skill 版本升级

### 验收标准

- [ ] 租户管理员能在 UI 上激活/停用 skill
- [ ] 新建 session 时只加载租户激活的 skill
- [ ] 不同租户的 session 有不同的 skill 集合
- [ ] 官方 Skill 发布前经过安全扫描

---

## Phase 4：安全加固与监控（2-3 周）

**目标**：生产级安全和可观测性

### 任务

1. **审计日志完善**
   - input_snapshot 脱敏（敏感字段 REDACTED）
   - 审计日志查询 API（租户管理员可查）
   - 审计日志导出（CSV/JSON）

2. **异常检测与告警**
   - Token 异常消耗（单小时 > 日均 * 3）
   - 工具调用频率异常
   - Session 崩溃自动重启

3. **监控**
   - Prometheus metrics（session 数、token 消耗、hook 延迟）
   - Grafana 仪表盘
   - 日志聚合（Loki 或 ELK）

4. **进程资源限制**
   - K8s resource limits（CPU、内存）
   - 磁盘配额（per-session 工作目录大小限制）

### 验收标准

- [ ] 所有工具调用都有审计日志（含脱敏输入）
- [ ] Token 异常消耗能在 5 分钟内告警
- [ ] Session 崩溃能自动重启
- [ ] 监控仪表盘实时展示系统健康状态

---

## Phase 5：性能优化与扩展（持续）

**目标**：支撑数千并发 session

### 任务

1. **水平扩展**
   - cc_ee Pod 多副本（K8s Deployment）
   - Session affinity（基于 session_id 的一致性哈希路由）
   - Pod 重启时 session 自动迁移（从 OSS 恢复）

2. **性能优化**
   - 租户配置缓存（Redis，TTL 60s）
   - Skill 内容缓存（Redis，TTL 5min）
   - PostgreSQL 连接池优化（pgBouncer）
   - WebSocket 连接管理优化（心跳、断线重连）

3. **压力测试**
   - 目标：2000+ 并发 session
   - Session 冷启动延迟 < 1s
   - API 响应时间 P99 < 500ms

### 验收标准

- [ ] 支持 2000+ 并发 session
- [ ] Session 冷启动延迟 < 1s
- [ ] API 响应时间 P99 < 500ms
- [ ] Pod 重启后 session 自动恢复，用户无感知

---

## 技术债务与风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| `switchSession()` 非并发安全 | 并发 session 切换导致 transcript 混乱 | 每个 worker 串行处理，Phase 5 优化 |
| 乐观读允许极小超支 | 租户短暂超支 | Phase 2 LLM Proxy 对账补偿 |
| cc_core 版本升级 | API 不兼容 | 版本锁定，升级前测试环境验证 |
| 应用层隔离（非进程级） | 隔离强度低于进程级 | 严格文件访问限制 + deny 规则 + 定期安全审计 |
| OSS 归档失败 | Session 数据丢失 | 本地备份 + 归档失败告警 |
