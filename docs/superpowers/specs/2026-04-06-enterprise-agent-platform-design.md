# 企业级 Agent 平台架构设计

**版本**: 1.0
**日期**: 2026-04-06
**状态**: Draft

---

## 1. 项目背景与目标

### 1.1 背景

基于 cc_core (Claude Code Agent Harness) 构建一个企业级 SaaS 多租户 Agent 平台。cc_core 是一个成熟的本地 coding agent，具有完善的工具系统、hook 机制、session 管理和安全沙箱能力。

### 1.2 核心目标

1. **多租户隔离**：租户 = 企业，用户 = 企业员工，实现租户间数据和执行环境完全隔离
2. **Token 预算管控**：租户级月度 token 配额，实时计量和限流
3. **动态 Skill 配置**：租户管理员从平台 Skill 仓库勾选激活，不同租户可有不同 skill 组合
4. **零侵入改造**：尽量不修改 cc_core 代码，通过其原生扩展点（hooks、settings、plugins）实现能力

### 1.3 部署模型

- **SaaS 多租户**：平台运营方提供服务，企业客户作为租户接入
- **Web UI 接入**：浏览器端对话界面（类似 Claude.ai），完全自研前端
- **共享机器执行**：每个 session 独立进程，利用 cc_core 的 bubblewrap/macOS sandbox 隔离
- **规模预期**：数百到数千并发 session，每用户 1-3 个活跃 session

---

## 2. 整体架构与分层

### 2.1 架构图

```
┌─────────────────────────────────────────────────────────┐
│                      Web UI (React)                      │
│              浏览器端对话界面，类似 Claude.ai              │
└──────────────────────────┬──────────────────────────────┘
                           │ WebSocket / REST
┌──────────────────────────▼──────────────────────────────┐
│                    API Gateway Layer                     │
│        认证(JWT) · 租户路由 · 限流 · 会话路由             │
└──────┬────────────────────────────────────┬─────────────┘
       │                                    │
┌──────▼──────────────┐          ┌──────────▼──────────────┐
│   Control Plane      │          │    Session Manager       │
│  ─────────────────  │          │  ──────────────────────  │
│  · 租户 CRUD         │          │  · cc_core 进程池管理    │
│  · 用户管理          │◄────────►│  · Session 生命周期      │
│  · Token 预算账本    │          │  · managed-settings 生成 │
│  · Skill 仓库 & 分配 │          │  · 进程健康检查          │
│  · 权限规则引擎       │          └──────────┬──────────────┘
└─────────────────────┘                     │ 进程 fork/spawn
                                            │
                          ┌─────────────────▼──────────────────┐
                          │         cc_core Process Pool        │
                          │  ┌──────────┐  ┌──────────┐        │
                          │  │Session A │  │Session B │  ...   │
                          │  │(Tenant1/ │  │(Tenant1/ │        │
                          │  │ User1)   │  │ User2)   │        │
                          │  └────┬─────┘  └────┬─────┘        │
                          └───────┼─────────────┼──────────────┘
                                  │ HTTP hooks  │
                          ┌───────▼─────────────▼──────────────┐
                          │        Hook Interceptor Service     │
                          │  PreToolUse · PostToolUse · Audit   │
                          │  Token 计数 · 安全拦截 · 日志流水   │
                          └────────────────┬───────────────────┘
                                           │
                          ┌────────────────▼───────────────────┐
                          │           LLM Proxy                │
                          │   (Anthropic API base URL 替换)    │
                          │   token 计量校验 · 内容过滤         │
                          └────────────────────────────────────┘
```

### 2.2 五层职责边界

| 层 | 职责 | 技术选型 |
|---|---|---|
| **Web UI** | 对话界面、Session 管理 UI、租户管理后台 | React + WebSocket |
| **API Gateway** | 认证、路由、限流 | Node.js (Fastify) 或 Nginx |
| **Control Plane** | 租户/用户/Token/Skill 的管理数据面 | Node.js + PostgreSQL |
| **Session Manager** | cc_core 进程生命周期、配置注入 | Node.js (child_process) |
| **Hook Interceptor** | 工具拦截、审计、token 计数 | Node.js HTTP server |

### 2.3 关键设计决策

