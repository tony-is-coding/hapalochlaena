import { FastifyInstance } from 'fastify'
import { sessionService } from '../../services/session.service'
import { authMiddleware } from '../middleware/auth'
import { handleTurn } from '../../core/ccCoreIntegration'

export async function sessionRoutes(fastify: FastifyInstance) {
  // Create session
  fastify.post('/api/sessions', { preHandler: [authMiddleware] }, async (request, reply) => {
    const { userId, tenantId } = request.user as any
    const { projectPath } = request.body as any
    const session = await sessionService.createSession({ tenantId, userId, projectPath })
    return reply.code(201).send(session)
  })

  // List sessions
  fastify.get('/api/sessions', { preHandler: [authMiddleware] }, async (request) => {
    const { userId, tenantId } = request.user as any
    return sessionService.listSessions(tenantId, userId)
  })

  // Send message — streams cc_core events as SSE
  fastify.post('/api/sessions/:sessionId/query', { preHandler: [authMiddleware] }, async (request, reply) => {
    const { sessionId } = request.params as any
    const { message } = request.body as any
    const { tenantId } = request.user as any

    const session = await sessionService.getSession(sessionId, tenantId)
    if (!session) return reply.code(404).send({ error: 'Session not found' })

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    const messages = [{ role: 'user' as const, content: message }]
    for await (const chunk of handleTurn({ sessionId, tenantId, workingDir: session.workingDir, messages })) {
      reply.raw.write(chunk)
    }
    reply.raw.end()
  })

  // Get session messages (stub)
  fastify.get('/api/sessions/:sessionId/messages', { preHandler: [authMiddleware] }, async (request) => {
    return { messages: [] }
  })

  // Terminate session
  fastify.delete('/api/sessions/:sessionId', { preHandler: [authMiddleware] }, async (request, reply) => {
    const { sessionId } = request.params as any
    const { userId, tenantId } = request.user as any
    await sessionService.terminateSession(sessionId, tenantId, userId)
    return { success: true }
  })
}
