import { tokenLedgerRepo } from '../repositories/token-ledger.repo'

class TokenService {
  async checkBudget(tenantId: string, period: string): Promise<{ total: number; used: number }> {
    const ledger = await tokenLedgerRepo.findByTenantAndPeriod(tenantId, period)
    if (!ledger) return { total: 0, used: 0 }
    return { total: ledger.totalBudget, used: ledger.used }
  }

  async incrementUsage(tenantId: string, period: string, tokens: number): Promise<void> {
    await tokenLedgerRepo.incrementUsage(tenantId, period, tokens)
  }

  async initializePeriod(tenantId: string, period: string, totalBudget: number): Promise<void> {
    await tokenLedgerRepo.initializePeriod(tenantId, period, totalBudget)
  }
}

export const tokenService = new TokenService()
