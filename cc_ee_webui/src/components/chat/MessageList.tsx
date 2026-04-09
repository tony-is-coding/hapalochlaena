import { useEffect, useRef } from 'react'
import { Typography, Tag } from 'antd'
import { Message } from '../../types/message'

const { Text } = Typography

interface MessageListProps {
  messages: Message[]
  isStreaming: boolean
}

export default function MessageList({ messages, isStreaming }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {messages.map((msg, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
          }}
        >
          <div
            style={{
              maxWidth: '70%',
              padding: '10px 14px',
              borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
              backgroundColor: msg.role === 'user' ? '#1677ff' : '#f5f5f5',
              color: msg.role === 'user' ? 'white' : 'rgba(0,0,0,0.88)',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            <Text style={{ color: 'inherit', fontSize: '14px' }}>{msg.content}</Text>
          </div>
        </div>
      ))}
      {isStreaming && (
        <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
          <Tag color="processing">Thinking...</Tag>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  )
}
