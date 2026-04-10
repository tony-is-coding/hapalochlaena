import { FastifyInstance } from 'fastify'
import { userRepo } from '../../repositories/user.repo'
import { authMiddleware } from '../middleware/auth'

export async function userRoutes(fastify: FastifyInstance) {
  // Issue #3: POST /api/users — require auth; tenantId and role enforced from JWT
  fastify.post('/api/users', { preHandler: [authMiddleware] }, async (request, reply) => {
    const { tenantId: callerTenantId, role: callerRole } = request.user as { tenantId: string; role: string }

    // Only admin or system_admin can create users
    if (callerRole !== 'admin' && callerRole !== 'system_admin') {
      return reply.code(403).send({ error: 'Only admins can create users' })
    }

    const { email, password } = request.body as { email: string; password: string }
    // Force tenantId from JWT — client cannot specify another tenant
    const tenantId = callerTenantId
    // Client cannot elevate to admin/system_admin
    const role = 'member'

    const user = await userRepo.create({ tenantId, email, password, role })
    return reply.code(201).send({ id: user.id, email: user.email, role: user.role })
  })

  fastify.get('/api/users', { preHandler: [authMiddleware] }, async (request) => {
    const { tenantId } = (request.user as { tenantId: string })
    const users = await userRepo.findByTenant(tenantId)
    return users.map(u => ({ id: u.id, email: u.email, role: u.role, createdAt: u.createdAt }))
  })
}
