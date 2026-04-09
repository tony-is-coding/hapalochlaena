import { AsyncLocalStorage } from 'async_hooks'
import type { SessionId } from '../types/ids.js'

export type SessionOverrideContext = {
  sessionId: SessionId
  tenantId: string
  userId: string
}

const sessionOverrideStorage = new AsyncLocalStorage<SessionOverrideContext>()

/**
 * Run a function with a per-session context override for the current async context.
 * All calls to getSessionOverride() within the function (and its async descendants)
 * will return this context. Enables concurrent sessions in the same process.
 */
export function runWithSessionOverride<T>(ctx: SessionOverrideContext, fn: () => T): T {
  return sessionOverrideStorage.run(ctx, fn)
}

/**
 * Get the current session override context, if any.
 */
export function getSessionOverride(): SessionOverrideContext | undefined {
  return sessionOverrideStorage.getStore()
}
