// cc_ee/types/index.ts

export interface Tenant {
  id: string           // UUID
  name: string
  apiKey: string       // hashed SHA-256
  tokenQuota: number   // total monthly token budget
  createdAt: number    // Unix ms
  isActive: boolean
}

export interface User {
  id: string           // UUID
  tenantId: string
  externalId: string   // e.g. SSO user ID
  displayName: string
  createdAt: number
  isActive: boolean
}

export interface Session {
  id: string           // UUID = cc_core session ID we pass via --resume
  tenantId: string
  userId: string
  workspaceDir: string // /workspace/{tenantId}/{sessionId}/
  configDir: string    // home dir override for cc_core
  status: SessionStatus
  createdAt: number
  endedAt?: number
  tokensUsed: number
  checkpointId?: string
}

export type SessionStatus = 'active' | 'ended' | 'error'

export interface Checkpoint {
  id: string           // UUID
  sessionId: string
  tenantId: string
  userId: string
  transcriptPath: string   // path to .jsonl file
  archivePath: string      // path to workspace .tar.gz
  metadataPath: string     // path to metadata .json
  createdAt: number
  workspaceDirSnapshot: string  // original workspace dir at capture time
}

export interface CheckpointMetadata {
  sessionId: string
  tenantId: string
  userId: string
  tokensUsed: number
  createdAt: number
  workspaceDir: string
}

export interface TokenUsageEvent {
  sessionId: string
  tenantId: string
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  model: string
  timestamp: number
}

export interface HookEvent {
  type: 'PreToolUse' | 'PostToolUse' | 'Stop'
  sessionId: string
  tenantId: string
  toolName?: string
  toolInput?: unknown
  toolResult?: unknown
  apiUsage?: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
  timestamp: number
}

export interface BudgetStatus {
  tenantId: string
  quota: number
  used: number
  remaining: number
  percentUsed: number
}

export interface CreateSessionRequest {
  tenantId: string
  userId: string
  resumeCheckpointId?: string  // if resuming a previous session
}

export interface CreateSessionResponse {
  sessionId: string
  workspaceDir: string
  hookServerUrl: string
}
