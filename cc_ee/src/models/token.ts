export interface TokenLedger {
  tenantId: string
  period: string
  totalBudget: number
  used: number
  lastUpdatedAt: Date
}

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
}
