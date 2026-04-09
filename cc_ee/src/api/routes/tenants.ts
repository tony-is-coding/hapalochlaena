import { FastifyInstance } from 'fastify'
import { tenantService } from '../../services/tenant.service'
import { authMiddleware } from '../middleware/auth'

export async function tenantRoutes(fastify: FastifyInstance) {
  fastify.get('/api/tenants', { preHandler: [authMiddleware] }, async (request) => {
    return tenantService.listTenants()
  })

  fastify.post('/api/tenants', async (request, reply) => {
    const { name, tokenBudgetMonthly } = request.body as { name: string; tokenBudgetMonthly?: number }
    const tenant = await tenantService.createTenant({ name, tokenBudgetMonthly })
    return reply.code(201).send(tenant)
  })

  fastify.get('/api/tenants/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const tenant = await tenantService.getTenant(id)
    if (!tenant) return reply.code(404).send({ error: 'Tenant not found' })
    return tenant
  })
}
