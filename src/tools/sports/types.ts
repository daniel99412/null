export type SportProvider = 'fotmob' | 'espn' | 'sofascore'
export type SportsCapability = 'scoreboard' | 'standings' | 'fixtures' | 'news'
export type EntityType = 'league' | 'team'
export type SportsGameStatus = 'scheduled' | 'in_progress' | 'final'

export interface DateRange {
  from: Date
  to: Date
}

export interface SportsProvider {
  id: SportProvider
  capabilities: Record<SportsCapability, boolean>

  getScoreboard(leagueId: string, range: DateRange): Promise<SportsScoreboard>
  getStandings(leagueId: string): Promise<SportsStandings>
  getFixtures(leagueId: string, range: DateRange): Promise<SportsFixtures>
  getNews(entityId: string, entityType: EntityType): Promise<SportsNewsItem[]>
}

export interface SportsScoreboard {
  league: string
  season?: string
  seasonPhase?: string
  games: SportsGame[]
  effectiveRange: DateRange
}

export interface SportsGame {
  id: string
  date: string
  status: SportsGameStatus
  statusDetail: string
  home: SportsCompetitor
  away: SportsCompetitor
  venue?: string
  phase?: string
}

export interface SportsCompetitor {
  team: string
  abbreviation: string
  score: string
  winner: boolean
}

export interface SportsStandings {
  league: string
  season?: string
  groups: SportsStandingsGroup[]
}

export interface SportsStandingsGroup {
  name: string
  entries: StandingsEntry[]
}

export interface StandingsEntry {
  rank?: number
  team: string
  played: number
  wins: number
  draws: number
  losses: number
  goalsFor: number
  goalsAgainst: number
  points: number
  form?: string
  note?: string
}

export interface SportsFixtures {
  league: string
  games: SportsGame[]
}

export interface SportsNewsItem {
  headline: string
  description?: string
  published: string
  source: string
  url?: string
  categories: string[]
}

export interface SportsQueryResult {
  intent: SportsCapability
  leagueId: string
  teamId?: string
  provider: SportProvider
  scoreboard?: SportsScoreboard
  standings?: SportsStandings
  fixtures?: SportsFixtures
  news?: SportsNewsItem[]
  tableOutput: string
  llmContext: string
  seasonPhase?: string
}

export interface SportsIntentResult {
  intent: SportsCapability
  leagueId: string
  teamId?: string
  entityType: EntityType
  entityId: string
  dateRange: DateRange
}

export interface LeagueRow {
  id: string
  name: string
  country: string | null
  sport: string
}

export interface TeamRow {
  id: string
  name: string
  league_id: string
}

export interface EntityProviderRow {
  entity_type: EntityType
  entity_id: string
  provider: SportProvider
  external_id: string
}
