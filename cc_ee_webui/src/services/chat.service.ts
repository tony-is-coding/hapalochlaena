import api from './api'
import { Message } from '../types/message'

class ChatService {
  async createSession(projectPath: string): Promise<{ sessionId: string }> {
    const response = await api.post('/api/sessions', { projectPath })
    return response.data
  }

  async sendMessage(sessionId: string, message: string): Promise<void> {
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
