# cc_ee_webui 前端架构设计

**版本**: 1.0
**基于**: cc_ee 整体架构 v3.0

---

## 1. 目录结构

```
cc_ee_webui/
├── public/
│   ├── index.html
│   └── favicon.ico
│
├── src/
│   ├── main.tsx              # 应用入口
│   ├── App.tsx               # 根组件
│   │
│   ├── pages/                # 页面组件
│   │   ├── LoginPage.tsx     # 登录页
│   │   ├── RegisterPage.tsx  # 注册页
│   │   ├── DashboardPage.tsx # 仪表盘
│   │   ├── ChatPage.tsx      # 对话页面
│   │   ├── SessionsPage.tsx  # Session 列表
│   │   ├── AdminPage.tsx     # 管理后台
│   │   └── SettingsPage.tsx  # 设置页面
│   │
│   ├── components/           # 可复用组件
│   │   ├── layout/
│   │   │   ├── Header.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   └── Layout.tsx
│   │   │
│   │   ├── chat/
│   │   │   ├── ChatWindow.tsx      # 对话窗口
│   │   │   ├── MessageList.tsx     # 消息列表
│   │   │   ├── MessageItem.tsx     # 单条消息
│   │   │   ├── InputBox.tsx        # 输入框
│   │   │   └── StreamingText.tsx   # 流式文本渲染
│   │   │
│   │   ├── session/
│   │   │   ├── SessionCard.tsx     # Session 卡片
│   │   │   ├── SessionList.tsx     # Session 列表
│   │   │   └── SessionActions.tsx  # Session 操作
│   │   │
│   │   ├── admin/
│   │   │   ├── TenantManager.tsx   # 租户管理
│   │   │   ├── UserManager.tsx     # 用户管理
│   │   │   ├── SkillManager.tsx    # Skill 管理
│   │   │   └── TokenDashboard.tsx  # Token 仪表盘
│   │   │
│   │   └── common/
│   │       ├── Button.tsx
│   │       ├── Input.tsx
│   │       ├── Modal.tsx
│   │       ├── Loading.tsx
│   │       └── ErrorBoundary.tsx
│   │
│   ├── hooks/                # 自定义 Hooks
│   │   ├── useAuth.ts        # 认证 Hook
│   │   ├── useWebSocket.ts   # WebSocket Hook
│   │   ├── useSession.ts     # Session 管理 Hook
│   │   ├── useChat.ts        # 对话 Hook
│   │   └── useApi.ts         # API 调用 Hook
│   │
│   ├── store/                # 状态管理
│   │   ├── index.ts          # Store 配置
│   │   ├── authSlice.ts      # 认证状态
│   │   ├── sessionSlice.ts   # Session 状态
│   │   ├── chatSlice.ts      # 对话状态
│   │   └── uiSlice.ts        # UI 状态
│   │
│   ├── services/             # API 服务层
│   │   ├── api.ts            # Axios 配置
│   │   ├── auth.service.ts   # 认证服务
│   │   ├── session.service.ts # Session 服务
│   │   ├── chat.service.ts   # 对话服务
│   │   ├── admin.service.ts  # 管理服务
│   │   └── websocket.service.ts # WebSocket 服务
│   │
│   ├── types/                # TypeScript 类型定义
│   │   ├── auth.ts
│   │   ├── session.ts
│   │   ├── message.ts
│   │   ├── tenant.ts
│   │   └── api.ts
│   │
│   ├── utils/                # 工具函数
│   │   ├── format.ts         # 格式化工具
│   │   ├── validation.ts     # 验证工具
│   │   ├── storage.ts        # 本地存储
│   │   └── constants.ts      # 常量定义
│   │
│   └── styles/               # 样式文件
│       ├── global.css
│       ├── variables.css
│       └── themes.css
│
├── package.json
├── tsconfig.json
├── vite.config.ts
└── .env.example
```

---

## 2. 核心模块设计

### 2.1 应用入口 (`src/main.tsx`)

```typescript
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Provider } from 'react-redux'
import { store } from './store'
import App from './App'
import './styles/global.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </Provider>
  </React.StrictMode>
)
```

