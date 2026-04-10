# cc_ee API 协议规范

**版本**: 1.0
**基于**: cc_ee 整体架构 v3.0

---

## 1. 总览

cc_ee 提供 RESTful API 和 WebSocket 接口，用于前后端通信。

```
前端 (React)
    │
    ├── REST API (HTTP/HTTPS)
    │   ├── 认证 (JWT)
    │   ├── 租户管理
    │   ├── 用户管理
    │   ├── Session 管理
    │   └── Skill 管理
    │
    └── WebSocket
        ├── 实时对话流式响应
        ├── Session 状态更新
        └── 系统通知
```

---

## 2. 认证

### 2.1 登录

**请求**:
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

**响应**:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user_123",
    "email": "user@example.com",
    "tenantId": "tenant_456",
    "role": "developer"
  }
}
```

**错误响应**:
```json
{
  "error": "Invalid credentials",
  "code": "AUTH_FAILED"
}
```

---

### 2.2 注册

**请求**:
```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123",
  "tenantId": "tenant_456"
}
```

**响应**:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user_123",
    "email": "user@example.com",
    "tenantId": "tenant_456",
    "role": "developer"
  }
}
```

---

### 2.3 JWT Token 格式

```json
{
  "userId": "user_123",
  "tenantId": "tenant_456",
  "email": "user@example.com",
  "role": "developer",
  "iat": 1678886400,
  "exp": 1678972800
}
```

**使用方式**:
```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## 3. Session 管理

### 3.1 创建 Session

**请求**:
```http
POST /api/sessions
Authorization: Bearer {token}
Content-Type: application/json

{
  "projectPath": "/path/to/project",
  "initialMessage": "Hello, I need help with authentication"
}
```

**响应**:
```json
{
  "sessionId": "sess_1678886400_abc123",
  "status": "active",
  "createdAt": "2026-04-09T10:00:00Z"
}
```

---

### 3.2 列出 Sessions

**请求**:
```http
GET /api/sessions
Authorization: Bearer {token}
```

**响应**:
```json
{
  "sessions": [
    {
      "id": "sess_1678886400_abc123",
      "status": "active",
      "createdAt": "2026-04-09T10:00:00Z",
      "lastActiveAt": "2026-04-09T11:30:00Z",
      "messageCount": 15
    },
    {
      "id": "sess_1678800000_def456",
      "status": "terminated",
      "createdAt": "2026-04-08T10:00:00Z",
      "lastActiveAt": "2026-04-08T15:00:00Z",
      "messageCount": 42
    }
  ]
}
```

---

### 3.3 获取 Session 详情

**请求**:
```http
GET /api/sessions/{sessionId}
Authorization: Bearer {token}
```

**响应**:
```json
{
  "id": "sess_1678886400_abc123",
  "tenantId": "tenant_456",
  "userId": "user_123",
  "status": "active",
  "workingDir": "/sessions/tenant_456/sess_1678886400_abc123",
  "createdAt": "2026-04-09T10:00:00Z",
  "lastActiveAt": "2026-04-09T11:30:00Z",
  "messageCount": 15,
  "tokenUsage": {
    "inputTokens": 12500,
    "outputTokens": 8300
  }
}
```

---

### 3.4 发送消息 (SSE 流式响应)

**请求**:
```http
POST /api/sessions/{sessionId}/query
Authorization: Bearer {token}
Content-Type: application/json

{
  "message": "How do I implement JWT authentication?"
}
```

**响应** (Server-Sent Events):
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

data: {"type":"request_start","model":"claude-opus-4-6"}

data: {"type":"assistant","content":"To implement JWT authentication","streaming":true}

data: {"type":"assistant","content":", you'll need to","streaming":true}

data: {"type":"tool_use","tool_name":"Read","input":{"file_path":"src/auth.ts"}}

data: {"type":"tool_result","tool_use_id":"toolu_123","content":"..."}

data: {"type":"assistant","content":"Based on the code...","streaming":false}

data: {"type":"usage","input_tokens":1250,"output_tokens":830}

data: {"type":"done"}
```

---

### 3.5 获取历史消息

**请求**:
```http
GET /api/sessions/{sessionId}/messages?offset=0&limit=50
Authorization: Bearer {token}
```

