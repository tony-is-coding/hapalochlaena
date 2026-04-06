// cc_ee/config.ts

import path from 'node:path'
import os from 'node:os'

const root = process.env.AGENT_CORE_ROOT ?? path.join(os.homedir(), '.agent-core')

export const config = {
  // Root directory for all platform data
  dataRoot: root,

  // SQLite database path
  dbPath: path.join(root, 'agent-core.db'),

  // Per-session workspace root: /workspace/{tenantId}/{sessionId}/
  workspaceRoot: path.join(root, 'workspace'),

  // Per-session cc_core config home: /homes/{tenantId}/{userId}/
  homesRoot: path.join(root, 'homes'),

  // Checkpoint storage root
  checkpointRoot: path.join(root, 'checkpoints'),

  // Tenant skills root: /skills/{tenantId}/
  skillsRoot: path.join(root, 'skills'),

  // Hooks middleware HTTP server
  hooksServer: {
    host: process.env.HOOKS_HOST ?? '127.0.0.1',
    port: parseInt(process.env.HOOKS_PORT ?? '9001', 10),
  },

  // API Gateway
  gateway: {
    port: parseInt(process.env.GATEWAY_PORT ?? '8080', 10),
    apiKeyHeader: 'x-api-key',
  },

  // Path to cc_core CLI binary
  ccCoreBin: process.env.CC_CORE_BIN ?? path.join(process.cwd(), 'cc_core', 'node_modules', '.bin', 'claude'),
}
