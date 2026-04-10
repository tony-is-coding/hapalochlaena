# Phase 1b: Frontend Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build React-based web UI for users to access the platform through browser

**Architecture:** React + TypeScript + Vite frontend, connects to backend via REST API and WebSocket, Redux Toolkit for state management

**Tech Stack:** React 18, TypeScript 5, Vite 5, Redux Toolkit 2, Ant Design 5, Axios 1

---

## Prerequisites

Before starting, ensure:
- Phase 1a backend is completed and running
- Node.js 20.x installed
- Backend API accessible at `http://localhost:3000`

---

## File Structure Overview

```
cc_ee_webui/
├── public/
│   └── index.html
├── src/
│   ├── main.tsx                    # Application entry
│   ├── App.tsx                     # Root component
│   ├── pages/
│   │   ├── LoginPage.tsx           # Login page
│   │   ├── ChatPage.tsx            # Chat interface
│   │   └── SessionsPage.tsx        # Session list
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Header.tsx
│   │   │   └── Layout.tsx
│   │   └── chat/
│   │       ├── ChatWindow.tsx
│   │       ├── MessageList.tsx
│   │       ├── MessageItem.tsx
│   │       └── InputBox.tsx
│   ├── hooks/
│   │   ├── useAuth.ts              # Authentication hook
│   │   ├── useChat.ts              # Chat hook
│   │   └── useWebSocket.ts         # WebSocket hook
│   ├── store/
│   │   ├── index.ts                # Redux store
│   │   ├── authSlice.ts            # Auth state
│   │   └── chatSlice.ts            # Chat state
│   ├── services/
│   │   ├── api.ts                  # Axios config
│   │   ├── auth.service.ts         # Auth API
│   │   └── chat.service.ts         # Chat API
│   └── types/
│       ├── auth.ts
│       └── message.ts
├── package.json
├── tsconfig.json
├── vite.config.ts
└── .env.example
```

---

## Task 1: Project Setup

**Files:**
- Create: `cc_ee_webui/package.json`
- Create: `cc_ee_webui/tsconfig.json`
- Create: `cc_ee_webui/vite.config.ts`
- Create: `cc_ee_webui/.env.example`

- [ ] **Step 1: Initialize project**

```bash
cd cc_ee_webui
npm create vite@latest . -- --template react-ts
```

- [ ] **Step 2: Install dependencies**

```bash
npm install react-router-dom @reduxjs/toolkit react-redux axios antd
npm install --save-dev @types/react-router-dom
```

- [ ] **Step 3: Create vite.config.ts**

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
```

- [ ] **Step 4: Create .env.example**

```env
VITE_API_BASE_URL=http://localhost:3000
```

- [ ] **Step 5: Update tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 6: Commit**

```bash
git add cc_ee_webui/
git commit -m "feat(webui): initialize React project

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Type Definitions

**Files:**
- Create: `cc_ee_webui/src/types/auth.ts`
- Create: `cc_ee_webui/src/types/message.ts`
- Create: `cc_ee_webui/src/types/session.ts`

- [ ] **Step 1: Create auth.ts**

```typescript
// src/types/auth.ts
export interface User {
  id: string
  email: string
  tenantId: string
  role: string
}

export interface LoginRequest {
  email: string
  password: string
}

export interface LoginResponse {
  token: string
  user: User
}
```

- [ ] **Step 2: Create message.ts**

```typescript
// src/types/message.ts
export interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  metadata?: any
}

export interface StreamEvent {
  type: 'assistant' | 'tool_use' | 'tool_result' | 'usage' | 'error' | 'done'
  content?: string
  streaming?: boolean
  tool_name?: string
  input_tokens?: number
  output_tokens?: number
  error?: string
}
```

- [ ] **Step 3: Create session.ts**

```typescript
// src/types/session.ts
export interface Session {
  id: string
  tenantId: string
  userId: string
  status: 'active' | 'terminated'
  createdAt: string
  lastActiveAt: string
}
```

- [ ] **Step 4: Commit**

```bash
git add cc_ee_webui/src/types/
git commit -m "feat(webui): add TypeScript type definitions

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: API Service Layer

**Files:**
- Create: `cc_ee_webui/src/services/api.ts`
- Create: `cc_ee_webui/src/services/auth.service.ts`
- Create: `cc_ee_webui/src/services/chat.service.ts`

- [ ] **Step 1: Create api.ts with Axios config**

```typescript
// src/services/api.ts
import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000',
  timeout: 30000,
})

