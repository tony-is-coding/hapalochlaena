import { sessionRepo } from '../repositories/session.repo'
import { v4 as uuidv4 } from 'uuid'
import fs from 'fs-extra'

class SessionService {
  async createSession(params: {
    tenantId: string
    userId: string
    projectPath?: string
  }): Promise<{ sessionId: string }> {
    const { tenantId, userId } = params
    const sessionId = uuidv4()
    const workingDir = `/tmp/cc_ee_sessions/${tenantId}/${sessionId}`

    await fs.ensureDir(workingDir)

    await sessionRepo.create({
      id: sessionId,
      tenantId,
      userId,
      workingDir,
      nodeId: process.env.NODE_ID || 'local',
    })

    return { sessionId }
  }

  async terminateSession(sessionId: string, tenantId: string, userId: string): Promise<void> {
    const session = await sessionRepo.findById(sessionId)
    if (!session || session.tenantId !== tenantId || session.userId !== userId) {
      throw new Error('Session not found or access denied')
    }
    await sessionRepo.update(sessionId, { status: 'terminated' })
    fs.remove(session.workingDir).catch(console.error)
  }

  async getSession(sessionId: string, tenantId: string) {
    const session = await sessionRepo.findById(sessionId)
    if (!session || session.tenantId !== tenantId) return null
    return session
  }

  async listSessions(tenantId: string, userId: string) {
    return sessionRepo.findByTenantAndUser(tenantId, userId)
  }
}

export const sessionService = new SessionService()
