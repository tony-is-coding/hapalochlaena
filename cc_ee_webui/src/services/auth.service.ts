import api from './api'
import { LoginResponse } from '../types/auth'

class AuthService {
  async login(email: string, password: string): Promise<LoginResponse> {
    const response = await api.post<LoginResponse>('/api/auth/login', { email, password })
    return response.data
  }

  async register(email: string, password: string, tenantId: string): Promise<LoginResponse> {
    const response = await api.post<LoginResponse>('/api/auth/register', { email, password, tenantId })
    return response.data
  }
}

export const authService = new AuthService()
