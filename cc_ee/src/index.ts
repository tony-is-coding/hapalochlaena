import Fastify from 'fastify'
import fastifyJwt from '@fastify/jwt'
import fastifyCors from '@fastify/cors'
import { config } from './config/env'
import { authRoutes } from './api/routes/auth'
import { sessionRoutes } from './api/routes/sessions'
import { tenantRoutes } from './api/routes/tenants'
import { userRoutes } from './api/routes/users'
import { initCcCore } from './core/ccCoreIntegration'

async function start() {
  const fastify = Fastify({ logger: true })
  initCcCore(config.ccCore.baseCwd)

  await fastify.register(fastifyJwt, { secret: config.jwtSecret })
  await fastify.register(fastifyCors, { origin: true, credentials: true })

  await fastify.register(authRoutes)
  await fastify.register(sessionRoutes)
  await fastify.register(tenantRoutes)
  await fastify.register(userRoutes)

  fastify.get('/health', async () => ({ status: 'healthy', version: '1.0.0' }))

  await fastify.listen({ port: config.port, host: '0.0.0.0' })
}

start().catch((err) => {
  console.error('Failed to start server:', err)
  process.exit(1)
})
