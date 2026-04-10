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
