# cc_ee 企业级平台实施计划总结

## 已完成的工作

### 1. 设计文档 (cc_ee_design/)

已创建完整的技术设计文档：

- **10-backend-architecture.md** - 后端架构设计
  - 完整目录结构
  - 核心模块设计（cc_core 集成层、API 路由、服务层、数据访问层）
  - 技术栈选型（Fastify, PostgreSQL, node-postgres）

- **11-frontend-architecture.md** - 前端架构设计
  - React + TypeScript + Vite 技术栈
  - 完整组件结构
  - 状态管理（Redux Toolkit）
  - WebSocket 实时通信

- **12-api-protocol.md** - API 协议规范
  - 完整的 REST API 端点定义
  - WebSocket 协议规范
  - 请求/响应数据模型
  - 错误码和速率限制

- **13-tech-stack.md** - 技术栈选型文档
  - 后端技术栈对比分析
  - 前端技术栈对比分析
  - 技术选型理由和风险评估

### 2. 实施计划 (docs/superpowers/plans/)

已创建分阶段实施计划：

- **2026-04-09-cc-ee-implementation.md** - 主计划
  - 5 个阶段的总览
  - 关键路径和依赖关系
  - 风险缓解策略

- **2026-04-09-phase-1a-backend-core.md** - Phase 1a 详细计划
  - 项目初始化（Task 1）
  - 数据库 Schema（Task 2）
  - 配置层（Task 3）
  - 数据模型（Task 4）
  - Repository 层（Task 5）
  - **待完成**: Task 6-15（cc_core 集成、Session 生命周期、API 路由、服务层）

## 下一步行动

### 立即执行

根据用户要求，现在需要：

1. **完成 Phase 1a 计划** - 添加剩余任务（Task 6-15）：
   - Task 6: cc_core 集成层（init.ts, session-runner.ts, hook-callbacks.ts）
   - Task 7: Session 服务层（session.service.ts）
   - Task 8: Token 服务层（token.service.ts）
   - Task 9: Audit 服务层（audit.service.ts）
   - Task 10: API 路由（sessions.ts, tenants.ts, users.ts）
   - Task 11: 主入口（index.ts）
   - Task 12: 集成测试
   - Task 13: 验收测试
   - Task 14-15: 文档和部署

2. **创建 Phase 1b 计划** - 前端集成详细计划

3. **创建 Phase 2-5 简要计划** - 后续阶段的高层计划

### 执行方式

用户可以选择两种执行方式：

**方式 1: Subagent-Driven（推荐）**
- 为每个任务派发新的 subagent
- 任务间进行审查
- 快速迭代

**方式 2: Inline Execution**
- 在当前会话中使用 executing-plans skill
- 批量执行，设置检查点

## 技术架构总结

### 后端 (cc_ee/)
```
Node.js 20 + TypeScript 5 + Fastify 4
├── cc_core 集成（进程内调用 query() API）
├── PostgreSQL 15（数据持久化）
├── AsyncLocalStorage（Session 隔离）
└── OSS/S3（Session 归档）
```

### 前端 (cc_ee_webui/)
```
React 18 + TypeScript 5 + Vite 5
├── Redux Toolkit（状态管理）
├── React Router 6（路由）
├── WebSocket（实时通信）
└── Ant Design 5（UI 组件）
```

### API 协议
```
REST API（HTTP/HTTPS）
├── 认证（JWT）
├── 租户管理
├── 用户管理
├── Session 管理
└── Skill 管理

WebSocket
├── 实时对话流式响应
├── Session 状态更新
└── 系统通知
```

## 关键设计决策

1. **进程内集成** - cc_ee 与 cc_core 在同一进程，直接调用 `query()` API
2. **AsyncLocalStorage 隔离** - 使用 `runWithCwdOverride` 和 `runWithSessionOverride` 实现 per-session 隔离
3. **HookCallback 拦截** - 通过 `registerHookCallbacks()` 实现 token 预算检查和权限控制
4. **原子 Token 更新** - 使用 `UPDATE ... SET used = used + $1` 原子操作，无需事务
5. **OSS 归档** - Session 终止后归档到 OSS，支持恢复

## 验收标准

### Phase 1a（后端核心）
- [ ] 能创建租户和用户
- [ ] 能通过 API 启动 session 并发送消息
- [ ] PreToolUse HookCallback 能阻断工具调用
- [ ] Token usage 从 AssistantMessage.usage 读取并写入 token_ledgers
- [ ] Session 终止后能归档到 OSS
- [ ] Session 能从 OSS 恢复并继续对话
- [ ] 两个并发 session 有独立的 transcript 和 token 计数

### Phase 1b（前端集成）
- [ ] 用户能通过 Web UI 登录
- [ ] 用户能创建新会话并对话（流式输出）
- [ ] 用户能查看 token 使用情况
- [ ] 租户管理员能管理用户

## 文件清单

### 设计文档
```
cc_ee_design/
├── 01-architecture.md          # 整体架构（已存在）
├── 02-cc-core-integration.md   # cc_core 集成策略（已存在）
├── 03-session-lifecycle.md     # Session 生命周期（已存在）
├── 04-hook-system.md           # Hook 系统（已存在）
├── 05-token-accounting.md      # Token 计费（已存在）
├── 06-skill-system.md          # Skill 管理（已存在）
├── 07-data-model.md            # 数据模型（已存在）
├── 08-security.md              # 安全考虑（已存在）
├── 09-roadmap.md               # 实施路线图（已存在）
├── 10-backend-architecture.md  # 后端架构（新建）✅
├── 11-frontend-architecture.md # 前端架构（新建）✅
├── 12-api-protocol.md          # API 协议（新建）✅
└── 13-tech-stack.md            # 技术栈（新建）✅
```

### 实施计划
```
docs/superpowers/plans/
├── 2026-04-09-cc-ee-implementation.md      # 主计划 ✅
├── 2026-04-09-phase-1a-backend-core.md     # Phase 1a（部分完成）⏳
├── 2026-04-09-phase-1b-frontend-integration.md  # Phase 1b（待创建）
├── 2026-04-09-phase-2-multi-tenant-enhancement.md  # Phase 2（待创建）
├── 2026-04-09-phase-3-skill-repository.md  # Phase 3（待创建）
└── 2026-04-09-phase-4-security-monitoring.md  # Phase 4（待创建）
```

## 推荐执行路径

1. **阅读主计划** - `docs/superpowers/plans/2026-04-09-cc-ee-implementation.md`
2. **阅读设计文档** - 理解技术架构和 API 协议
3. **执行 Phase 1a** - 按照 `2026-04-09-phase-1a-backend-core.md` 逐任务执行
4. **验收 Phase 1a** - 确认所有验收标准通过
5. **执行 Phase 1b** - 前端集成
6. **后续阶段** - Phase 2-5 逐步推进

## 技术债务和风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| cc_core STATE 改造范围大 | 高 | 增量迁移 + 全面测试 |
| 改造前的串行瓶颈 | 中 | Phase 1a 串行模式可用，Phase 2 启用并发 |
| Token 计数准确性 | 中 | Phase 2 LLM Proxy 双重验证 |
| OSS 归档失败 | 高 | 本地备份 + 失败告警 |
| Session 隔离弱点 | 高 | 严格文件访问规则 + deny 规则 + 审计 |

## 联系方式

如有问题，请参考：
- 设计文档：`cc_ee_design/` 目录
- 实施计划：`docs/superpowers/plans/` 目录
- 主计划：`docs/superpowers/plans/2026-04-09-cc-ee-implementation.md`