- **cc_core 进程模式**：以 `isBareMode` 启动（无 tty、ipc=false），通过 stdin/stdout 接收消息、返回流式结果
- **Session Manager 桥接**：作为 cc_core 父进程，将 WebSocket 消息桥接到 cc_core 的 stdio
- **零侵入原则**：完全不修改 cc_core 代码，通过 managed-settings.json、HTTP hooks、环境变量实现所有扩展

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
  pid INTEGER, -- cc_core 进程 PID
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
  PRIMARY KEY (tenant_id, period)
);
```

### 3.2 数据关系

- 一个租户有多个用户
- 一个用户可以有多个 session（但同时活跃的通常 1-3 个）
- Token 预算在租户级统计，不分配到用户
- Skill 由平台维护，租户通过 `enabled_skill_ids` 选择激活

---

## 4. Session 生命周期与配置注入

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
4. Session Manager 执行：
   a. 在 /sessions/{tenant_id}/{session_id}/ 创建隔离工作目录
   b. 生成 managed-settings.json（见 4.2）注入到该目录
   c. 将租户激活的 skill 文件写入 .claude/skills/
   d. fork cc_core 进程，环境变量注入：
      - CLAUDE_SESSION_ID={session_id}
      - ANTHROPIC_BASE_URL=http://llm-proxy/
      - CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
   e. 建立 stdin/stdout 桥接 ↔ WebSocket
   ↓
5. cc_core 启动，SessionStart hook 触发
   → Hook Interceptor 记录日志到 tool_audit_logs
```

### 4.2 动态生成的 managed-settings.json

每次 session 启动时，Session Manager 根据租户配置动态生成：

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
            "type": "http",
            "url": "http://hook-interceptor/pre",
            "if": "true"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "http",
            "url": "http://hook-interceptor/post",
            "if": "true"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "http",
            "url": "http://hook-interceptor/session-start",
            "if": "true"
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
- `hooks`：所有工具调用前后都路由到 Hook Interceptor

### 4.3 Skill 注入机制

Session Manager 从数据库读取 `tenants.enabled_skill_ids`，将对应的 `skills.content` 写入：

```
/sessions/{tenant_id}/{session_id}/.claude/skills/{skill_name}.md
```

cc_core 启动时自动扫描该目录加载 skill。

**注意**：存量 session 需重启才能感知 skill 变化（cc_core 的 skill 加载是启动时一次性的）。

---

## 5. Hook Interceptor —— 工具拦截与 Token 计数

### 5.1 PreToolUse（工具执行前）

**请求格式**（cc_core 发送）：

```json
POST /pre
{
  "tool_name": "Bash",
  "input": {"command": "ls -la"},
  "session_id": "uuid",
  "tenant_id": "uuid",
  "user_id": "uuid"
}
```

**处理逻辑**：

```
1. 查询 token_ledgers：used >= total_budget
   → 是：返回 exit_code=2, stderr="Token budget exhausted for this month"
   → 否：继续

2. 查询租户的 deny 规则（动态，补充 managed-settings 的静态规则）
   → 匹配：返回 exit_code=2, stderr="Tool blocked by tenant policy"
   → 否：继续

3. 写入 tool_audit_logs（decision=allow/block）

4. 返回 exit_code=0（允许执行）
```

**响应格式**：

```json
{
  "exit_code": 0,  // 0=允许, 2=阻断
  "stderr": ""     // exit_code=2 时，错误信息会返回给模型
}
```

**关键机制**：`exit_code=2` 是 cc_core 的原生语义，会将 stderr 返回给模型，工具调用被阻断。**完全不需要 patch cc_core**。

### 5.2 PostToolUse（工具执行后）

**请求格式**：

```json
POST /post
{
  "tool_name": "Bash",
  "output": "...",
  "usage": {
    "input_tokens": 1234,
    "output_tokens": 567
  },
  "session_id": "uuid",
  "tenant_id": "uuid"
}
```

**处理逻辑**：

```
1. 更新 token_ledgers.used += input_tokens + output_tokens

2. 更新 sessions.last_active_at = NOW()

3. 写入 tool_audit_logs（补充 tokens_delta）
```

### 5.3 LLM Proxy（Token 双重校验）

**架构**：

```
cc_core → LLM Proxy → Anthropic API
```

**职责**：

