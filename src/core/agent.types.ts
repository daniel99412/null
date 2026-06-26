import type { ChatMessage } from './llm-client.js'
import type { ProviderIds, UnifiedPlayer, Coach, InjuredPlayer, H2hMatch } from './sports.types.js'

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

export interface DigestArticle {
  position: number
  title: string
  url: string
  source: string
  category: string
}

export interface DigestMatch {
  position: number
  homeTeam: string
  awayTeam: string
  homeScore: string
  awayScore: string
  status: string
  statusDetail: string
  date: string
  venue?: string
  eventId: string
  leaguePath: string
  providerIds?: ProviderIds
}

export interface MatchDetailData {
  homeTeam: string
  awayTeam: string
  homeScore: number
  awayScore: number
  status: string
  tournament?: string
  venue?: string
  date: string
  homeColor?: string
  awayColor?: string
  homeAltColor?: string
  awayAltColor?: string
  homeStats: Array<{ label: string; value: string | number }>
  awayStats: Array<{ label: string; value: string | number }>
  events: Array<{
    time: string
    type: 'goal' | 'card' | 'substitution' | 'other'
    team: string
    description: string
    homeScore?: number
    awayScore?: number
    cardType?: 'yellow' | 'red' | 'second_yellow'
    playerName?: string
    subIn?: string
    subOut?: string
  }>
  homePlayers: UnifiedPlayer[]
  awayPlayers: UnifiedPlayer[]
  homeCoach?: Coach
  awayCoach?: Coach
  homeFormation?: string
  awayFormation?: string
  h2h?: H2hMatch[]
  h2hSummary?: { homeWins: number; draws: number; awayWins: number }
  homePredictedPlayers?: UnifiedPlayer[]
  awayPredictedPlayers?: UnifiedPlayer[]
  injuredPlayers?: InjuredPlayer[]
  providerIds?: ProviderIds
}

export interface AgentResponse {
  userContent: string
  searchContext: string | null
  statusMessage: string | null
  useReAct?: boolean
  directResponse?: string
  digestArticles?: DigestArticle[]
  digestMatches?: DigestMatch[]
  agentId?: string
  toolCalls?: Array<{ name: string; arguments?: Record<string, unknown> }>
  durationMs?: number
}
