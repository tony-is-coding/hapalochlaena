import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
  // 创建测试租户
  const tenant = await prisma.tenant.create({
    data: {
      name: '测试租户',
      status: 'active',
      tokenBudgetMonthly: 1000000,
      permissionRules: {
        deny: []
      }
    }
  })

  console.log('创建租户:', tenant.id)

  // 创建测试用户
  const passwordHash = await bcrypt.hash('password123', 10)
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: 'test@example.com',
      passwordHash,
      role: 'admin'
    }
  })

  console.log('创建用户:', user.email)

  // 创建当前月份的 token ledger
  const period = new Date().toISOString().slice(0, 7) // YYYY-MM
  await prisma.tokenLedger.create({
    data: {
      tenantId: tenant.id,
      period,
      totalBudget: tenant.tokenBudgetMonthly,
      used: 0
    }
  })

  console.log('创建 token ledger，周期:', period)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