// Request interceptor: add JWT token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// Response interceptor: handle errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token')
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

export default api
```

- [ ] **Step 2: Create auth.service.ts**

```typescript
// src/services/auth.service.ts
import api from './api'
import { LoginRequest, LoginResponse } from '../types/auth'

class AuthService {
  async login(email: string, password: string): Promise<LoginResponse> {
    const response = await api.post<LoginResponse>('/api/auth/login', {
      email,
      password,
    })
    return response.data
  }

  async register(email: string, password: string, tenantId: string): Promise<LoginResponse> {
    const response = await api.post<LoginResponse>('/api/auth/register', {
      email,
      password,
      tenantId,
    })
    return response.data
  }
}

export const authService = new AuthService()
```

- [ ] **Step 3: Create chat.service.ts**

```typescript
// src/services/chat.service.ts
import api from './api'
import { Message } from '../types/message'

class ChatService {
  async createSession(projectPath: string): Promise<{ sessionId: string }> {
    const response = await api.post('/api/sessions', { projectPath })
    return response.data
  }

  async sendMessage(sessionId: string, message: string): Promise<void> {
    // SSE handled by WebSocket in useChat hook
    await api.post(`/api/sessions/${sessionId}/query`, { message })
  }

  async getHistory(sessionId: string): Promise<Message[]> {
    const response = await api.get(`/api/sessions/${sessionId}/messages`)
    return response.data.messages
  }

  async terminateSession(sessionId: string): Promise<void> {
    await api.delete(`/api/sessions/${sessionId}`)
  }
}

export const chatService = new ChatService()
```

- [ ] **Step 4: Commit**

```bash
git add cc_ee_webui/src/services/
git commit -m "feat(webui): add API service layer

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Redux Store

**Files:**
- Create: `cc_ee_webui/src/store/index.ts`
- Create: `cc_ee_webui/src/store/authSlice.ts`
- Create: `cc_ee_webui/src/store/chatSlice.ts`

- [ ] **Step 1: Create store/index.ts**

```typescript
// src/store/index.ts
import { configureStore } from '@reduxjs/toolkit'
import authReducer from './authSlice'
import chatReducer from './chatSlice'

export const store = configureStore({
  reducer: {
    auth: authReducer,
    chat: chatReducer,
  },
})

export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
```

- [ ] **Step 2: Create authSlice.ts**

```typescript
// src/store/authSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { User } from '../types/auth'

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
    setLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload
    },
  },
})

export const { login, logout, setLoading } = authSlice.actions
export default authSlice.reducer
```

- [ ] **Step 3: Create chatSlice.ts**

```typescript
// src/store/chatSlice.ts
import { createSlice, PayloadAction } from '@reduxjs/toolkit'
import { Message } from '../types/message'

interface ChatState {
  messages: Message[]
  isStreaming: boolean
  currentSessionId: string | null
}

const initialState: ChatState = {
  messages: [],
  isStreaming: false,
  currentSessionId: null,
}

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    addMessage: (state, action: PayloadAction<Message>) => {
      state.messages.push(action.payload)
    },
    setMessages: (state, action: PayloadAction<Message[]>) => {
      state.messages = action.payload
    },
    setStreaming: (state, action: PayloadAction<boolean>) => {
      state.isStreaming = action.payload
    },
    setCurrentSession: (state, action: PayloadAction<string>) => {
      state.currentSessionId = action.payload
    },
    clearMessages: (state) => {
      state.messages = []
    },
  },
})

export const { addMessage, setMessages, setStreaming, setCurrentSession, clearMessages } =
  chatSlice.actions
export default chatSlice.reducer
```

- [ ] **Step 4: Commit**

```bash
git add cc_ee_webui/src/store/
git commit -m "feat(webui): add Redux store

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Custom Hooks

**Files:**
- Create: `cc_ee_webui/src/hooks/useAuth.ts`
- Create: `cc_ee_webui/src/hooks/useChat.ts`

- [ ] **Step 1: Create useAuth.ts**

```typescript
// src/hooks/useAuth.ts
import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { RootState } from '../store'
import { login, logout, setLoading } from '../store/authSlice'
import { authService } from '../services/auth.service'

