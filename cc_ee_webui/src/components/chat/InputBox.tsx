import { useState, KeyboardEvent } from 'react'
import { Input, Button } from 'antd'
import { SendOutlined } from '@ant-design/icons'

const { TextArea } = Input

interface InputBoxProps {
  onSend: (message: string) => void
  disabled?: boolean
}

export default function InputBox({ onSend, disabled }: InputBoxProps) {
  const [message, setMessage] = useState('')

  const handleSend = () => {
    const trimmed = message.trim()
    if (trimmed) {
      onSend(trimmed)
      setMessage('')
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div style={{ display: 'flex', gap: '8px', padding: '16px', borderTop: '1px solid #f0f0f0' }}>
      <TextArea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        aria-label="Message input"
        placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
        autoSize={{ minRows: 1, maxRows: 4 }}
        disabled={disabled}
        style={{ flex: 1 }}
      />
      <Button
        type="primary"
        icon={<SendOutlined />}
        onClick={handleSend}
        disabled={disabled || !message.trim()}
        style={{ alignSelf: 'flex-end' }}
      >
        Send
      </Button>
    </div>
  )
}
