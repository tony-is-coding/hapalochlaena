import { pool } from '../config/database'
import { TokenLedger } from '../models/token'

export class TokenLedgerRepository {
  async findByTenantAndPeriod(tenantId: string, period: string): Promise<TokenLedger | null> {
    const result = await pool.query(
      'SELECT * FROM token_ledgers WHERE tenant_id = $1 AND period = $2',
      [tenantId, period]
    )
    return result.rows[0] ? this.mapRow(result.rows[0]) : null
  }

  async initializePeriod(tenantId: string, period: string, totalBudget: number): Promise<void> {
    await pool.query(
      `INSERT INTO token_ledgers (tenant_id, period, total_budget, used)
       VALUES ($1, $2, $3, 0)
       ON CONFLICT (tenant_id, period) DO NOTHING`,
      [tenantId, period, totalBudget]
    )
  }

  async incrementUsage(tenantId: string, period: string, tokens: number): Promise<void> {
    await pool.query(
      `UPDATE token_ledgers SET used = used + $1, last_updated_at = NOW()
       WHERE tenant_id = $2 AND period = $3`,
      [tokens, tenantId, period]
    )
  }

  private mapRow(row: any): TokenLedger {
    return {
      tenantId: row.tenant_id,
      period: row.period,
      totalBudget: parseInt(row.total_budget, 10),
      used: parseInt(row.used, 10),
      lastUpdatedAt: row.last_updated_at,
    }
  }
}

export const tokenLedgerRepo = new TokenLedgerRepository()
