// @ts-nocheck
/**
 * cc_core integration layer.
 * Uses serial mode (switchSession) — concurrent mode comes later.
 */

import { switchSession, registerHookCallbacks, getSessionId } from '../../cc_core/bootstrap/state.js'
import { runWithCwdOverride } from '../../cc_core/utils/cwd.js'
import { query } from '../../cc_core/query.js'
import { asSystemPrompt } from '../../cc_core/utils/systemPromptType.js'
import { pool } from '../config/database'
import { createAbortController } from '../../cc_core/utils/abortController.js'

// Maps cc_core sessionId → tenantId for hook callbacks
const sessionTenantMap = new Map<string, string>()

let initialized = false

export function initCcCore(baseCwd: string): void {
  if (initialized) return
  initialized = true

  registerHookCallbacks({
    PreToolUse: [
      {
        // Callback-style hook (no pluginRoot) — runs for every tool use
        matcher: { type: 'always' },
        callback: async () => {
          const sessionId = getSessionId()
          const tenantId = sessionTenantMap.get(sessionId)
          if (!tenantId) return { decision: 'approve' }

          try {
            const result = await pool.query(
              `SELECT token_budget, tokens_used FROM token_ledgers
               WHERE tenant_id = $1
               ORDER BY period_start DESC LIMIT 1`,
              [tenantId],
            )
            if (result.rows.length === 0) return { decision: 'approve' }
            const { token_budget, tokens_used } = result.rows[0]
            if (token_budget !== null && tokens_used >= token_budget) {
              return { decision: 'block', reason: 'Token budget exhausted for this tenant' }
            }
          } catch (err) {
            console.error('[ccCoreIntegration] token budget check failed:', err)
          }

          return { decision: 'approve' }
        },
      },
    ],
  })
}

export async function* handleTurn(params: {
  sessionId: string
  tenantId: string
  workingDir: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
}): AsyncGenerator<string> {
  const { sessionId, tenantId, workingDir, messages } = params

  // Register session → tenant mapping for hook callbacks
  sessionTenantMap.set(sessionId, tenantId)

  // Switch cc_core's global session to this session
  switchSession(sessionId as any)

  // Build minimal QueryParams
  const abortController = createAbortController()

  let appState: any = {
    toolPermissionContext: {
      mode: 'default',
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      alwaysAskRules: {},
      isBypassPermissionsModeAvailable: false,
    },
  }

  const toolUseContext: any = {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'claude-opus-4-5',
      tools: [],
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: true,
      agentDefinitions: { activeAgents: [], allAgents: [] },
    },
    abortController,
    readFileState: new Map(),
    getAppState: () => appState,
    setAppState: (f: any) => { appState = f(appState) },
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
  }

  const ccMessages: any[] = messages.map(m => ({
    type: m.role === 'user' ? 'user' : 'assistant',
    message: {
      role: m.role,
      content: [{ type: 'text', text: m.content }],
    },
    uuid: crypto.randomUUID(),
  }))

  const queryParams: any = {
    messages: ccMessages,
    systemPrompt: asSystemPrompt([]),
    userContext: {},
    systemContext: {},
    canUseTool: async () => ({ behavior: 'allow' as const }),
    toolUseContext,
    querySource: 'sdk' as const,
  }

  try {
    const gen = runWithCwdOverride(workingDir, () => query(queryParams))

    for await (const event of gen) {
      yield `data: ${JSON.stringify(event)}\n\n`

      // Track token usage from AssistantMessage
      if (event.type === 'assistant' && (event as any).message?.usage) {
        const usage = (event as any).message.usage
        const totalTokens = (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0)
        if (totalTokens > 0) {
          pool.query(
            `INSERT INTO token_ledgers (tenant_id, tokens_used, period_start)
             VALUES ($1, $2, date_trunc('month', now()))
             ON CONFLICT (tenant_id, period_start)
             DO UPDATE SET tokens_used = token_ledgers.tokens_used + $2`,
            [tenantId, totalTokens],
          ).catch((err: any) => console.error('[ccCoreIntegration] token ledger update failed:', err))
        }
      }
    }
  } finally {
    sessionTenantMap.delete(sessionId)
  }

  yield `data: ${JSON.stringify({ type: 'done' })}\n\n`
}
