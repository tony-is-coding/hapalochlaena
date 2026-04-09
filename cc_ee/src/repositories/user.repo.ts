import { pool } from '../config/database'
import { User, CreateUserInput } from '../models/user'
import bcrypt from 'bcrypt'

export class UserRepository {
  async create(input: CreateUserInput): Promise<User> {
    const passwordHash = await bcrypt.hash(input.password, 10)
    const result = await pool.query(
      `INSERT INTO users (tenant_id, email, role, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.tenantId, input.email, input.role || 'member', passwordHash]
    )
    return this.mapRow(result.rows[0])
  }

  async findById(id: string): Promise<User | null> {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id])
    return result.rows[0] ? this.mapRow(result.rows[0]) : null
  }

  async findByEmail(email: string): Promise<User | null> {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email])
    return result.rows[0] ? this.mapRow(result.rows[0]) : null
  }

  async findByTenant(tenantId: string): Promise<User[]> {
    const result = await pool.query(
      'SELECT * FROM users WHERE tenant_id = $1 ORDER BY created_at DESC',
      [tenantId]
    )
    return result.rows.map(row => this.mapRow(row))
  }

  private mapRow(row: any): User {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      email: row.email,
      role: row.role,
      passwordHash: row.password_hash,
      createdAt: row.created_at,
    }
  }
}

export const userRepo = new UserRepository()
