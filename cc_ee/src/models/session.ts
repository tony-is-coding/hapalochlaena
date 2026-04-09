export interface Session {
  id: string
  tenantId: string
  userId: string
  workingDir: string
  status: 'active' | 'idle' | 'terminated'
  nodeId: string | null
  ossArchivePath: string | null
  createdAt: Date
  lastActiveAt: Date
}

export interface CreateSessionInput {
  tenantId: string
  userId: string
  projectPath?: string
}