**响应**:
```json
{
  "messages": [
    {
      "role": "user",
      "content": "How do I implement JWT authentication?",
      "timestamp": "2026-04-09T10:00:00Z"
    },
    {
      "role": "assistant",
      "content": "To implement JWT authentication, you'll need to...",
      "timestamp": "2026-04-09T10:00:15Z",
      "usage": {
        "inputTokens": 1250,
        "outputTokens": 830
      }
    }
  ],
  "total": 15,
  "offset": 0,
  "limit": 50
}
```

---

### 3.6 终止 Session

**请求**:
```http
DELETE /api/sessions/{sessionId}
Authorization: Bearer {token}
```

**响应**:
```json
{
  "success": true,
  "message": "Session terminated and archived"
}
```

---

### 3.7 恢复 Session

**请求**:
```http
POST /api/sessions/{sessionId}/resume
Authorization: Bearer {token}
```

**响应**:
```json
{
  "success": true,
  "sessionId": "sess_1678886400_abc123",
  "status": "active"
}
```

---

## 4. 租户管理 (Admin API)

### 4.1 创建租户

**请求**:
```http
POST /api/admin/tenants
Authorization: Bearer {admin_token}
Content-Type: application/json

{
  "name": "Acme Corp",
  "tokenBudget": 1000000,
  "permissionRules": {
    "allow": ["*"],
    "deny": ["Bash:rm -rf"]
  }
}
```

**响应**:
```json
{
  "id": "tenant_789",
  "name": "Acme Corp",
  "tokenBudget": 1000000,
  "createdAt": "2026-04-09T10:00:00Z"
}
```

---

### 4.2 获取租户列表

**请求**:
```http
GET /api/admin/tenants
Authorization: Bearer {admin_token}
```

**响应**:
```json
{
  "tenants": [
    {
      "id": "tenant_456",
      "name": "Acme Corp",
      "tokenBudget": 1000000,
      "tokenUsed": 250000,
      "userCount": 15,
      "sessionCount": 42,
      "createdAt": "2026-04-01T10:00:00Z"
    }
  ]
}
```

---

### 4.3 更新租户配置

**请求**:
```http
PATCH /api/admin/tenants/{tenantId}
Authorization: Bearer {admin_token}
Content-Type: application/json

{
  "tokenBudget": 2000000,
  "permissionRules": {
    "allow": ["*"],
    "deny": ["Bash:rm -rf", "Bash:DROP TABLE"]
  }
}
```

**响应**:
```json
{
  "id": "tenant_456",
  "name": "Acme Corp",
  "tokenBudget": 2000000,
  "updatedAt": "2026-04-09T10:00:00Z"
}
```

---

## 5. 用户管理

### 5.1 创建用户

**请求**:
```http
POST /api/admin/users
Authorization: Bearer {admin_token}
Content-Type: application/json

{
  "email": "newuser@example.com",
  "password": "password123",
  "tenantId": "tenant_456",
  "role": "developer"
}
```

**响应**:
```json
{
  "id": "user_789",
  "email": "newuser@example.com",
  "tenantId": "tenant_456",
  "role": "developer",
  "createdAt": "2026-04-09T10:00:00Z"
}
```

---

### 5.2 列出租户用户

**请求**:
```http
GET /api/admin/tenants/{tenantId}/users
Authorization: Bearer {admin_token}
```

**响应**:
```json
{
  "users": [
    {
      "id": "user_123",
      "email": "user@example.com",
      "role": "developer",
      "sessionCount": 5,
      "tokenUsage": 50000,
      "createdAt": "2026-04-01T10:00:00Z"
    }
  ]
}
```

---

## 6. Skill 管理

### 6.1 列出所有 Skills

**请求**:
```http
GET /api/skills
Authorization: Bearer {token}
```

**响应**:
```json
{
  "skills": [
    {
      "id": "skill_123",
      "name": "test-driven-development",
      "description": "Use when implementing any feature or bugfix",
      "version": "1.2.0",
      "official": true
    },
    {
      "id": "skill_456",
      "name": "brainstorming",
      "description": "Explores user intent before implementation",
      "version": "2.0.1",
      "official": true
    }
  ]
}
```

