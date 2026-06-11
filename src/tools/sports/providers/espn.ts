import { getDb } from '../../../memory/database.js'
import type {
  DateRange,
  EntityProviderRow,
  EntityType,
  SportsFixtures,
  SportsGame,
  SportsGameStatus,
  SportsNewsItem,
  SportsProvider,
  SportsScoreboard,
  SportsStandings,
} from '../types.js'
import { getSportsCache, setSportsCache, ttlForSportsData } from '../cache.js'

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports'
const ESPN_CORE_BASE = 'https://site.web.api.espn.com/apis/v2/sports'

export const espnProvider: SportsProvider = {
  id: 'espn',
  capabilities: {
    scoreboard: true,
    standings: true,
    fixtures: true,
    news: true,
  },

  async getScoreboard(leagueId, range) {
    const league = getLeagueProvider(leagueId)
    const cacheKey = `espn:scoreboard:${leagueId}:${formatDate(range.from)}:${formatDate(range.to)}`
    const cached = getSportsCache<SportsScoreboard>(cacheKey)
    if (cached) return cached

    const url = `${ESPN_BASE}/${league.sport}/${league.external_id}/scoreboard?dates=${formatDate(range.from)}-${formatDate(range.to)}`
    const data = await fetchJson(url)
    const scoreboard = parseScoreboard(data, league.name, range)
    setSportsCache(cacheKey, scoreboard, ttlForSportsData(scoreboard.games.some((game) => game.status === 'in_progress') ? 'live' : 'final'))
    return scoreboard
  },

  async getStandings(leagueId) {
    const league = getLeagueProvider(leagueId)
    const cacheKey = `espn:standings:${leagueId}`
    const cached = getSportsCache<SportsStandings>(cacheKey)
    if (cached) return cached

    const url = `${ESPN_CORE_BASE}/${league.sport}/${league.external_id}/standings`
    const data = await fetchJson(url)
    const standings = parseStandings(data, league.name)
    setSportsCache(cacheKey, standings, ttlForSportsData('standings'))
    return standings
  },

  async getFixtures(leagueId, range) {
    const scoreboard = await this.getScoreboard(leagueId, range)
    return {
      league: scoreboard.league,
      games: scoreboard.games.filter((game) => game.status === 'scheduled'),
    }
  },

  async getNews(entityId, entityType) {
    const leagueId = entityType === 'team' ? getTeamLeagueId(entityId) : entityId
    const league = getLeagueProvider(leagueId)
    const teamExternalId = entityType === 'team'
      ? getEntityProvider('team', entityId, 'espn')?.external_id
      : null
    const cacheKey = `espn:news:${entityType}:${entityId}`
    const cached = getSportsCache<SportsNewsItem[]>(cacheKey)
    if (cached) return cached

    const endpoint = teamExternalId
      ? `${ESPN_BASE}/${league.sport}/${league.external_id}/teams/${teamExternalId}/news?limit=10`
      : `${ESPN_BASE}/${league.sport}/${league.external_id}/news?limit=10`
    const data = await fetchJson(endpoint)
    let news = parseNews(data)

    if (news.length === 0 && entityType === 'team') {
      const fallback = await fetchJson(`${ESPN_BASE}/${league.sport}/${league.external_id}/news?limit=20`)
      const team = getTeamName(entityId)
      news = parseNews(fallback).filter((item) => mentionsTeam(item, team))
    }

    setSportsCache(cacheKey, news, ttlForSportsData('news'))
    return news
  },
}

interface LeagueProvider {
  name: string
  sport: string
  external_id: string
}

function getLeagueProvider(leagueId: string): LeagueProvider {
  const db = getDb()
  const row = db.prepare(`
    SELECT l.name, l.sport, ep.external_id
    FROM leagues l
    JOIN entity_providers ep ON ep.entity_type = 'league' AND ep.entity_id = l.id
    WHERE l.id = ? AND ep.provider = 'espn'
  `).get(leagueId) as LeagueProvider | undefined

  if (!row) throw new Error(`No ESPN mapping for league: ${leagueId}`)
  return row
}

function getEntityProvider(entityType: EntityType, entityId: string, provider: string): EntityProviderRow | null {
  const db = getDb()
  const row = db.prepare(`
    SELECT entity_type, entity_id, provider, external_id
    FROM entity_providers
    WHERE entity_type = ? AND entity_id = ? AND provider = ?
  `).get(entityType, entityId, provider) as EntityProviderRow | undefined
  return row ?? null
}

function getTeamLeagueId(teamId: string): string {
  const db = getDb()
  const row = db.prepare('SELECT league_id FROM teams WHERE id = ?').get(teamId) as { league_id: string } | undefined
  return row?.league_id ?? 'liga_mx'
}

