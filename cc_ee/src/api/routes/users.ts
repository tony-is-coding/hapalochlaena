import { FastifyInstance } from 'fastify'
import { userRepo } from '../../repositories/user.repo'
import { authMiddleware } from '../middleware/auth'

export async function userRoutes(fastify: FastifyInstance) {
  fastify.post('/api/users', async (request, reply) => {
    const { tenantId, email, password, role } = request.body as any
    const user = await userRepo.create({ tenantId, email, password, role })
    return reply.code(201).send({ id: user.id, email: user.email, role: user.role })
  })

  fastify.get('/api/users', { preHandler: [authMiddleware] }, async (request) => {
    const { tenantId } = (request.user as any)
    const users = await userRepo.findByTenant(tenantId)
    return users.map(u => ({ id: u.id, email: u.email, role: u.role, createdAt: u.createdAt }))
  })
}
