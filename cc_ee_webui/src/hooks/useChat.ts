import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { RootState } from '../store'
import { addMessage, setMessages } from '../store/chatSlice'
import { chatService } from '../services/chat.service'
import { Message } from '../types/message'

export function useChat(sessionId?: string) {
  const dispatch = useDispatch()
  const { messages, isStreaming } = useSelector((state: RootState) => state.chat)
  const [currentStreamingMessage, setCurrentStreamingMessage] = useState('')

  useEffect(() => {
    if (sessionId) {
      chatService.getHistory(sessionId)
        .then(history => dispatch(setMessages(history)))
        .catch(err => console.error('Failed to load messages:', err))
    }
  }, [sessionId])

  const sendMessage = async (content: string) => {
    if (!sessionId) return
    const userMessage: Message = { role: 'user', content, timestamp: Date.now() }
    dispatch(addMessage(userMessage))
    await chatService.sendMessage(sessionId, content).catch(console.error)
  }

  return { messages, isStreaming, currentStreamingMessage, sendMessage }
}