---

### 2.2 根组件 (`src/App.tsx`)

```typescript
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import DashboardPage from './pages/DashboardPage'
import ChatPage from './pages/ChatPage'
import SessionsPage from './pages/SessionsPage'
import AdminPage from './pages/AdminPage'
import SettingsPage from './pages/SettingsPage'
import Layout from './components/layout/Layout'
import ErrorBoundary from './components/common/ErrorBoundary'

function App() {
  const { isAuthenticated, isLoading } = useAuth()

  if (isLoading) {
    return <div>Loading...</div>
  }

  return (
    <ErrorBoundary>
      <Routes>
        {/* 公开路由 */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* 受保护路由 */}
        <Route
          path="/"
          element={
            isAuthenticated ? (
              <Layout>
                <DashboardPage />
              </Layout>
            ) : (
              <Navigate to="/login" />
            )
          }
        />
        <Route
          path="/chat/:sessionId?"
          element={
            isAuthenticated ? (
              <Layout>
                <ChatPage />
              </Layout>
            ) : (
              <Navigate to="/login" />
            )
          }
        />
        <Route
          path="/sessions"
          element={
            isAuthenticated ? (
              <Layout>
                <SessionsPage />
              </Layout>
            ) : (
              <Navigate to="/login" />
            )
          }
        />
        <Route
          path="/admin"
          element={
            isAuthenticated ? (
              <Layout>
                <AdminPage />
              </Layout>
            ) : (
              <Navigate to="/login" />
            )
          }
        />
        <Route
          path="/settings"
          element={
            isAuthenticated ? (
              <Layout>
                <SettingsPage />
              </Layout>
            ) : (
              <Navigate to="/login" />
            )
          }
        />
      </Routes>
    </ErrorBoundary>
  )
}

export default App
```

---

### 2.3 对话页面 (`src/pages/ChatPage.tsx`)

```typescript
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useChat } from '../hooks/useChat'
import { useSession } from '../hooks/useSession'
import ChatWindow from '../components/chat/ChatWindow'
import MessageList from '../components/chat/MessageList'
import InputBox from '../components/chat/InputBox'
import Loading from '../components/common/Loading'

export default function ChatPage() {
  const { sessionId } = useParams<{ sessionId?: string }>()
  const navigate = useNavigate()
  const { createSession, getSession } = useSession()
  const { messages, sendMessage, isStreaming } = useChat(sessionId)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    // 如果没有 sessionId，创建新 session
    if (!sessionId) {
      handleCreateSession()
    }
  }, [sessionId])

  const handleCreateSession = async () => {
    setIsLoading(true)
    try {
      const newSession = await createSession({
        projectPath: '/default',
      })
      navigate(`/chat/${newSession.sessionId}`)
    } catch (error) {
      console.error('Failed to create session:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSendMessage = async (message: string) => {
    if (!sessionId) return
    await sendMessage(message)
  }

  if (isLoading) {
    return <Loading />
  }

  return (
    <ChatWindow>
      <MessageList messages={messages} isStreaming={isStreaming} />
      <InputBox onSend={handleSendMessage} disabled={isStreaming} />
    </ChatWindow>
  )
}
```

---

### 2.4 自定义 Hooks

#### 2.4.1 `useAuth.ts` - 认证 Hook

```typescript
import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { RootState } from '../store'
import { login, logout, verifyToken } from '../store/authSlice'
import { authService } from '../services/auth.service'

export function useAuth() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const { user, token, isAuthenticated, isLoading } = useSelector(
    (state: RootState) => state.auth
  )

  useEffect(() => {
    // 验证 token
    const token = localStorage.getItem('token')
    if (token) {
      dispatch(verifyToken(token))
    }
  }, [dispatch])

  const handleLogin = async (email: string, password: string) => {
    try {
      const response = await authService.login(email, password)
      dispatch(login(response))
      localStorage.setItem('token', response.token)
      navigate('/')
    } catch (error) {
      throw error
    }
  }

  const handleLogout = () => {
    dispatch(logout())
    localStorage.removeItem('token')
    navigate('/login')
  }

  return {
    user,
    token,
    isAuthenticated,
    isLoading,
    login: handleLogin,
    logout: handleLogout,
  }
}
```

