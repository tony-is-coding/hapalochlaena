import { pool } from '../config/database'
import { Session } from '../models/session'

export class SessionRepository {
  async create(data: {
    id: string
    tenantId: string
    userId: string
    workingDir: string
    nodeId: string
  }): Promise<Session> {
    const result = await pool.query(
      `INSERT INTO sessions (id, tenant_id, user_id, working_dir, status, node_id)
       VALUES ($1, $2, $3, $4, 'active', $5)
       RETURNING *`,
      [data.id, data.tenantId, data.userId, data.workingDir, data.nodeId]
    )
    return this.mapRow(result.rows[0])
  }

  async findById(id: string): Promise<Session | null> {
    const result = await pool.query('SELECT * FROM sessions WHERE id = $1', [id])
    return result.rows[0] ? this.mapRow(result.rows[0]) : null
  }

  async findByTenantAndUser(tenantId: string, userId: string): Promise<Session[]> {
    const result = await pool.query(
      'SELECT * FROM sessions WHERE tenant_id = $1 AND user_id = $2 ORDER BY created_at DESC',
      [tenantId, userId]
    )
    return result.rows.map(row => this.mapRow(row))
  }

  async update(id: string, data: Partial<Session>): Promise<void> {
    const fields: string[] = []
    const values: any[] = []
    let paramIndex = 1

    if (data.status) { fields.push(`status = $${paramIndex++}`); values.push(data.status) }
    if (data.ossArchivePath) { fields.push(`oss_archive_path = $${paramIndex++}`); values.push(data.ossArchivePath) }
    if (data.lastActiveAt) { fields.push(`last_active_at = $${paramIndex++}`); values.push(data.lastActiveAt) }

    if (fields.length === 0) return

    values.push(id)
    await pool.query(`UPDATE sessions SET ${fields.join(', ')} WHERE id = $${paramIndex}`, values)
  }

  private mapRow(row: any): Session {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      userId: row.user_id,
      workingDir: row.working_dir,
      status: row.status,
      nodeId: row.node_id,
      ossArchivePath: row.oss_archive_path,
      createdAt: row.created_at,
      lastActiveAt: row.last_active_at,
    }
  }
}

export const sessionRepo = new SessionRepository()
