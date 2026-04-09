import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Spin, Alert } from 'antd'
import { useChat } from '../hooks/useChat'
import { chatService } from '../services/chat.service'
import Layout from '../components/layout/Layout'
import MessageList from '../components/chat/MessageList'
import InputBox from '../components/chat/InputBox'

export default function ChatPage() {
  const { sessionId } = useParams<{ sessionId?: string }>()
  const navigate = useNavigate()
  const { messages, sendMessage, isStreaming } = useChat(sessionId)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) {
      setIsCreating(true)
      chatService.createSession('/default')
        .then(({ sessionId: newId }) => navigate(`/chat/${newId}`, { replace: true }))
        .catch(() => setError('Failed to create session'))
        .finally(() => setIsCreating(false))
    }
  }, [sessionId, navigate])

  if (isCreating) {
    return (
      <Layout>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: 'calc(100vh - 64px)' }}>
          <Spin size="large" tip="Starting session..." />
        </div>
      </Layout>
    )
  }

  return (
    <Layout>
      <div style={{ height: 'calc(100vh - 112px)', display: 'flex', flexDirection: 'column', background: 'white', borderRadius: '8px', border: '1px solid #f0f0f0' }}>
        {error && <Alert message={error} type="error" showIcon closable onClose={() => setError(null)} />}
        <MessageList messages={messages} isStreaming={isStreaming} />
        <InputBox onSend={sendMessage} disabled={isStreaming} />
      </div>
    </Layout>
  )
}
