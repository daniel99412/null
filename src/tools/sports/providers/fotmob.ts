import { getDb } from '../../../memory/database.js'
import type {
  DateRange,
  EntityType,
  SportsFixtures,
  SportsGame,
  SportsNewsItem,
  SportsProvider,
  SportsScoreboard,
  SportsStandings,
} from '../types.js'
import { getSportsCache, setSportsCache, ttlForSportsData } from '../cache.js'

const FOTMOB_BASE = 'https://www.fotmob.com/api'

export const fotmobProvider: SportsProvider = {
  id: 'fotmob',
  capabilities: {
    scoreboard: true,
    standings: true,
    fixtures: true,
    news: true,
  },

  async getScoreboard(leagueId, range) {
    const league = getFotMobLeague(leagueId)
    const cacheKey = `fotmob:scoreboard:${leagueId}:${formatDate(range.from)}:${formatDate(range.to)}`
    const cached = getSportsCache<SportsScoreboard>(cacheKey)
    if (cached) return cached

    const days = eachDay(range)
    const games: SportsGame[] = []
    for (const day of days) {
      const data = await fetchJson(`${FOTMOB_BASE}/matches?date=${formatDate(day)}`)
      games.push(...parseMatches(data, league.external_id))
    }

    const scoreboard = {
      league: league.name,
      games: dedupeGames(games),
      effectiveRange: range,
    }
    setSportsCache(cacheKey, scoreboard, ttlForSportsData(scoreboard.games.some((game) => game.status === 'in_progress') ? 'live' : 'final'))
    return scoreboard
  },

  async getStandings(leagueId) {
    const league = getFotMobLeague(leagueId)
    const cacheKey = `fotmob:standings:${leagueId}`
    const cached = getSportsCache<SportsStandings>(cacheKey)
    if (cached) return cached

    const data = await fetchJson(`${FOTMOB_BASE}/leagues?id=${league.external_id}`)
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
    const league = getFotMobLeague(leagueId)
    const cacheKey = `fotmob:news:${entityType}:${entityId}`
    const cached = getSportsCache<SportsNewsItem[]>(cacheKey)
    if (cached) return cached

    const data = await fetchJson(`${FOTMOB_BASE}/leagues?id=${league.external_id}`)
    const teamName = entityType === 'team' ? getTeamName(entityId) : null
    const news = parseNews(data)
      .filter((item) => !teamName || `${item.headline} ${item.description ?? ''}`.toLowerCase().includes(teamName.toLowerCase()))

    setSportsCache(cacheKey, news, ttlForSportsData('news'))
    return news
  },
}

interface FotMobLeague {
  name: string
  external_id: string
}

function getFotMobLeague(leagueId: string): FotMobLeague {
  const db = getDb()
  const row = db.prepare(`
    SELECT l.name, ep.external_id
    FROM leagues l
    JOIN entity_providers ep ON ep.entity_type = 'league' AND ep.entity_id = l.id
    WHERE l.id = ? AND ep.provider = 'fotmob'
  `).get(leagueId) as FotMobLeague | undefined

  if (!row) throw new Error(`No FotMob mapping for league: ${leagueId}`)
  return row
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
  if (!response.ok) throw new Error(`FotMob request failed: ${response.status}`)
  return response.json() as Promise<unknown>
}

function parseMatches(data: unknown, leagueExternalId: string): SportsGame[] {
  const leagues = asArray(asRecord(data)['leagues'])
  const target = leagues.map(asRecord).find((league) => stringValue(league['id']) === leagueExternalId)
  const matches = asArray(target?.['matches'])

  return matches.map((raw) => {
    const match = asRecord(raw)
    const home = asRecord(match['home'])
    const away = asRecord(match['away'])
    const status = parseStatus(match)
    return {
      id: stringValue(match['id']),
      date: stringValue(match['status'] ? asRecord(match['status'])['utcTime'] : match['time']),
      status: status.status,
      statusDetail: status.detail,
      home: {
        team: stringValue(home['name']),
        abbreviation: stringValue(home['shortName'] ?? home['name']).slice(0, 3).toUpperCase(),
        score: stringValue(home['score']),
        winner: numberValue(home['score']) > numberValue(away['score']),
      },
      away: {
        team: stringValue(away['name']),
        abbreviation: stringValue(away['shortName'] ?? away['name']).slice(0, 3).toUpperCase(),
        score: stringValue(away['score']),
        winner: numberValue(away['score']) > numberValue(home['score']),
      },
      phase: stringValue(match['round']),
    }
  }).filter((game) => game.home.team && game.away.team)
}