#### 2.4.2 `useChat.ts` - 对话 Hook

```typescript
import { useEffect, useState, useCallback } from 'react'
import { useWebSocket } from './useWebSocket'
import { chatService } from '../services/chat.service'
import { Message } from '../types/message'

export function useChat(sessionId?: string) {
  const [messages, setMessages] = useState<Message[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [currentStreamingMessage, setCurrentStreamingMessage] = useState('')

  const { connect, disconnect, send, isConnected } = useWebSocket({
    url: `ws://localhost:3000/ws/sessions/${sessionId}`,
    onMessage: handleWebSocketMessage,
  })

  useEffect(() => {
    if (sessionId) {
      // 加载历史消息
      loadMessages()
      // 连接 WebSocket
      connect()
    }

    return () => {
      disconnect()
    }
  }, [sessionId])

  const loadMessages = async () => {
    if (!sessionId) return
    try {
      const history = await chatService.getHistory(sessionId)
      setMessages(history)
    } catch (error) {
      console.error('Failed to load messages:', error)
    }
  }

  function handleWebSocketMessage(event: MessageEvent) {
    const data = JSON.parse(event.data)

    switch (data.type) {
      case 'assistant':
        if (data.streaming) {
          setIsStreaming(true)
          setCurrentStreamingMessage((prev) => prev + data.content)
        } else {
          setIsStreaming(false)
          setMessages((prev) => [
            ...prev,
            {
              role: 'assistant',
              content: currentStreamingMessage + data.content,
              timestamp: Date.now(),
            },
          ])
          setCurrentStreamingMessage('')
        }
        break

      case 'tool_use':
        // 处理工具调用
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: `[Tool: ${data.tool_name}]`,
            timestamp: Date.now(),
            metadata: data,
          },
        ])
        break

      case 'error':
        console.error('Chat error:', data.error)
        setIsStreaming(false)
        break
    }
  }

  const sendMessage = useCallback(
    async (content: string) => {
      if (!sessionId) return

      // 添加用户消息到列表
      const userMessage: Message = {
        role: 'user',
        content,
        timestamp: Date.now(),
      }
      setMessages((prev) => [...prev, userMessage])

      // 发送消息到后端
      try {
        await chatService.sendMessage(sessionId, content)
      } catch (error) {
        console.error('Failed to send message:', error)
      }
    },
    [sessionId]
  )

  return {
    messages,
    isStreaming,
    currentStreamingMessage,
    sendMessage,
    isConnected,
  }
}
```

#### 2.4.3 `useWebSocket.ts` - WebSocket Hook

```typescript
import { useEffect, useRef, useState, useCallback } from 'react'

interface UseWebSocketOptions {
  url: string
  onMessage: (event: MessageEvent) => void
  onOpen?: () => void
  onClose?: () => void
  onError?: (error: Event) => void
  reconnectInterval?: number
  maxReconnectAttempts?: number
}

export function useWebSocket({
  url,
  onMessage,
  onOpen,
  onClose,
  onError,
  reconnectInterval = 3000,
  maxReconnectAttempts = 5,
}: UseWebSocketOptions) {
  const [isConnected, setIsConnected] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectAttemptsRef = useRef(0)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>()

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return
    }

    const ws = new WebSocket(url)

    ws.onopen = () => {
      setIsConnected(true)
      reconnectAttemptsRef.current = 0
      onOpen?.()
    }

    ws.onmessage = onMessage

    ws.onclose = () => {
      setIsConnected(false)
      onClose?.()

      // 自动重连
      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectAttemptsRef.current++
          connect()
        }, reconnectInterval)
      }
    }

    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
      onError?.(error)
    }

    wsRef.current = ws
  }, [url, onMessage, onOpen, onClose, onError])

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
    }
    wsRef.current?.close()
    wsRef.current = null
    setIsConnected(false)
  }, [])

  const send = useCallback((data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data))
    }
  }, [])

  useEffect(() => {
    return () => {
      disconnect()
    }
  }, [disconnect])

  return {
    connect,
    disconnect,
    send,
    isConnected,
  }
}
```

---

### 2.5 状态管理 (Redux Toolkit)

#### 2.5.1 Store 配置 (`src/store/index.ts`)

```typescript
import { configureStore } from '@reduxjs/toolkit'
import authReducer from './authSlice'
import sessionReducer from './sessionSlice'
import chatReducer from './chatSlice'
import uiReducer from './uiSlice'

