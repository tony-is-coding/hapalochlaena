import { FastifyInstance } from 'fastify'
import { sessionService } from '../../services/session.service'
import { authMiddleware } from '../middleware/auth'

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

  // Send message (stub - returns SSE stream placeholder)
  fastify.post('/api/sessions/:sessionId/query', { preHandler: [authMiddleware] }, async (request, reply) => {
    const { sessionId } = request.params as any
    const { message } = request.body as any

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    // Stub response - cc_core integration to be wired in Phase 2
    reply.raw.write(`data: ${JSON.stringify({ type: 'assistant', content: `[stub] Echo: ${message}` })}\n\n`)
    reply.raw.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
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
