# Session 生命周期

**版本**: 1.0

---

## 1. 总览

```
新建 Session                    恢复 Session
     │                               │
     ▼                               ▼
检查 token 预算              从 OSS 下载归档
     │                               │
     ▼                               ▼
创建工作目录              解压到本地工作目录
     │                               │
     └──────────────┬────────────────┘
                    ▼
           写入 Skill 文件
           (.claude/skills/*.md)
                    │
                    ▼
           switchSession(sessionId)
                    │
                    ▼
     runWithCwdOverride(tenantCwd, () => query())
                    │
                    ▼
           消费 query() generator
           ├── 提取 AssistantMessage.usage → 更新 token ledger
           └── 转发事件 → WebSocket → Web UI
                    │
                    ▼
           Session 终止
           ├── 打包工作目录 → 上传 OSS
           └── 更新 DB status = 'terminated'
```

---

## 2. Session 启动流程

### 2.1 新建 Session

```
1. API Gateway 验证 JWT
   → 提取 tenant_id, user_id

2. Control Plane 检查 token 预算
   SELECT used, total_budget FROM token_ledgers
   WHERE tenant_id = $1 AND period = $2
   → used >= total_budget → 返回 429

3. cc_ee 创建工作目录
   mkdir -p /sessions/{tenant_id}/{session_id}/.claude/skills/

4. 写入 Skill 文件
   FROM skills WHERE id IN (tenant.enabled_skill_ids)
   → /sessions/{tenant_id}/{session_id}/.claude/skills/{name}.md

5. 写入 CLAUDE.md（可选，租户级系统提示补充）
   → /sessions/{tenant_id}/{session_id}/CLAUDE.md

6. 插入 sessions 表
   INSERT INTO sessions (id, tenant_id, user_id, working_dir, status, node_id)

7. 注册 session → tenant 映射（进程内 Map）
   sessionStore.set(sessionId, { tenantId, userId })

8. 返回 session_id 给 Web UI
```

### 2.2 恢复 Session

```
1. API Gateway 验证 JWT
   → 提取 tenant_id, user_id, session_id

2. 查询 sessions 表
   → 验证 tenant_id, user_id 匹配
   → 验证 status = 'terminated'

3. 从 OSS 下载归档
   GET {oss_archive_path}
   → 解压到 /sessions/{tenant_id}/{session_id}/

4. 重新写入 Skill 文件（可能有版本更新）
   → /sessions/{tenant_id}/{session_id}/.claude/skills/

5. 更新 sessions 表
   UPDATE sessions SET status = 'active', node_id = $1

6. 注册 session → tenant 映射
   sessionStore.set(sessionId, { tenantId, userId })

7. 返回 session_id 给 Web UI
```

---

## 3. Session 运行（每次用户消息）

```typescript
// cc_ee 处理每次用户消息（串行，不并发）
async function* handleTurn(
  sessionId: string,
  userMessage: string
): AsyncGenerator<StreamEvent> {
  const { tenantId, userId } = sessionStore.get(sessionId)
  const tenantCwd = `/sessions/${tenantId}/${sessionId}`

  // 1. 从 transcript JSONL 加载历史消息
  const messages = await loadTranscript(tenantCwd, sessionId)
  messages.push({ role: 'user', content: userMessage })

  // 2. 构建 QueryParams
  const params = buildQueryParams(sessionId, tenantId, messages)

  // 3. 切换 session（串行，修改全局 STATE）
  switchSession(sessionId)

  // 4. 执行 query，per-session cwd 隔离
  const gen = runWithCwdOverride(tenantCwd, () => query(params))

  // 5. 消费 generator
  for await (const event of gen) {
    // 提取 token usage → 更新 ledger
    if (event.type === 'assistant' && event.message?.usage) {
      const tokens = event.message.usage.input_tokens + event.message.usage.output_tokens
      await db.query(
        `UPDATE token_ledgers SET used = used + $1 WHERE tenant_id = $2 AND period = $3`,
        [tokens, tenantId, getCurrentPeriod()]
      )
    }

    // 更新 session last_active_at（异步，不阻塞）
    db.query(`UPDATE sessions SET last_active_at = NOW() WHERE id = $1`, [sessionId])
      .catch(console.error)

    yield event
  }
}
```

---

## 4. Session 终止与归档

```
触发条件：
  - 用户主动结束会话
  - Session 超时（idle > 配置阈值）
  - Pod 即将重启（SIGTERM）

流程：
1. 停止接受新的用户消息

2. 打包 session 数据
   tar -czf /tmp/{session_id}.tar.gz \
     /sessions/{tenant_id}/{session_id}/

3. 上传到 OSS
   PUT /archives/{tenant_id}/{session_id}/{timestamp}.tar.gz

4. 更新 sessions 表
   UPDATE sessions SET
     status = 'terminated',
     oss_archive_path = '/archives/...'
   WHERE id = $1

5. 清理本地工作目录（异步）
   rm -rf /sessions/{tenant_id}/{session_id}/

6. 清理进程内 session 映射
   sessionStore.delete(sessionId)
```

---

## 5. 工作目录结构

```
/sessions/{tenant_id}/{session_id}/
  ├── .claude/
  │   ├── skills/
  │   │   ├── {skill_name_1}.md    ← 租户激活的 skill
  │   │   └── {skill_name_2}.md
  │   └── settings.local.json      ← 可选，session 级本地配置
  ├── CLAUDE.md                    ← 可选，租户级系统提示补充
  ├── {session_id}.jsonl           ← cc_core transcript（自动生成）
  └── {用户工作文件...}             ← Agent 操作的文件
```

**说明**：
- `.claude/skills/` 由 cc_ee 在 session 启动时写入，cc_core 通过 `getSkills(cwd)` 自动加载
- `{session_id}.jsonl` 由 cc_core 自动维护，cc_ee 不直接写入
- `CLAUDE.md` 由 cc_ee 写入，cc_core 启动时自动读取作为项目级上下文

---

## 6. 上下文组装

每次 session 启动时，cc_ee 动态组装 `QueryParams`：

```typescript
function buildQueryParams(
  sessionId: string,
  tenantId: string,
  messages: Message[]
): QueryParams {
  const tenant = await tenantCache.get(tenantId)
  const user = await userCache.get(userId)

  return {
    messages,
    systemPrompt: buildSystemPrompt(tenant, user),
    userContext: {
      user_id: user.id,
      user_email: user.email,
      user_role: user.role,
    },
    systemContext: {
      tenant_id: tenant.id,
      tenant_name: tenant.name,
    },
    canUseTool: buildCanUseTool(tenant.permission_rules),
    toolUseContext: buildToolUseContext(sessionId),
    querySource: 'cc_ee',
  }
}
```

---

## 7. Session 并发模型

```
cc_ee Pod（单进程）
  │
  ├── Worker（串行处理 session）
  │     ├── Turn 1: switchSession(A) → runWithCwdOverride(cwdA, query)
  │     ├── Turn 2: switchSession(B) → runWithCwdOverride(cwdB, query)
  │     └── Turn 3: switchSession(A) → runWithCwdOverride(cwdA, query)
  │
  └── 多个 Worker 并行（通过 Node.js worker_threads 或多进程）
        ├── Worker 1: 处理 Session A, C, E...
        └── Worker 2: 处理 Session B, D, F...
```

**关键约束**：
- `switchSession()` 在同一 Worker 内串行调用（不并发）
- `runWithCwdOverride()` 基于 AsyncLocalStorage，同一 Worker 内可以并发（但 switchSession 不行）
- 不同 Worker 之间完全独立，无共享状态（除 PostgreSQL）