function getTeamName(teamId: string): string {
  const db = getDb()
  const row = db.prepare('SELECT name FROM teams WHERE id = ?').get(teamId) as { name: string } | undefined
  return row?.name ?? teamId
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'Null CLI sports agent',
    },
  })
  if (!response.ok) throw new Error(`ESPN request failed: ${response.status}`)
  return response.json() as Promise<unknown>
}

function parseScoreboard(data: unknown, leagueName: string, range: DateRange): SportsScoreboard {
  const root = asRecord(data)
  const events = asArray(root['events'])
  const games = events.map(parseEvent).filter((game): game is SportsGame => Boolean(game))

  return {
    league: leagueName,
    games,
    effectiveRange: range,
  }
}

function parseEvent(event: unknown): SportsGame | null {
  const item = asRecord(event)
  const competitions = asArray(item['competitions'])
  const competition = asRecord(competitions[0])
  const competitors = asArray(competition['competitors'])
  const home = competitors.find((c) => asRecord(c)['homeAway'] === 'home')
  const away = competitors.find((c) => asRecord(c)['homeAway'] === 'away')
  if (!home || !away) return null

  const status = asRecord(competition['status'] ?? item['status'])
  const type = asRecord(status['type'])
  const completed = Boolean(type['completed'])
  const state = stringValue(type['state']).toLowerCase()

  return {
    id: stringValue(item['id'] ?? competition['id']),
    date: stringValue(item['date'] ?? competition['date']),
    status: completed ? 'final' : state === 'in' ? 'in_progress' : 'scheduled',
    statusDetail: stringValue(type['shortDetail'] ?? type['detail'] ?? type['description']),
    home: parseCompetitor(home),
    away: parseCompetitor(away),
    venue: stringValue(asRecord(competition['venue'])['fullName']) || undefined,
    phase: stringValue(asRecord(item['season'])['slug']) || undefined,
  }
}

function parseCompetitor(raw: unknown) {
  const competitor = asRecord(raw)
  const team = asRecord(competitor['team'])
  return {
    team: stringValue(team['displayName'] ?? team['name']),
    abbreviation: stringValue(team['abbreviation'] ?? team['shortDisplayName']),
    score: stringValue(competitor['score']),
    winner: Boolean(competitor['winner']),
  }
}

function parseStandings(data: unknown, leagueName: string): SportsStandings {
  const root = asRecord(data)
  const children = asArray(asRecord(root['standings'])['children'])
  const groups = children.length > 0 ? children : [root['standings'] ?? root]

  return {
    league: leagueName,
    groups: groups.map((group, index) => {
      const groupRecord = asRecord(group)
      const entries = asArray(asRecord(groupRecord['standings'] ?? groupRecord)['entries'])
      return {
        name: stringValue(groupRecord['name'] ?? groupRecord['displayName']) || (index === 0 ? 'Tabla general' : `Grupo ${index + 1}`),
        entries: entries.map(parseStandingEntry),
      }
    }).filter((group) => group.entries.length > 0),
  }
}

function parseStandingEntry(raw: unknown) {
  const entry = asRecord(raw)
  const team = asRecord(entry['team'])
  const stats = asArray(entry['stats'])
  const stat = (names: string[]): number => {
    const row = stats.map(asRecord).find((item) => names.includes(stringValue(item['name'])))
    return numberValue(row?.['value'] ?? row?.['displayValue'])
  }

  return {
    rank: stat(['rank']),
    team: stringValue(team['displayName'] ?? team['name']),
    played: stat(['gamesPlayed', 'played']),
    wins: stat(['wins']),
    draws: stat(['ties', 'draws']),
    losses: stat(['losses']),
    goalsFor: stat(['pointsFor', 'goalsFor']),
    goalsAgainst: stat(['pointsAgainst', 'goalsAgainst']),
    points: stat(['points']),
    form: stringValue(stats.map(asRecord).find((item) => stringValue(item['name']) === 'form')?.['displayValue']) || undefined,
  }
}

function parseNews(data: unknown): SportsNewsItem[] {
  const root = asRecord(data)
  return asArray(root['articles']).map((raw) => {
    const article = asRecord(raw)
    const links = asRecord(article['links'])
    const web = asRecord(links['web'])
    return {
      headline: stringValue(article['headline']),
      description: stringValue(article['description']),
      published: stringValue(article['published'] ?? article['lastModified']),
      source: 'ESPN',
      url: stringValue(web['href']) || undefined,
      categories: asArray(article['categories']).map((category) => stringValue(asRecord(category)['description'] ?? asRecord(category)['type'])).filter(Boolean),
    }
  }).filter((item) => item.headline.length > 0)
}

function mentionsTeam(item: SportsNewsItem, team: string): boolean {
  const haystack = `${item.headline} ${item.description ?? ''}`.toLowerCase()
  return haystack.includes(team.toLowerCase())
}

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '')
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
}

function numberValue(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}
