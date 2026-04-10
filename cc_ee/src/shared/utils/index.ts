export function getCurrentPeriod(): string {
  return new Date().toISOString().slice(0, 7) // YYYY-MM
}

export function sanitizeInput(input: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = ['password', 'token', 'secret', 'key', 'apiKey', 'api_key']
  const sanitized: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(input)) {
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
      sanitized[key] = '[REDACTED]'
    } else {
      sanitized[key] = value
    }
  }

  return sanitized
}

export function matchDenyRules(
  denyRules: string[],
  input: { tool_name: string; input: Record<string, unknown> }
): string | null {
  for (const rule of denyRules) {
    const toolInput = JSON.stringify(input.input)
    if (toolInput.includes(rule)) {
      return rule
    }
  }
  return null
}