export function useAuth() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const { user, token, isAuthenticated, isLoading } = useSelector(
    (state: RootState) => state.auth
  )

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (token) {
      // Verify token (simplified - should call API)
      dispatch(setLoading(false))
    } else {
      dispatch(setLoading(false))
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

- [ ] **Step 2: Create useChat.ts**

```typescript
// src/hooks/useChat.ts
import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { RootState } from '../store'
import { addMessage, setMessages, setStreaming } from '../store/chatSlice'
import { chatService } from '../services/chat.service'
import { Message, StreamEvent } from '../types/message'

export function useChat(sessionId?: string) {
  const dispatch = useDispatch()
  const { messages, isStreaming } = useSelector((state: RootState) => state.chat)
  const [currentStreamingMessage, setCurrentStreamingMessage] = useState('')

  useEffect(() => {
    if (sessionId) {
      loadMessages()
    }
  }, [sessionId])

  const loadMessages = async () => {
    if (!sessionId) return
    try {
      const history = await chatService.getHistory(sessionId)
      dispatch(setMessages(history))
    } catch (error) {
      console.error('Failed to load messages:', error)
    }
  }

  const sendMessage = async (content: string) => {
    if (!sessionId) return

    // Add user message
    const userMessage: Message = {
      role: 'user',
      content,
      timestamp: Date.now(),
    }
    dispatch(addMessage(userMessage))

    // Send to backend (SSE streaming handled separately)
    try {
      await chatService.sendMessage(sessionId, content)
    } catch (error) {
      console.error('Failed to send message:', error)
    }
  }

  return {
    messages,
    isStreaming,
    currentStreamingMessage,
    sendMessage,
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add cc_ee_webui/src/hooks/
git commit -m "feat(webui): add custom hooks

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: UI Components

**Files:**
- Create: `cc_ee_webui/src/components/layout/Layout.tsx`
- Create: `cc_ee_webui/src/components/chat/ChatWindow.tsx`
- Create: `cc_ee_webui/src/components/chat/MessageList.tsx`
- Create: `cc_ee_webui/src/components/chat/InputBox.tsx`

- [ ] **Step 1: Create Layout.tsx**

```typescript
// src/components/layout/Layout.tsx
import { Layout as AntLayout } from 'antd'
import { ReactNode } from 'react'

const { Header, Content } = AntLayout

interface LayoutProps {
  children: ReactNode
}

export default function Layout({ children }: LayoutProps) {
  return (
    <AntLayout style={{ minHeight: '100vh' }}>
      <Header style={{ color: 'white', fontSize: '20px' }}>
        cc_ee Enterprise Platform
      </Header>
      <Content style={{ padding: '24px' }}>{children}</Content>
    </AntLayout>
  )
}
```

- [ ] **Step 2: Create ChatWindow.tsx**

```typescript
// src/components/chat/ChatWindow.tsx
import { ReactNode } from 'react'
import { Card } from 'antd'

interface ChatWindowProps {
  children: ReactNode
}

export default function ChatWindow({ children }: ChatWindowProps) {
  return (
    <Card
      style={{
        height: 'calc(100vh - 120px)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {children}
    </Card>
  )
}
```

- [ ] **Step 3: Create MessageList.tsx**

```typescript
// src/components/chat/MessageList.tsx
import { List } from 'antd'
import { Message } from '../../types/message'

interface MessageListProps {
  messages: Message[]
  isStreaming: boolean
}

export default function MessageList({ messages, isStreaming }: MessageListProps) {
  return (
    <div style={{ flex: 1, overflowY: 'auto', marginBottom: '16px' }}>
      <List
        dataSource={messages}
        renderItem={(message) => (
          <List.Item
            style={{
              justifyContent: message.role === 'user' ? 'flex-end' : 'flex-start',
            }}
          >
            <div
              style={{
                maxWidth: '70%',
                padding: '12px',
                borderRadius: '8px',
                backgroundColor: message.role === 'user' ? '#1890ff' : '#f0f0f0',
                color: message.role === 'user' ? 'white' : 'black',
              }}
            >
              {message.content}
            </div>
          </List.Item>
        )}
      />
      {isStreaming && <div>Streaming...</div>}
    </div>
  )
}
```

- [ ] **Step 4: Create InputBox.tsx**

```typescript
// src/components/chat/InputBox.tsx
import { useState } from 'react'
import { Input, Button } from 'antd'
import { SendOutlined } from '@ant-design/icons'

interface InputBoxProps {
  onSend: (message: string) => void
  disabled?: boolean
}

export default function InputBox({ onSend, disabled }: InputBoxProps) {
  const [message, setMessage] = useState('')

  const handleSend = () => {
    if (message.trim()) {
      onSend(message)
      setMessage('')
    }
  }

  return (
    <div style={{ display: 'flex', gap: '8px' }}>
      <Input
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onPressEnter={handleSend}
        placeholder="Type your message..."
        disabled={disabled}
      />
      <Button
        type="primary"
        icon={<SendOutlined />}
        onClick={handleSend}
        disabled={disabled}
      >
        Send
      </Button>
    </div>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add cc_ee_webui/src/components/
git commit -m "feat(webui): add UI components

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Pages

**Files:**
- Create: `cc_ee_webui/src/pages/LoginPage.tsx`
- Create: `cc_ee_webui/src/pages/ChatPage.tsx`

- [ ] **Step 1: Create LoginPage.tsx**

```typescript
// src/pages/LoginPage.tsx
import { useState } from 'react'
import { Form, Input, Button, Card, message } from 'antd'
import { useAuth } from '../hooks/useAuth'

export default function LoginPage() {
  const { login } = useAuth()
  const [loading, setLoading] = useState(false)

  const onFinish = async (values: { email: string; password: string }) => {
    setLoading(true)
    try {
      await login(values.email, values.password)
      message.success('Login successful')
    } catch (error) {
      message.error('Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
      }}
    >
      <Card title="Login" style={{ width: 400 }}>
        <Form onFinish={onFinish} layout="vertical">
          <Form.Item
            label="Email"
            name="email"
            rules={[{ required: true, message: 'Please input your email!' }]}
          >
            <Input />
          </Form.Item>
          <Form.Item
            label="Password"
            name="password"
            rules={[{ required: true, message: 'Please input your password!' }]}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block>
              Login
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Create ChatPage.tsx**

```typescript
// src/pages/ChatPage.tsx
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useChat } from '../hooks/useChat'
import { chatService } from '../services/chat.service'
import Layout from '../components/layout/Layout'
import ChatWindow from '../components/chat/ChatWindow'
import MessageList from '../components/chat/MessageList'
import InputBox from '../components/chat/InputBox'
import { Spin } from 'antd'

export default function ChatPage() {
  const { sessionId } = useParams<{ sessionId?: string }>()
  const navigate = useNavigate()
  const { messages, sendMessage, isStreaming } = useChat(sessionId)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!sessionId) {
      handleCreateSession()
    }
  }, [sessionId])

  const handleCreateSession = async () => {
    setIsLoading(true)
    try {
      const { sessionId: newSessionId } = await chatService.createSession('/default')
      navigate(`/chat/${newSessionId}`)
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
    return (
      <Layout>
        <div style={{ textAlign: 'center', marginTop: '100px' }}>
          <Spin size="large" />
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <ChatWindow>
        <MessageList messages={messages} isStreaming={isStreaming} />
        <InputBox onSend={handleSendMessage} disabled={isStreaming} />
      </ChatWindow>
    </Layout>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add cc_ee_webui/src/pages/
git commit -m "feat(webui): add pages

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: App Entry Point

**Files:**
- Create: `cc_ee_webui/src/App.tsx`
- Create: `cc_ee_webui/src/main.tsx`

- [ ] **Step 1: Create App.tsx**

```typescript
// src/App.tsx
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import LoginPage from './pages/LoginPage'
import ChatPage from './pages/ChatPage'

function App() {
  const { isAuthenticated, isLoading } = useAuth()

  if (isLoading) {
    return <div>Loading...</div>
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/chat/:sessionId?"
        element={isAuthenticated ? <ChatPage /> : <Navigate to="/login" />}
      />
      <Route path="/" element={<Navigate to="/chat" />} />
    </Routes>
  )
}

export default App
```

- [ ] **Step 2: Create main.tsx**

```typescript
// src/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Provider } from 'react-redux'
import { store } from './store'
import App from './App'
import 'antd/dist/reset.css'

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

- [ ] **Step 3: Test application**

```bash
npm run dev
```

Expected: Application starts on http://localhost:5173

- [ ] **Step 4: Commit**

```bash
git add cc_ee_webui/src/App.tsx cc_ee_webui/src/main.tsx
git commit -m "feat(webui): add app entry point

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Acceptance Criteria Verification

After completing all tasks, verify:

- [ ] User can login via Web UI
- [ ] User can create new session and chat
- [ ] Messages display correctly
- [ ] Input box works and sends messages
- [ ] Routing works (login → chat)

---

## Next Steps

After Phase 1b completion:
1. Proceed to Phase 2: Multi-Tenant Enhancement
2. Add WebSocket streaming for real-time chat
3. Implement admin dashboard
4. Add token usage visualization