1. **Token 计量**：从 Anthropic API 响应 header 读取 `usage`，记录到独立账本
2. **对账**：每日批量对比 Hook Interceptor 的 token 计数和 LLM Proxy 的计数
3. **差异告警**：差异超过阈值（如 5%）触发告警，人工介入
4. **内容过滤**：可接入 Anthropic 的 safety 层或自研内容审核

**为什么需要双重计数**：

- Hook Interceptor 的计数来自 cc_core 的 `PostToolUse` hook，依赖 cc_core 正确传递 usage
- LLM Proxy 直接从 Anthropic API 获取，是权威来源
- 两者互相校验，防止计数漏洞

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
   - Session Manager 从数据库读取 enabled_skill_ids
   - 将对应 skills.content 写入 session 工作目录的 .claude/skills/
   ↓
4. cc_core 启动自动加载（存量 session 需重启才能感知变化）
```

### 6.3 Skill 版本策略

- **固定版本**：租户激活 skill 时，记录当前版本号（如 `enabled_skill_ids = ["skill-a@1.2.0"]`）
- **手动升级**：平台升级 skill 不自动推送给租户，租户管理员手动选择升级
- **原因**：避免生产环境突变，租户可以在测试环境验证新版本后再升级

---

## 7. 安全边界总结

| 威胁 | 防御机制 |
|---|---|
| **租户间数据泄露** | 每 session 独立进程 + 独立工作目录，`additionalDirectories` 限制文件访问范围 |
| **Token 超支** | PreToolUse hook 检查账本，超限返回 exit_code=2 阻断 |
| **恶意工具调用** | `deny` 规则 + PreToolUse 动态拦截，`allowManagedHooksOnly` 锁定 |
| **用户注入恶意 hook** | `allowManagedHooksOnly=true` 屏蔽所有非 managed 层 hook |
| **Session 中途修改配置** | cc_core 的 hooks snapshot 机制（session 启动时快照，中途修改无效）|
| **LLM 内容安全** | LLM Proxy 层内容过滤（可接入 Anthropic 的 safety 层或自研） |
| **进程逃逸** | cc_core 内置 bubblewrap sandbox（Linux）/ macOS sandbox |
| **文件系统隔离** | `permissions.additionalDirectories` 限制访问范围，deny 规则阻断危险命令 |

---

## 8. 技术选型

### 8.1 各层技术栈

| 层 | 技术选型 | 理由 |
|---|---|---|
| **Web UI** | React + TypeScript + WebSocket | 成熟生态，实时通信 |
| **API Gateway** | Fastify (Node.js) | 高性能，插件生态丰富 |
| **Control Plane** | Node.js + PostgreSQL | 与 cc_core 技术栈一致，PostgreSQL 支持 JSONB |
| **Session Manager** | Node.js (child_process) | 与 cc_core 同语言，进程管理简单 |
| **Hook Interceptor** | Node.js + Express | 轻量 HTTP server，易于扩展 |
| **LLM Proxy** | Node.js + http-proxy | 透明代理，易于注入 token 计量逻辑 |
| **消息队列** | Redis Streams | 用于异步任务（如 token 对账、日志归档） |

### 8.2 部署架构

```
Kubernetes 集群
  ├── Web UI (Deployment, 多副本)
  ├── API Gateway (Deployment, 多副本)
  ├── Control Plane (Deployment, 多副本)
  ├── Session Manager (StatefulSet, 每个 Pod 管理一批 cc_core 进程)
  ├── Hook Interceptor (Deployment, 多副本)
  ├── LLM Proxy (Deployment, 多副本)
  ├── PostgreSQL (StatefulSet 或托管服务)
  └── Redis (StatefulSet 或托管服务)
