export interface User {
  id: string
  tenantId: string
  email: string
  role: 'admin' | 'member'
  passwordHash: string
  createdAt: Date
}

export interface CreateUserInput {
  tenantId: string
  email: string
  password: string
  role?: 'admin' | 'member'
}
