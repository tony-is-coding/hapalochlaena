import { pool } from '../config/database'
import { Tenant, CreateTenantInput } from '../models/tenant'

export class TenantRepository {
  async create(input: CreateTenantInput): Promise<Tenant> {
    const result = await pool.query(
      `INSERT INTO tenants (name, token_budget_monthly, permission_rules)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [
        input.name,
        input.tokenBudgetMonthly || 1000000,
        JSON.stringify(input.permissionRules || { allow: [], deny: [] })
      ]
    )
    return this.mapRow(result.rows[0])
  }

  async findById(id: string): Promise<Tenant | null> {
    const result = await pool.query('SELECT * FROM tenants WHERE id = $1', [id])
    return result.rows[0] ? this.mapRow(result.rows[0]) : null
  }

  async findAll(): Promise<Tenant[]> {
    const result = await pool.query('SELECT * FROM tenants ORDER BY created_at DESC')
    return result.rows.map(row => this.mapRow(row))
  }

  private mapRow(row: any): Tenant {
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      tokenBudgetMonthly: parseInt(row.token_budget_monthly, 10),
      enabledSkillIds: row.enabled_skill_ids || [],
      permissionRules: row.permission_rules,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
}

export const tenantRepo = new TenantRepository()
