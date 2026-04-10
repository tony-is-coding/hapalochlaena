import { FastifyInstance } from 'fastify'
import { tenantService } from '../../services/tenant.service'
import { authMiddleware } from '../middleware/auth'

export async function tenantRoutes(fastify: FastifyInstance) {
  // Issue #3 + #7: GET /api/tenants — only return current user's tenant (non-admins)
  fastify.get('/api/tenants', { preHandler: [authMiddleware] }, async (request) => {
    const { tenantId, role } = request.user as { tenantId: string; role: string }
    if (role === 'system_admin') {
      return tenantService.listTenants()
    }
    // Non-admin users can only see their own tenant
    return tenantService.getTenant(tenantId)
  })

  // Issue #3: POST /api/tenants — require auth (system_admin only)
  fastify.post('/api/tenants', { preHandler: [authMiddleware] }, async (request, reply) => {
    const { role } = request.user as { role: string }
    if (role !== 'system_admin') {
      return reply.code(403).send({ error: 'Only system admins can create tenants' })
    }
    const { name, tokenBudgetMonthly } = request.body as { name: string; tokenBudgetMonthly?: number }
    const tenant = await tenantService.createTenant({ name, tokenBudgetMonthly })
    return reply.code(201).send(tenant)
  })

  fastify.get('/api/tenants/:id', { preHandler: [authMiddleware] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { tenantId, role } = request.user as { tenantId: string; role: string }
    // Non-admins can only access their own tenant
    if (role !== 'system_admin' && id !== tenantId) {
      return reply.code(403).send({ error: 'Access denied' })
    }
    const tenant = await tenantService.getTenant(id)
    if (!tenant) return reply.code(404).send({ error: 'Tenant not found' })
    return tenant
  })
}
