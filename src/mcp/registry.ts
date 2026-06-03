/**
 * MCP Tool Registry
 *
 * Manages internal Null tools and connections to external MCP servers.
 * Provides a unified interface for tool discovery and execution.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'

import { nullToolDefinitions } from './null-tools.js'
import { getSlashCommands } from '../core/tool-definitions.js'
import type { SlashCommand } from '../core/tool-definitions.js'
import type { MCPToolDefinition, MCPServerConfig, OllamaToolFormat, OllamaToolCallResponse } from './types.js'
import { debugLog } from '../utils/debug.js'

// ── Types ───────────────────────────────────────────────────────────────────

interface ExternalServerConnection {
  name: string
  client: Client
  transport: StdioClientTransport
  tools: Tool[]
}

// ── Registry ─────────────────────────────────────────────────────────────────

class MCPRegistry {
  private internalTools: Map<string, MCPToolDefinition> = new Map()
  private externalServers: ExternalServerConnection[] = []
  private initialized = false

  constructor() {
    for (const def of nullToolDefinitions) {
      this.internalTools.set(def.name, def)
    }
  }

  /**
   * Connect to an external MCP server via stdio.
   * Discovers its tools and adds them to the registry.
   */
  async connectExternalServer(config: MCPServerConfig): Promise<void> {
    const name = config.command.split('/').pop() ?? config.command

    try {
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
      })

      const client = new Client(
        { name: 'null-cli', version: '0.1.0' },
        { capabilities: {} },
      )

      await client.connect(transport)

      const result = await client.listTools()
      const tools = result.tools

      debugLog(`[mcp] connected to external server "${name}" — ${tools.length} tools discovered`)

      this.externalServers.push({ name, client, transport, tools })

      // Set up listChanged handler to refresh tools
      client.setNotificationHandler(
        undefined as never,
        async () => {
          debugLog(`[mcp] tools changed notification from "${name}" — re-discovering`)
          try {
            const refresh = await client.listTools()
            const server = this.externalServers.find(s => s.name === name)
            if (server) {
              server.tools = refresh.tools
            }
          } catch (err) {
            debugLog(`[mcp] failed to refresh tools for "${name}": ${err}`)
          }
        },
      )

      debugLog(`[mcp] external server "${name}" connected`)
    } catch (err) {
      debugLog(`[mcp] failed to connect external server "${name}": ${err}`)
      throw err
    }
  }

  /**
   * Disconnect all external MCP servers (called on shutdown).
   */
  async disconnectAll(): Promise<void> {
    for (const server of this.externalServers) {
      try {
        await server.client.close()
        await server.transport.close()
        debugLog(`[mcp] disconnected "${server.name}"`)
      } catch (err) {
        debugLog(`[mcp] error disconnecting "${server.name}": ${err}`)
      }
    }
    this.externalServers = []
  }

  /**
   * Return all tool definitions converted to Ollama's tools format.
   */
  getOllamaTools(): OllamaToolFormat[] {
    const tools: OllamaToolFormat[] = []

    // Internal tools
    for (const [, def] of this.internalTools) {
      tools.push(this.toOllamaFormat(def))
    }

    // External server tools
    for (const server of this.externalServers) {
      for (const tool of server.tools) {
        tools.push({
          type: 'function',
          function: {
            name: `${server.name}__${tool.name}`,
            description: tool.description ?? '',
            parameters: tool.inputSchema as MCPToolDefinition['inputSchema'],
          },
        })
      }
    }

    return tools
  }

  /**
   * Return slash commands for the slash menu (/ commands).
   * Derived from internal tool definitions with showInSlashMenu: true.
   */
  getSlashCommands(): SlashCommand[] {
    return getSlashCommands()
  }

  /**
   * Return a list of all available tools (internal + external) with basic info.
   */
  listTools(): Array<{ name: string; description: string }> {
    const result: Array<{ name: string; description: string }> = []

    for (const [, def] of this.internalTools) {
      result.push({ name: def.name, description: def.description })
    }

    for (const server of this.externalServers) {
      for (const tool of server.tools) {
        result.push({
          name: `${server.name}__${tool.name}`,
          description: tool.description ?? '',
        })
      }
    }

    return result
  }

  /**
   * Execute a tool by name with the given arguments.
   * Routes to internal handler or external MCP server.
   */
  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    // Check internal tools first
    const internal = this.internalTools.get(name)
    if (internal) {
      return internal.handler(args)
    }

    // Check external servers (tool names are prefixed with server name)
    for (const server of this.externalServers) {
      const prefix = `${server.name}__`
      if (name.startsWith(prefix)) {
        const toolName = name.slice(prefix.length)
        const tool = server.tools.find(t => t.name === toolName)
        if (!tool) {
          throw new Error(`Tool "${toolName}" not found on server "${server.name}"`)
        }

        const result = await server.client.callTool({
          name: toolName,
          arguments: args,
        })

        // Extract text content from the MCP tool result
        if (result.content && Array.isArray(result.content)) {
          return result.content
            .filter((c: { type: string }) => c.type === 'text')
            .map((c: { text: string }) => c.text)
            .join('\n')
        }
        return result
      }
    }

    throw new Error(`Unknown tool: "${name}"`)
  }

  /**
   * Try to parse a raw LLM response for tool calls.
   * Returns structured response with content and optional tool calls.
   */
  parseToolCalls(raw: string): OllamaToolCallResponse {
    // Try to parse as JSON (some Ollama models may return structured tool_calls in the content)
    try {
      const parsed = JSON.parse(raw)
      if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
        return {
          content: parsed.content ?? '',
          toolCalls: parsed.tool_calls.map((tc: { function: { name: string; arguments: string } }) => ({
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments),
          })),
        }
      }
    } catch {
      // Not JSON — treat as plain text
    }

    return { content: raw }
  }

  /**
   * Convert MCP tool definition to Ollama format.
   */
  private toOllamaFormat(def: MCPToolDefinition): OllamaToolFormat {
    return {
      type: 'function',
      function: {
        name: def.name,
        description: def.description,
        parameters: def.inputSchema,
      },
    }
  }

  /**
   * Get the number of connected external servers.
   */
  get externalServerCount(): number {
    return this.externalServers.length
  }
}

// ── Singleton ───────────────────────────────────────────────────────────────

let _registry: MCPRegistry | null = null

export function getRegistry(): MCPRegistry {
  if (!_registry) {
    _registry = new MCPRegistry()
  }
  return _registry
}

export function resetRegistry(): void {
  _registry = null
}
