export interface Tenant {
  id: string
  name: string
  status: 'active' | 'suspended' | 'deleted'
  tokenBudgetMonthly: number
  enabledSkillIds: string[]
  permissionRules: {
    allow: string[]
    deny: string[]
  }
  createdAt: Date
  updatedAt: Date
}

export interface CreateTenantInput {
  name: string
  tokenBudgetMonthly?: number
  permissionRules?: {
    allow: string[]
    deny: string[]
  }
}
