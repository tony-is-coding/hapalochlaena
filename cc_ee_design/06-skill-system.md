# Skill 系统

**版本**: 1.0（基于 2026-04-07 验证报告）

---

## 1. 总览

```
平台 Skill 仓库（PostgreSQL skills 表）
  │
  ▼
租户管理员勾选激活 skill
  → tenants.enabled_skill_ids = ['skill-a@1.2.0', 'skill-b@2.0.1']
  │
  ▼
Session 启动时，cc_ee 写入 Skill 文件
  → /sessions/{tenant_id}/{session_id}/.claude/skills/{name}.md
  │
  ▼
runWithCwdOverride(tenantCwd, () => query())
  │
  ▼
cc_core getSkills(cwd) 从 tenantCwd 向上遍历 .claude/skills/
  → 自动加载租户激活的 skill
  → 注入 system prompt
```

---

## 2. cc_core Skill 加载机制（已验证）

`cc_core/src/skills/loadSkillsDir.ts` 的 `getSkills(cwd)` 函数：

```
getSkills(cwd) 查找路径（从 cwd 向上遍历）：
  1. /sessions/{tenant_id}/{session_id}/.claude/skills/  ← cc_ee 写入的租户 skill
  2. /sessions/{tenant_id}/.claude/skills/               ← 租户级共享 skill（可选）
  3. ~/.claude/skills/                                   ← managed skills（平台全局）
```

**关键特性**：
- 每次 `query()` 调用时动态加载（不是进程启动时一次性加载）
- 结合 `runWithCwdOverride`，不同 session 自动加载各自的 skill
- 无需修改 cc_core 代码

---

## 3. Skill 文件格式

cc_core 的 skill 是 Markdown 文件，支持 YAML frontmatter：

```markdown
---
name: code-review
description: 代码审查最佳实践
version: 1.2.0
allowed_tools:
  - Read
  - Bash(git:*)
---

# 代码审查 Skill

## 使用场景
当用户请求代码审查时，遵循以下流程...

## 审查步骤
1. 读取目标文件
2. 检查代码规范
3. 提供改进建议
```

---

## 4. 数据模型

```sql
CREATE TABLE skills (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(255) NOT NULL UNIQUE,
  slug        VARCHAR(255) NOT NULL UNIQUE,  -- 用于文件名，如 code-review
  description TEXT,
  content     TEXT NOT NULL,                 -- 完整 Markdown 内容
  is_official BOOLEAN DEFAULT false,
  allowed_tools TEXT[],                      -- 该 skill 允许使用的工具
  version     VARCHAR(50) NOT NULL,          -- semver，如 1.2.0
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

-- 租户激活的 skill（含版本锁定）
-- tenants.enabled_skill_ids = ['uuid@1.2.0', 'uuid@2.0.1']
-- 格式：{skill_id}@{version}
```

---

## 5. Session 启动时的 Skill 注入

```typescript
async function injectSkills(
  tenantId: string,
  sessionId: string,
  enabledSkillIds: string[]  // ['uuid@1.2.0', 'uuid@2.0.1']
): Promise<void> {
  const skillsDir = `/sessions/${tenantId}/${sessionId}/.claude/skills`
  await fs.mkdir(skillsDir, { recursive: true })

  for (const skillRef of enabledSkillIds) {
    const [skillId, version] = skillRef.split('@')

    // 从 DB 读取 skill 内容
    const skill = await db.query<{ slug: string; content: string; version: string }>(
      `SELECT slug, content, version FROM skills WHERE id = $1`,
      [skillId]
    ).then(r => r.rows[0])

    if (!skill) {
      console.warn(`Skill ${skillId} not found, skipping`)
      continue
    }

    // 写入 skill 文件
    const filePath = path.join(skillsDir, `${skill.slug}.md`)
    await fs.writeFile(filePath, skill.content, 'utf-8')
  }
}
```

---

## 6. Skill 版本管理

### 6.1 版本锁定

租户激活 skill 时，记录当前版本号：

```typescript
// 租户管理员激活 skill
async function activateSkill(tenantId: string, skillId: string): Promise<void> {
  const skill = await db.query(
    `SELECT id, version FROM skills WHERE id = $1`,
    [skillId]
  ).then(r => r.rows[0])

  // 记录版本锁定：{skillId}@{version}
  await db.query(
    `UPDATE tenants
     SET enabled_skill_ids = array_append(enabled_skill_ids, $1)
     WHERE id = $2`,
    [`${skillId}@${skill.version}`, tenantId]
  )
}
```

### 6.2 手动升级

平台升级 skill 不自动推送给租户，租户管理员手动选择升级：

```typescript
// 租户管理员升级 skill 到最新版本
async function upgradeSkill(tenantId: string, skillId: string): Promise<void> {
  const latestSkill = await db.query(
    `SELECT id, version FROM skills WHERE id = $1`,
    [skillId]
  ).then(r => r.rows[0])

  // 替换旧版本引用
  await db.query(
    `UPDATE tenants
     SET enabled_skill_ids = array_replace(
       enabled_skill_ids,
       (SELECT $1 || '@' || version FROM skills WHERE id = $1 LIMIT 1),
       $1 || '@' || $2
     )
     WHERE id = $3`,
    [skillId, latestSkill.version, tenantId]
  )
}
```

---

## 7. Skill 安全扫描

官方 Skill 发布前进行安全扫描：

```typescript
async function scanSkillContent(content: string): Promise<ScanResult> {
  const issues: string[] = []

  // 1. 检查危险命令模式
  const DANGEROUS_PATTERNS = [
    /rm\s+-rf\s+\//,
    /dd\s+if=\/dev\/zero/,
    /curl\s+.*\|\s*bash/,
    /wget\s+.*\|\s*bash/,
    /mkfs\./,
  ]
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(content)) {
      issues.push(`Dangerous command pattern: ${pattern}`)
    }
  }

  // 2. 检查硬编码敏感信息
  const SENSITIVE_PATTERNS = [
    /sk-[a-zA-Z0-9]{32,}/,   // API keys
    /password\s*=\s*["'][^"']+["']/i,
  ]
  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(content)) {
      issues.push(`Potential sensitive data: ${pattern}`)
    }
  }

  return {
    passed: issues.length === 0,
    issues
  }
}
```

---

## 8. Skill 管理 API

```typescript
// 平台 Skill 仓库
GET  /api/skills                    // 列出所有官方 skill
GET  /api/skills/:id                // 获取 skill 详情
POST /api/skills                    // 创建新 skill（平台管理员）
PUT  /api/skills/:id                // 更新 skill（触发安全扫描）

// 租户 Skill 管理
GET  /api/tenants/:id/skills        // 列出租户激活的 skill
POST /api/tenants/:id/skills/:skillId    // 激活 skill
DELETE /api/tenants/:id/skills/:skillId  // 停用 skill
PUT  /api/tenants/:id/skills/:skillId/upgrade  // 升级到最新版本
```

---

## 9. 存量 Session 的 Skill 变更

**限制**：cc_core 的 skill 是每次 `query()` 时动态加载的（已验证），但 skill 文件是在 session 启动时写入的。

**影响**：
- 租户管理员激活/停用 skill → 只对**新建 session** 生效
- 存量 session 需要重启（终止后重新创建）才能感知 skill 变化

**未来优化**：
- 支持 session 内热更新 skill（在下次 `query()` 前重写 skill 文件）
- 通过 WebSocket 通知用户 skill 已更新，建议重启 session