function parseStatus(match: Record<string, unknown>): { status: 'scheduled' | 'in_progress' | 'final'; detail: string } {
  const status = asRecord(match['status'])
  const finished = Boolean(status['finished'])
  const started = Boolean(status['started'])
  const reason = asRecord(status['reason'])
  const detail = stringValue(reason['short'] ?? reason['long'] ?? status['scoreStr'])

  if (finished) return { status: 'final', detail: detail || 'FT' }
  if (started) return { status: 'in_progress', detail: detail || 'Live' }
  return { status: 'scheduled', detail: detail || stringValue(status['startTimeStr']) || 'Scheduled' }
}

function parseStandings(data: unknown, leagueName: string): SportsStandings {
  const root = asRecord(data)
  const table = asArray(asRecord(root['table'])['data'])
  const groups = table.length > 0 ? table : asArray(asRecord(root['overview'])['table'])

  return {
    league: leagueName,
    groups: groups.map((raw, index) => {
      const group = asRecord(raw)
      const entries = asArray(group['table'] ?? group['data'] ?? group['entries'])
      return {
        name: stringValue(group['leagueName'] ?? group['name']) || (index === 0 ? 'Tabla general' : `Grupo ${index + 1}`),
        entries: entries.map((entryRaw, rankIndex) => {
          const entry = asRecord(entryRaw)
          return {
            rank: numberValue(entry['idx'] ?? entry['rank'] ?? rankIndex + 1),
            team: stringValue(asRecord(entry['team'])['name'] ?? entry['name']),
            played: numberValue(entry['played']),
            wins: numberValue(entry['wins']),
            draws: numberValue(entry['draws']),
            losses: numberValue(entry['losses']),
            goalsFor: numberValue(entry['scoresFor']),
            goalsAgainst: numberValue(entry['scoresAgainst']),
            points: numberValue(entry['pts'] ?? entry['points']),
            form: asArray(entry['form']).map((item) => stringValue(asRecord(item)['result'])).join('') || undefined,
          }
        }).filter((entry) => entry.team),
      }
    }).filter((group) => group.entries.length > 0),
  }
}

function parseNews(data: unknown): SportsNewsItem[] {
  const root = asRecord(data)
  const newsTab = asRecord(root['newsTab'])
  const news = asArray(newsTab['news'] ?? root['news'])
  return news.map((raw) => {
    const item = asRecord(raw)
    const source = asRecord(item['source'])
    return {
      headline: stringValue(item['title'] ?? item['headline']),
      description: stringValue(item['lead'] ?? item['description']),
      published: stringValue(item['gmtTime'] ?? item['published']),
      source: stringValue(source['name']) || 'FotMob',
      url: stringValue(item['page']?.toString() ?? item['url']) || undefined,
      categories: ['sports'],
    }
  }).filter((item) => item.headline)
}

function eachDay(range: DateRange): Date[] {
  const days: Date[] = []
  const current = new Date(range.from)
  current.setHours(0, 0, 0, 0)
  const end = new Date(range.to)
  end.setHours(0, 0, 0, 0)

  while (current.getTime() <= end.getTime()) {
    days.push(new Date(current))
    current.setDate(current.getDate() + 1)
  }

  return days.slice(0, 14)
}

function dedupeGames(games: SportsGame[]): SportsGame[] {
  const seen = new Set<string>()
  return games.filter((game) => {
    if (seen.has(game.id)) return false
    seen.add(game.id)
    return true
  })
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
