export interface Session {
  id: string
  tenantId: string
  userId: string
  status: 'active' | 'terminated'
  createdAt: string
  lastActiveAt: string
}
