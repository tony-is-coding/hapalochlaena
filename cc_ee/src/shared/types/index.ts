export interface JWTPayload {
  userId: string
  tenantId: string
  email: string
  role: string
}

export interface SessionContext {
  sessionId: string
  tenantId: string
  userId: string
  workingDir: string
}

export interface TokenUsage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export interface HookInput {
  tool_name: string
  input: Record<string, unknown>
}

export interface HookOutput {
  decision: 'approve' | 'block'
  reason?: string
}
