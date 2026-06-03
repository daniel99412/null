/**
 * MCP Initialization
 *
 * Called once at startup. Connects to internal tools and any configured
 * external MCP servers.
 */

import { getRegistry } from './registry.js'
import { loadConfig } from '../config/index.js'
import { debugLog } from '../utils/debug.js'

let initialized = false

/**
 * Initialize MCP servers:
 * 1. Internal Null tools are registered by default via the registry constructor.
 * 2. External MCP servers are connected based on config file.
 *
 * Safe to call multiple times — only runs once.
 */
export async function initMCPServers(): Promise<void> {
  if (initialized) {
    debugLog('[mcp] already initialized, skipping')
    return
  }
  initialized = true

  const registry = getRegistry()
  const config = loadConfig()
  const externalServers = config.mcpServers

  if (!externalServers || Object.keys(externalServers).length === 0) {
    debugLog('[mcp] no external servers configured')
    return
  }

  debugLog(`[mcp] connecting to ${Object.keys(externalServers).length} external server(s)`)

  for (const [name, serverConfig] of Object.entries(externalServers)) {
    try {
      debugLog(`[mcp] connecting to external server "${name}"...`)
      await registry.connectExternalServer({
        command: serverConfig.command,
        args: serverConfig.args,
      })
      debugLog(`[mcp] external server "${name}" connected successfully`)
    } catch (err) {
      debugLog(`[mcp] failed to connect server "${name}": ${err}`)
      // Don't throw — other servers should still try to connect
    }
  }

  debugLog(`[mcp] initialization complete — ${registry.externalServerCount} external server(s) connected`)
}

/**
 * Reset initialization state (useful for testing).
 */
export function resetMCPInit(): void {
  initialized = false
}