export const store = configureStore({
  reducer: {
    auth: authReducer,
    session: sessionReducer,
    chat: chatReducer,
    ui: uiReducer,
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
```

#### 2.5.2 认证状态 (`src/store/authSlice.ts`)

```typescript
import { createSlice, PayloadAction } from '@reduxjs/toolkit'

interface User {
  id: string
  email: string
  tenantId: string
  role: string
}

interface AuthState {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  isLoading: boolean
}

const initialState: AuthState = {
  user: null,
  token: null,
  isAuthenticated: false,
  isLoading: true,
}

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    login: (state, action: PayloadAction<{ user: User; token: string }>) => {
      state.user = action.payload.user
      state.token = action.payload.token
      state.isAuthenticated = true
      state.isLoading = false
    },
    logout: (state) => {
      state.user = null
      state.token = null
      state.isAuthenticated = false
    },
    verifyToken: (state, action: PayloadAction<string>) => {
      state.token = action.payload
      state.isLoading = false
      // 实际验证逻辑在 middleware 中处理
    },
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload
    },
  },
})

export const { login, logout, verifyToken, setLoading } = authSlice.actions
export default authSlice.reducer
```

---

### 2.6 API 服务层

#### 2.6.1 Axios 配置 (`src/services/api.ts`)

```typescript
import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000',
  timeout: 30000,
})

// 请求拦截器：添加 JWT token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 响应拦截器：处理错误
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token 过期，跳转到登录页
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default api
```

#### 2.6.2 对话服务 (`src/services/chat.service.ts`)

```typescript
import api from './api'
import { Message } from '../types/message'

class ChatService {
  /**
   * 发送消息（SSE 流式响应）
   */
  async sendMessage(sessionId: string, message: string): Promise<void> {
    // 使用 fetch 而非 axios，因为需要处理 SSE
    const token = localStorage.getItem('token')
    const response = await fetch(
      `${import.meta.env.VITE_API_BASE_URL}/api/sessions/${sessionId}/query`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message }),
      }
    )

    if (!response.ok) {
      throw new Error('Failed to send message')
    }

    // SSE 流式响应由 WebSocket 处理
  }

  /**
   * 获取历史消息
   */
  async getHistory(sessionId: string): Promise<Message[]> {
    const response = await api.get(`/api/sessions/${sessionId}/messages`)
    return response.data.messages
  }
}