---

### 6.2 激活 Skill

**请求**:
```http
POST /api/admin/tenants/{tenantId}/skills/{skillId}
Authorization: Bearer {admin_token}
```

**响应**:
```json
{
  "success": true,
  "message": "Skill activated for tenant"
}
```

---

### 6.3 停用 Skill

**请求**:
```http
DELETE /api/admin/tenants/{tenantId}/skills/{skillId}
Authorization: Bearer {admin_token}
```

**响应**:
```json
{
  "success": true,
  "message": "Skill deactivated for tenant"
}
```

---

## 7. Token 使用统计

### 7.1 获取租户 Token 使用情况

**请求**:
```http
GET /api/admin/tenants/{tenantId}/token-usage?period=2026-04
Authorization: Bearer {admin_token}
```

**响应**:
```json
{
  "tenantId": "tenant_456",
  "period": "2026-04",
  "totalBudget": 1000000,
  "used": 250000,
  "remaining": 750000,
  "breakdown": {
    "inputTokens": 150000,
    "outputTokens": 100000
  },
  "dailyUsage": [
    {
      "date": "2026-04-01",
      "tokens": 12500
    },
    {
      "date": "2026-04-02",
      "tokens": 15300
    }
  ]
}
```

---

## 8. WebSocket 协议

### 8.1 连接

**URL**: `ws://localhost:3000/ws/sessions/{sessionId}`

**认证**: 通过 URL 参数传递 token
```
ws://localhost:3000/ws/sessions/{sessionId}?token={jwt_token}
```

---

### 8.2 消息格式

#### 8.2.1 客户端 → 服务器

**发送消息**:
```json
{
  "type": "message",
  "content": "How do I implement authentication?"
}
```

**取消请求**:
```json
{
  "type": "cancel"
}
```

---

#### 8.2.2 服务器 → 客户端

**流式文本**:
```json
{
  "type": "assistant",
  "content": "To implement authentication",
  "streaming": true
}
```

**工具调用**:
```json
{
  "type": "tool_use",
  "tool_name": "Read",
  "tool_use_id": "toolu_123",
  "input": {
    "file_path": "src/auth.ts"
  }
}
```

**工具结果**:
```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_123",
  "content": "export function authenticate(token: string) { ... }"
}
```

**Token 使用**:
```json
{
  "type": "usage",
  "input_tokens": 1250,
  "output_tokens": 830
}
```

**错误**:
```json
{
  "type": "error",
  "error": "Token budget exhausted",
  "code": "BUDGET_EXHAUSTED"
}
```

**完成**:
```json
{
  "type": "done"
}
```

---

## 9. 错误码

| 错误码 | HTTP 状态码 | 说明 |
|--------|------------|------|
| `AUTH_FAILED` | 401 | 认证失败 |
| `TOKEN_EXPIRED` | 401 | Token 过期 |
| `FORBIDDEN` | 403 | 无权限访问 |
| `SESSION_NOT_FOUND` | 404 | Session 不存在 |
| `BUDGET_EXHAUSTED` | 429 | Token 预算耗尽 |
| `RATE_LIMIT_EXCEEDED` | 429 | 请求频率超限 |
| `INTERNAL_ERROR` | 500 | 内部服务器错误 |

---

## 10. 速率限制

| 端点 | 限制 | 说明 |
|------|------|------|
| `POST /api/auth/login` | 5 次/分钟 | 防止暴力破解 |
| `POST /api/sessions` | 10 次/分钟 | 防止滥用 |
| `POST /api/sessions/{id}/query` | 60 次/小时 | 防止过度使用 |
| 其他 API | 100 次/分钟 | 通用限制 |

**响应头**:
```http
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1678886400
```

---

## 11. 分页

所有列表 API 支持分页：

**请求**:
```http
GET /api/sessions?offset=0&limit=20
```

**响应**:
```json
{
  "sessions": [...],
  "total": 150,
  "offset": 0,
  "limit": 20,
  "hasMore": true
}
```

---

## 12. 审计日志 API

### 12.1 查询审计日志

