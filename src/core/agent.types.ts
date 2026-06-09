import type { ChatMessage } from './llm-client.js'
import type { SportsScoreboard } from '../tools/sports.js'

export type AgentMode = 'deterministic' | 'llm' | 'react'

export interface Agent {
  id: string
  name: string
  description: string
  mode: AgentMode
  modelOverride?: string
  tools: string[]
  systemPrompt?: string
  handle(query: AgentQuery, context: AgentContext): Promise<AgentResponse>
}

export interface AgentQuery {
  text: string
  originalText: string
  isExplicitSearch?: boolean
  subQueries?: string[]
  attachments?: string[]
}

export interface AgentContext {
  history: ChatMessage[]
  conversationId?: string
  userMemory?: string | null
  onStatus?: (msg: string) => void
  onToolCall?: (toolName: string) => void
}

export interface AgentResponse {
  userContent: string
  searchContext: string | null
  statusMessage: string | null
  useReAct?: boolean
  directResponse?: string
  tableOutput?: string
  seasonPhase?: string
  scoreboard?: SportsScoreboard
  newsIntent?: boolean
  teamNewsCount?: number
  digestArticles?: Array<{
    position: number
    title: string
    url: string
    source: string
    category: string
  }>
  agentId?: string
  toolCalls?: Array<{ name: string; arguments?: Record<string, unknown> }>
  durationMs?: number
}
