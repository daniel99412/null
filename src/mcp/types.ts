/**
 * Shared types for the MCP tool system.
 * These mirror the MCP protocol types but are decoupled from the SDK
 * to keep the core logic SDK-independent.
 */

export interface MCPToolParameter {
  type: string
  description?: string
  properties?: Record<string, unknown>
  items?: Record<string, unknown>
  required?: string[]
  enum?: string[]
}

export interface MCPToolDefinition {
  name: string
  description: string
  inputSchema: MCPToolParameter
  handler: (args: Record<string, unknown>) => Promise<unknown>
}

export interface OllamaToolFormat {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: MCPToolParameter
  }
}

export interface OllamaToolCall {
  function: {
    name: string
    arguments: string
  }
}

export interface OllamaToolCallResponse {
  content: string
  toolCalls?: Array<{
    name: string
    arguments: Record<string, unknown>
  }>
}

export interface MCPServerConfig {
  command: string
  args?: string[]
  transport?: 'stdio' | 'sse'
  url?: string
}