export const chatService = new ChatService()
```

---

## 3. 技术栈

| 组件 | 技术选型 | 版本 | 说明 |
|------|---------|------|------|
| **框架** | React | 18.x | 主流前端框架 |
| **语言** | TypeScript | 5.x | 类型安全 |
| **构建工具** | Vite | 5.x | 快速开发构建 |
| **路由** | React Router | 6.x | 客户端路由 |
| **状态管理** | Redux Toolkit | 2.x | 简化 Redux 开发 |
| **HTTP 客户端** | Axios | 1.x | HTTP 请求 |
| **WebSocket** | 原生 WebSocket API | - | 实时通信 |
| **UI 组件库** | Ant Design / Tailwind CSS | 5.x / 3.x | UI 组件 |
| **代码高亮** | Prism.js / Highlight.js | - | 代码展示 |
| **Markdown 渲染** | react-markdown | 9.x | Markdown 渲染 |
| **测试** | Vitest + React Testing Library | 1.x | 单元测试 |

---

## 4. 页面设计

### 4.1 登录页面

```
┌─────────────────────────────────────────┐
│                                         │
│          cc_ee Enterprise               │
│                                         │
│     ┌─────────────────────────────┐    │
│     │  Email                      │    │
│     │  [___________________]      │    │
│     │                             │    │
│     │  Password                   │    │
│     │  [___________________]      │    │
│     │                             │    │
│     │  [ Login ]                  │    │
│     │                             │    │
│     │  Don't have an account?     │    │
│     │  Register                   │    │
│     └─────────────────────────────┘    │
│                                         │
└─────────────────────────────────────────┘
```

### 4.2 对话页面

```
┌─────────────────────────────────────────────────────────┐
│ Header: Session Name                    [Settings] [⚙]  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  User: How do I implement authentication?              │
│                                                         │
│  Assistant: To implement authentication, you can...    │
│  [streaming text...]                                   │
│                                                         │
│  [Tool: Bash] Running command: npm install...          │
│                                                         │
│                                                         │
│                                                         │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ [Type your message here...]                    [Send]  │
└─────────────────────────────────────────────────────────┘
```

### 4.3 Session 列表页面

```
┌─────────────────────────────────────────────────────────┐
│ Sessions                                  [+ New]       │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────┐  │
│  │ Session 1: Authentication Implementation        │  │
│  │ Last active: 2 hours ago                        │  │
│  │ [Resume] [Archive] [Delete]                     │  │
│  └─────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─────────────────────────────────────────────────┐  │
│  │ Session 2: Database Migration                   │  │
│  │ Last active: 1 day ago                          │  │
│  │ [Resume] [Archive] [Delete]                     │  │
│  └─────────────────────────────────────────────────┘  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 5. 关键设计决策

### 5.1 为什么选择 React？

- **生态成熟**：组件库、工具链完善
- **TypeScript 支持**：类型安全
- **社区活跃**：问题解决快
- **团队熟悉**：降低学习成本

### 5.2 为什么选择 Redux Toolkit？

- **简化 Redux**：减少样板代码
- **内置 Immer**：不可变状态更新
- **TypeScript 友好**：类型推导完善
- **DevTools 支持**：调试方便

### 5.3 为什么选择 Vite？

- **快速启动**：比 Webpack 快 10-100 倍
- **HMR**：热更新体验好
- **原生 ESM**：现代化构建
- **TypeScript 原生支持**：无需额外配置

### 5.4 WebSocket vs SSE？

- **WebSocket**：双向通信，适合实时对话
- **SSE**：单向流式响应，适合 query 结果流式返回
- **混合使用**：WebSocket 用于实时通知，SSE 用于流式响应

---

## 6. 性能优化

### 6.1 代码分割

```typescript
// 路由懒加载
const ChatPage = lazy(() => import('./pages/ChatPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))

<Suspense fallback={<Loading />}>
  <Routes>
    <Route path="/chat" element={<ChatPage />} />
    <Route path="/admin" element={<AdminPage />} />
  </Routes>
</Suspense>
```

### 6.2 虚拟滚动

```typescript
// 消息列表使用虚拟滚动（react-window）
import { FixedSizeList } from 'react-window'

<FixedSizeList
  height={600}
  itemCount={messages.length}
  itemSize={80}
  width="100%"
>
  {({ index, style }) => (
    <div style={style}>
      <MessageItem message={messages[index]} />
    </div>
  )}
</FixedSizeList>
```

### 6.3 消息缓存

```typescript
// 使用 React Query 缓存历史消息
import { useQuery } from '@tanstack/react-query'

const { data: messages } = useQuery({
  queryKey: ['messages', sessionId],
  queryFn: () => chatService.getHistory(sessionId),
  staleTime: 5 * 60 * 1000, // 5 分钟
})
```

---

## 7. 下一步

1. **API 协议对接**：参考 `12-api-protocol.md` 实现 API 调用
2. **UI 设计**：使用 Ant Design 或 Tailwind CSS 实现界面
3. **测试**：编写单元测试和 E2E 测试
4. **部署**：配置 Nginx 静态文件服务
