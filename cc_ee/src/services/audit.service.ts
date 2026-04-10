import { pool } from '../config/database'

interface AuditLogInput {
  sessionId: string
  tenantId: string
  userId: string
  toolName: string
  decision: 'allow' | 'block'
  reason?: string
  matchedRule?: string
}

class AuditService {
  async log(input: AuditLogInput): Promise<void> {
    await pool.query(
      `INSERT INTO tool_audit_logs (session_id, tenant_id, user_id, tool_name, hook_decision, block_reason, matched_rule)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [input.sessionId, input.tenantId, input.userId, input.toolName, input.decision, input.reason || null, input.matchedRule || null]
    )
  }
}

export const auditService = new AuditService()