**请求**:
```http
GET /api/admin/audit-logs?tenantId=tenant_456&startDate=2026-04-01&endDate=2026-04-09
Authorization: Bearer {admin_token}
```

**响应**:
```json
{
  "logs": [
    {
      "id": "log_123",
      "sessionId": "sess_abc",
      "tenantId": "tenant_456",
      "userId": "user_123",
      "toolName": "Bash",
      "decision": "allow",
      "timestamp": "2026-04-09T10:00:00Z"
    },
    {
      "id": "log_124",
      "sessionId": "sess_abc",
      "tenantId": "tenant_456",
      "userId": "user_123",
      "toolName": "Bash",
      "decision": "block",
      "reason": "Token budget exhausted",
      "timestamp": "2026-04-09T11:00:00Z"
    }
  ],
  "total": 1250
}
```

---

## 13. 健康检查

**请求**:
```http
GET /health
```

**响应**:
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 86400,
  "database": "connected",
  "oss": "connected"
}
```

---

## 14. API 版本控制

所有 API 路径包含版本号：

```
/api/v1/sessions
/api/v1/tenants
```

当前版本：`v1`

---

## 15. CORS 配置

```javascript
{
  "origin": ["http://localhost:5173", "https://cc-ee.example.com"],
  "methods": ["GET", "POST", "PUT", "PATCH", "DELETE"],
  "allowedHeaders": ["Content-Type", "Authorization"],
  "credentials": true
}
```

---

## 16. 数据模型 TypeScript 定义

```typescript
// Session
interface Session {
  id: string
  tenantId: string
  userId: string
  status: 'active' | 'terminated'
  workingDir: string
  createdAt: string
  lastActiveAt: string
  messageCount: number
  tokenUsage: {
    inputTokens: number
    outputTokens: number
  }
}

// Message
interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
  usage?: {
    inputTokens: number
    outputTokens: number
  }
  metadata?: any
}

// Tenant
interface Tenant {
  id: string
  name: string
  tokenBudget: number
  tokenUsed: number
  permissionRules: {
    allow: string[]
    deny: string[]
  }
  createdAt: string
}

// User
interface User {
  id: string
  email: string
  tenantId: string
  role: 'admin' | 'developer' | 'viewer'
  createdAt: string
}

// Skill
interface Skill {
  id: string
  name: string
  description: string
  version: string
  content: string
  official: boolean
}
```

---

## 17. 前端集成示例

### 17.1 登录并创建 Session

```typescript
import axios from 'axios'

const api = axios.create({
  baseURL: 'http://localhost:3000',
})

// 登录
const { data } = await api.post('/api/auth/login', {
  email: 'user@example.com',
  password: 'password123',
})

// 保存 token
localStorage.setItem('token', data.token)

// 设置认证头
api.defaults.headers.common['Authorization'] = `Bearer ${data.token}`

// 创建 Session
const session = await api.post('/api/sessions', {
  projectPath: '/default',
})

console.log('Session ID:', session.data.sessionId)
```

### 17.2 WebSocket 流式对话

```typescript
const ws = new WebSocket(
  `ws://localhost:3000/ws/sessions/${sessionId}?token=${token}`
)

ws.onopen = () => {
  // 发送消息
  ws.send(JSON.stringify({
    type: 'message',
    content: 'How do I implement authentication?',
  }))
}

ws.onmessage = (event) => {
  const data = JSON.parse(event.data)

  switch (data.type) {
    case 'assistant':
      if (data.streaming) {
        // 流式文本
        appendToMessage(data.content)
      } else {
        // 完整消息
        addMessage(data.content)
      }
      break

    case 'tool_use':
      console.log('Tool:', data.tool_name)
      break

    case 'usage':
      console.log('Tokens:', data.input_tokens + data.output_tokens)
      break

    case 'done':
      console.log('Response complete')
      break

    case 'error':
      console.error('Error:', data.error)
      break
  }
}
```

---

## 18. 下一步

1. **后端实现**：参考 `10-backend-architecture.md` 实现 API 路由
2. **前端对接**：参考 `11-frontend-architecture.md` 实现 API 调用
3. **测试**：编写 API 集成测试
4. **文档**：生成 OpenAPI/Swagger 文档
