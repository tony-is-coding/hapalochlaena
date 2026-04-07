# 安全边界与隔离机制

**版本**: 1.0

---

## 1. 威胁模型

| 威胁 | 防御机制 | 层次 |
|------|---------|------|
| 租户间数据泄露 | `runWithCwdOverride` + 独立工作目录 | cc_ee 应用层 |
| Token 超支 | PreToolUse HookCallback 乐观读预算 | cc_ee Hook 层 |
| 恶意工具调用 | managed-settings.json 静态 deny + HookCallback 动态 deny | cc_core + cc_ee |
| 用户注入恶意 hook | `allowManagedHooksOnly: true` | cc_core managed-settings |
| Session 中途修改配置 | cc_core hooks snapshot 机制 | cc_core 内部 |
| 进程资源耗尽 | Docker/K8s 资源限制 | 基础设施层 |
| Skill 内容安全 | 发布前静态扫描 + 人工审核 | 平台运营层 |
| Session 数据泄露 | 终止后归档 OSS，本地目录清理 | cc_ee 生命周期 |

---

## 2. 应用层隔离机制

单进程多 session 架构下，隔离从进程级变为应用层：

### 2.1 文件系统隔离

```
每个 session 独立工作目录：
  /sessions/{tenant_id}/{session_id}/

runWithCwdOverride(tenantCwd, ...) 确保：
  - cc_core 的文件操作默认在 tenantCwd 内
  - getSkills(cwd) 从 tenantCwd 加载 skill，不跨 session

managed-settings.json 的 permissions.additionalDirectories：
  - 限制 cc_core 可访问的目录范围
  - 防止 Agent 访问其他 tenant 的工作目录
```

### 2.2 Session 上下文隔离

```
进程级 sessionStore（Map<sessionId, { tenantId, userId }>）
  - HookCallback 通过 getSessionId() 查找当前 session 的租户
  - 不同 session 的租户配置完全独立
  - session 终止时清理映射，防止泄露
```

### 2.3 Skill 隔离

```
租户 A 的 skill：/sessions/tenant-a/{session}/.claude/skills/
租户 B 的 skill：/sessions/tenant-b/{session}/.claude/skills/

runWithCwdOverride 确保 getSkills(cwd) 只加载当前 session 的 skill
不同租户的 skill 完全隔离
```

---

## 3. Hook 安全机制

### 3.1 allowManagedHooksOnly

```json
// managed-settings.json
{
  "allowManagedHooksOnly": true
}
```

效果：
- 屏蔽所有用户级 hook（`~/.claude/settings.json` 中的 hooks）
- 只允许 managed-settings.json 中的 hooks 和 `registerHookCallbacks()` 注册的 HookCallback
- 防止用户注入恶意 hook 绕过 cc_ee 的安全检查

### 3.2 平台级静态 deny 规则

```json
// managed-settings.json
{
  "permissions": {
    "deny": [
      "Bash(rm -rf /*)",
      "Bash(dd if=/dev/zero:*)",
      "Bash(curl * | bash:*)",
      "Bash(wget * | bash:*)",
      "Bash(mkfs.*:*)"
    ]
  }
}
```

这些规则在 cc_core 层生效，在 HookCallback 之前执行，无法被绕过。

### 3.3 租户级动态 deny 规则

在 PreToolUse HookCallback 中，从 `tenants.permission_rules.deny` 读取并检查：

```typescript
// 每次工具调用前动态检查
const matchedRule = matchDenyRules(input.tool_name, input.input, tenant.permission_rules.deny)
if (matchedRule) {
  return { decision: 'block', reason: `Tool blocked by tenant policy: ${matchedRule}` }
}
```

---

## 4. Token 安全

### 4.1 预算超限阻断

```
PreToolUse HookCallback
  → 乐观读 token_ledgers
  → used >= total_budget
  → { decision: 'block', reason: 'Token budget exhausted...' }
  → cc_core 将 reason 返回给模型
  → 模型停止工具调用
```

### 4.2 极小概率超支

乐观读（不加锁）允许极小概率超支：
- 超支量有限（最多一次 LLM 响应的 token 量）
- Phase 2 LLM Proxy 对账可发现并补偿

### 4.3 审计日志

所有工具调用（allow 和 block）都写入 `tool_audit_logs`，包含：
- 脱敏后的输入参数
- 阻断原因
- 匹配的 deny 规则

---

## 5. 数据安全

### 5.1 Session 数据生命周期

```
Session 活跃期：
  数据在 /sessions/{tenant_id}/{session_id}/ 本地存储

Session 终止时：
  1. 打包 → 上传 OSS（加密存储）
  2. 本地目录异步清理（rm -rf）
  3. 进程内 sessionStore 清理

Session 恢复时：
  从 OSS 下载 → 解压到本地 → 重新激活
```

### 5.2 审计日志脱敏

```typescript
// 写入 tool_audit_logs 前脱敏
function sanitize(input: Record<string, unknown>): Record<string, unknown> {
  const SENSITIVE_KEYS = ['password', 'token', 'secret', 'key', 'credential', 'auth']
  return Object.fromEntries(
    Object.entries(input).map(([k, v]) => [
      k,
      SENSITIVE_KEYS.some(s => k.toLowerCase().includes(s)) ? '[REDACTED]' : v
    ])
  )
}
```

---

## 6. 基础设施安全

### 6.1 进程资源限制（K8s）

```yaml
resources:
  limits:
    cpu: "4"
    memory: "8Gi"
  requests:
    cpu: "1"
    memory: "2Gi"
```

### 6.2 网络隔离

```
cc_ee Pod → Anthropic API：仅允许出站 HTTPS 443
cc_ee Pod → PostgreSQL：仅允许内网访问
cc_ee Pod → OSS：仅允许内网访问
外部 → cc_ee Pod：仅允许通过 API Gateway
```

### 6.3 Secret 管理

```
ANTHROPIC_API_KEY → K8s Secret
DATABASE_URL      → K8s Secret
OSS_ACCESS_KEY    → K8s Secret
JWT_SECRET        → K8s Secret
```

---

## 7. 安全审计清单

| 检查项 | 实现位置 | 状态 |
|--------|---------|------|
| `allowManagedHooksOnly: true` | managed-settings.json | Phase 1a |
| 平台级静态 deny 规则 | managed-settings.json | Phase 1a |
| 租户级动态 deny 规则 | PreToolUse HookCallback | Phase 1a |
| Token 预算检查 | PreToolUse HookCallback | Phase 1a |
| 工具调用审计日志 | Pre/PostToolUse HookCallback | Phase 1a |
| 审计日志脱敏 | sanitize() 函数 | Phase 1a |
| Session 工作目录隔离 | runWithCwdOverride | Phase 1a |
| Session 终止后数据清理 | Session 生命周期管理 | Phase 1a |
| LLM Proxy 双重校验 | LLM Proxy | Phase 2 |
| Skill 安全扫描 | 发布流程 | Phase 3 |
| 异常检测与告警 | 监控系统 | Phase 4 |
| 进程资源限制 | K8s 配置 | Phase 4 |
