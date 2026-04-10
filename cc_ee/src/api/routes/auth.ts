import { FastifyInstance } from 'fastify'
import { authService } from '../../services/auth.service'
import { userRepo } from '../../repositories/user.repo'
import { tenantService } from '../../services/tenant.service'

export async function authRoutes(fastify: FastifyInstance) {
  // Login
  fastify.post('/api/auth/login', async (request, reply) => {
    const { email, password, tenantId } = request.body as { email: string; password: string; tenantId: string }

    if (!tenantId) {
      return reply.code(400).send({ error: 'tenantId is required' })
    }

    // Issue #6: validateUser now requires tenantId to prevent cross-tenant identity confusion
    const user = await authService.validateUser(email, password, tenantId)
    if (!user) {
      return reply.code(401).send({ error: 'Invalid credentials' })
    }
    const token = fastify.jwt.sign({
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    })
    return { token, user: { id: user.id, email: user.email, tenantId: user.tenantId, role: user.role } }
  })

  // Register
  fastify.post('/api/auth/register', async (request, reply) => {
    const { email, password, tenantId } = request.body as { email: string; password: string; tenantId: string }

    if (!tenantId) {
      return reply.code(400).send({ error: 'tenantId is required' })
    }

    // Issue #7: Validate tenant exists before allowing registration
    const tenant = await tenantService.getTenant(tenantId)
    if (!tenant) {
      return reply.code(400).send({ error: 'Invalid tenant' })
    }

    try {
      const user = await userRepo.create({ tenantId, email, password, role: 'member' })
      const token = fastify.jwt.sign({
        userId: user.id,
        tenantId: user.tenantId,
        email: user.email,
        role: user.role,
      })
      return reply.code(201).send({ token, user: { id: user.id, email: user.email, tenantId: user.tenantId, role: user.role } })
    } catch (err: any) {
      if (err.code === '23505') {
        return reply.code(409).send({ error: 'Email already exists for this tenant' })
      }
      throw err
    }
  })
}
