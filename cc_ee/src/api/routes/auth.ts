import { FastifyInstance } from 'fastify'
import { authService } from '../../services/auth.service'
import { userRepo } from '../../repositories/user.repo'

export async function authRoutes(fastify: FastifyInstance) {
  // Login
  fastify.post('/api/auth/login', async (request, reply) => {
    const { email, password } = request.body as { email: string; password: string }
    const user = await authService.validateUser(email, password)
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
        return reply.code(409).send({ error: 'Email already exists' })
      }
      throw err
    }
  })
}