```

**Session Manager 特殊处理**：

- 使用 StatefulSet，每个 Pod 有稳定的网络标识
- Pod 内运行多个 cc_core 进程（每个 session 一个进程）
- Pod 重启时，session 需要重新创建（或实现 session 迁移机制）

---

## 9. 实施路线图

### Phase 1：核心基础设施（4-6 周）

**目标**：搭建基础架构，实现单租户单用户单 session 的端到端流程

**任务**：
1. 数据库 schema 设计与初始化
2. Control Plane API 开发（租户/用户 CRUD）
3. Session Manager 开发（进程管理、managed-settings 生成）
4. Hook Interceptor 开发（PreToolUse/PostToolUse HTTP endpoint）
5. LLM Proxy 开发（透明代理 + token 计量）
6. Web UI 基础框架（登录、对话界面）

**验收标准**：
- 能创建租户和用户
- 能启动一个 cc_core session 并通过 Web UI 对话
- PreToolUse hook 能阻断工具调用
- PostToolUse hook 能记录 token 消耗

---

### Phase 2：多租户隔离与 Token 管控（3-4 周）

**目标**：实现多租户并发、token 预算限流

**任务**：
1. Session Manager 进程池管理（支持多 session 并发）
2. Token 预算检查逻辑（PreToolUse 中实现）
3. Token 账本更新逻辑（PostToolUse 中实现）
4. LLM Proxy token 对账机制（每日批量）
5. 租户级 permission 规则引擎
6. Web UI 租户管理后台（token 使用情况仪表盘）

**验收标准**：
- 能同时运行多个租户的 session，互不干扰
- Token 超限时，新工具调用被阻断
- LLM Proxy 和 Hook Interceptor 的 token 计数误差 < 5%

---

### Phase 3：Skill 仓库与动态配置（2-3 周）

**目标**：实现 Skill 管理和租户级动态分配

**任务**：
1. Skill 仓库数据模型与 API
2. 平台官方 Skill 预置（从 cc_core 的 bundled skills 迁移）
3. Session Manager 的 Skill 注入逻辑
4. Web UI Skill 管理界面（租户管理员勾选激活）
5. Skill 版本管理机制

**验收标准**：
- 租户管理员能在 UI 上勾选 skill
- 新建 session 时，只加载租户激活的 skill
- 不同租户的 session 有不同的 skill 集合

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
1. Session Manager 水平扩展（多 Pod 负载均衡）
2. cc_core 进程池预热（减少冷启动延迟）
3. PostgreSQL 读写分离与连接池优化
4. Redis 缓存热点数据（租户配置、skill 内容）
5. WebSocket 连接管理优化（心跳、断线重连）
6. 压力测试与性能调优

**验收标准**：
- 支持 2000+ 并发 session
- Session 冷启动延迟 < 1s
- API 响应时间 P99 < 500ms

---

## 10. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| **cc_core 进程内存泄漏** | Session 长时间运行后内存溢出 | 定期重启 session（如 24 小时）；监控内存使用 |
| **Token 计数不准确** | 租户超支或误拦截 | LLM Proxy 双重校验；定期对账；人工复核异常 |
| **Skill 注入失败** | Session 启动失败 | Skill 内容预校验；启动失败自动回滚 |
| **Hook Interceptor 单点故障** | 所有 session 无法工作 | 多副本部署；健康检查；降级策略（hook 失败时允许工具执行）|
| **cc_core 版本升级** | 新版本 API 不兼容 | 版本锁定；升级前在测试环境验证；灰度发布 |

---

## 11. 未来扩展

### 11.1 租户私有 Skill

- 租户可以上传自己的 Skill（Markdown + YAML frontmatter）
- 平台审核后上线（安全扫描、语法检查）
- 租户私有 Skill 只对该租户可见

### 11.2 用户级 Token 配额

- 在租户总配额下，再分配用户子配额
- 用户超限时，只阻断该用户的 session，不影响其他用户

### 11.3 Session 持久化与恢复

- Session 状态持久化到对象存储（S3）
- Pod 重启后，能从持久化状态恢复 session

### 11.4 多模型支持

- 支持切换不同的 LLM 模型（GPT-4、Claude、开源模型）
- 租户级模型配置

---

## 12. 总结

本设计方案通过 **Gateway + 进程池 + Hook 拦截** 的架构，在 **零侵入 cc_core** 的前提下，实现了企业级 SaaS 多租户 Agent 平台的核心能力：

1. **多租户隔离**：进程级 + 文件系统级隔离
2. **Token 管控**：PreToolUse hook + LLM Proxy 双重计量
3. **动态 Skill**：managed-settings.json + 租户级配置

关键优势：
- **零改造**：完全利用 cc_core 的原生扩展点
- **安全可控**：多层防御，租户间完全隔离
- **易于维护**：cc_core 升级不影响平台层逻辑

下一步：按照实施路线图，从 Phase 1 开始逐步实现。
