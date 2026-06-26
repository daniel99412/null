import { getDb } from '../../memory/database.js'
import type { UnifiedPlayer, Coach, InjuredPlayer, H2hMatch } from '../../core/sports.types.js'
import { mapPosition } from '../../core/sports.types.js'
import { debugLog } from '../../utils/debug.js'

const FOTMOB_BASE = 'https://www.fotmob.com'

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

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

async function fetchPage(url: string): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': BROWSER_UA,
      Accept: 'text/html,application/xhtml+xml',
    },
  })
  if (!response.ok) throw new Error(`FotMob page request failed: ${response.status}`)
  const html = await response.text()
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/)
  if (!match) throw new Error('No __NEXT_DATA__ found on FotMob page')
  return JSON.parse(match[1]) as Record<string, unknown>
}

function getFotmobLeagueId(espnLeaguePath: string): string | null {
  try {
    const db = getDb()
    const row = db.prepare(`
      SELECT ep2.external_id
      FROM entity_providers ep1
      JOIN leagues l ON l.id = ep1.entity_id
      JOIN entity_providers ep2 ON ep2.entity_type = 'league' AND ep2.entity_id = l.id AND ep2.provider = 'fotmob'
      WHERE ep1.entity_type = 'league'
      AND ep1.provider = 'espn'
      AND l.sport || '/' || ep1.external_id = ?
    `).get(espnLeaguePath) as { external_id: string } | undefined
    return row?.external_id ?? null
  } catch {
    return null
  }
}

function normalizeTeamName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim()
}

function resolveTeamId(name: string): string | null {
  try {
    const db = getDb()
    const normalized = name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .trim()
    const row = db.prepare(`
      SELECT entity_id FROM sports_aliases
      WHERE REPLACE(LOWER(alias), 'ü', 'u') = ? AND entity_type = 'team'
      UNION
      SELECT id FROM teams
      WHERE REPLACE(LOWER(name), 'ü', 'u') = ?
      LIMIT 1
    `).get(normalized, normalized) as { entity_id: string } | undefined
    return row?.entity_id ?? null
  } catch {
    return null
  }
}

function formatDate(dateStr: string): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toISOString().slice(0, 10)
}

// ── League slug mapping ──────────────────────────────────────────────

const LEAGUE_SLUGS: Record<string, string> = {
  '10160': 'liga-mx',
  '10299': 'liga-expansion-mx',
  '10029': 'copa-mx',
  '47': 'premier-league',
  '87': 'laliga',
  '54': 'bundesliga',
  '55': 'serie-a',
  '53': 'ligue-1',
  '42': 'champions-league',
  '44': 'europa-league',
  '73': 'eredivisie',
  '63': 'primeira-liga',
  '130': 'mls',
  '384': 'copa-libertadores',
  '77': 'world-cup',
  '145': 'copa-america',
  '122': 'africa-cup-of-nations',
  '136': 'asian-cup',
  '75': 'concacaf-gold-cup',
}

function getLeagueSlug(fotmobLeagueId: string): string | null {
  return LEAGUE_SLUGS[fotmobLeagueId] ?? null
}

interface FotmobFixture {
  pageUrl: string
  id: string
  home: { name: string }
  away: { name: string }
  status: Record<string, unknown>
}

async function getLeagueFixtures(fotmobLeagueId: string): Promise<FotmobFixture[]> {
  const slug = getLeagueSlug(fotmobLeagueId)
  const urls: string[] = []
  if (slug) urls.push(`${FOTMOB_BASE}/leagues/${fotmobLeagueId}/overview/${slug}`)
  urls.push(`${FOTMOB_BASE}/leagues/${fotmobLeagueId}/overview`)

  for (const url of urls) {
    try {
      const pageData = await fetchPage(url)
      const props = asRecord(asRecord(pageData['props'])['pageProps'])
      const fixtures = asRecord(props['fixtures'])
      const allMatches = asArray(fixtures['allMatches'])
      if (allMatches.length > 0) {
        return allMatches.map((m) => {
          const fixture = asRecord(m)
          return {
            pageUrl: stringValue(fixture['pageUrl']),
            id: stringValue(fixture['id']),
            home: { name: stringValue(asRecord(fixture['home'])['name']) },
            away: { name: stringValue(asRecord(fixture['away'])['name']) },
            status: asRecord(fixture['status']),
          }
        })
      }
    } catch { /* try next URL */ }
  }

  debugLog(`[fotmob] no fixtures for league ${fotmobLeagueId} (slug: ${slug ?? 'none'})`)
  return []
}

export async function findFotmobMatchUrl(
  homeTeam: string,
  awayTeam: string,
  date: string,
  espnLeaguePath: string,
): Promise<string | null> {
  const fotmobLeagueId = getFotmobLeagueId(espnLeaguePath)
  if (!fotmobLeagueId) {
    debugLog(`[fotmob] no league mapping for ${espnLeaguePath}`)
    return null
  }

  const fixtures = await getLeagueFixtures(fotmobLeagueId)
  if (fixtures.length === 0) {
    debugLog(`[fotmob] no fixtures found for league ${fotmobLeagueId}`)
    return null
  }

  const homeNorm = normalizeTeamName(homeTeam)
  const awayNorm = normalizeTeamName(awayTeam)
  const dateStr = formatDate(date)

  const teamsMatch = (a: string, b: string) => {
    if (normalizeTeamName(a) === normalizeTeamName(b)) return true
    const idA = resolveTeamId(a)
    const idB = resolveTeamId(b)
    return !!idA && !!idB && idA === idB
  }

  for (const f of fixtures) {
    const matchOk = (teamsMatch(homeTeam, f.home.name) && teamsMatch(awayTeam, f.away.name)) ||
      (teamsMatch(homeTeam, f.away.name) && teamsMatch(awayTeam, f.home.name))
    if (!matchOk) continue
    if (dateStr) {
      const fTime = stringValue(f.status['utcTime'] ?? f.status['time'] ?? '').slice(0, 10)
      if (fTime && fTime !== dateStr) continue
    }
    const base = f.pageUrl.split('#')[0]
    if (base) return base
    return `/matches/${f.home.name.toLowerCase().replace(/\s+/g, '-')}-vs-${f.away.name.toLowerCase().replace(/\s+/g, '-')}/${f.id}`
  }

  debugLog(`[fotmob] no match found for ${homeTeam} vs ${awayTeam} on ${date}`)
  return null
}

// ── Parse FotMob lineup players ──────────────────────────────────────

function parsePlayers(players: unknown[], isSub = false): UnifiedPlayer[] {
  return players.map((p) => {
    const player = asRecord(p)
    const posId = numberValue(player['positionId'])
    return {
      jersey: stringValue(player['shirtNumber']),
      name: stringValue(player['name']),
      position: mapPosition(posId),
      captain: player['captain'] === true,
      sub: isSub,
    }
  })
}

function parseCoach(coachData: unknown): Coach | undefined {
  const coach = asRecord(coachData)
  const name = stringValue(coach['name'])
  if (!name) return undefined
  return { name }
}

function parseInjuredPlayers(content: Record<string, unknown>): InjuredPlayer[] | undefined {
  const injured = asArray(content['injured'])
  if (injured.length === 0) return undefined
  return injured.map((i) => {
    const item = asRecord(i)
    const player = asRecord(item['player'])
    return {
      name: stringValue(player['name'] ?? item['name']),
      position: stringValue(player['position'] ?? item['position']),
      reason: stringValue(item['reason'] ?? item['injuryType'] ?? item['status']),
      status: stringValue(item['status']),
    }
  })
}

function parseH2H(h2hData: unknown): { matches?: H2hMatch[]; summary?: { homeWins: number; draws: number; awayWins: number } } | undefined {
  const h2h = asRecord(h2hData)
  const rawSummary = asArray(h2h['summary'])
  let summary: { homeWins: number; draws: number; awayWins: number } | undefined
  if (rawSummary.length >= 3) {
    const hw = numberValue(rawSummary[0])
    const d = numberValue(rawSummary[1])
    const aw = numberValue(rawSummary[2])
    if (hw > 0 || d > 0 || aw > 0) {
      summary = { homeWins: hw, draws: d, awayWins: aw }
    }
  }

  const matches = asArray(h2h['matches'])
  const parsed = matches.length > 0
    ? matches.map((m) => {
        const match = asRecord(m)
        const home = asRecord(match['home'])
        const away = asRecord(match['away'])
        const scoreStr = stringValue(asRecord(match['status'])['scoreStr'] ?? '')
        const time = asRecord(match['time'])
        const league = asRecord(match['league'])
        return {
          home: stringValue(home['name']),
          away: stringValue(away['name']),
          score: scoreStr,
          date: stringValue(time['utcTime'] ?? '').slice(0, 10),
          tournament: stringValue(league['name']),
        }
      })
    : undefined

  if (!parsed && !summary) return undefined
  return { matches: parsed, summary }
}

// ── Main FotMob match data fetcher ───────────────────────────────────

export interface FotmobMatchData {
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
}

export async function getFotmobMatchData(pageUrl: string): Promise<FotmobMatchData | null> {
  try {
    const pageData = await fetchPage(`${FOTMOB_BASE}${pageUrl}`)
    const props = asRecord(asRecord(pageData['props'])['pageProps'])
    const content = asRecord(props['content'])
    const lineup = asRecord(content['lineup'] ?? props['lineup'])

    if (!lineup['matchId']) {
      debugLog(`[fotmob] no lineup on match page ${pageUrl}`)
      return null
    }

    const homeTeam = asRecord(lineup['homeTeam'])
    const awayTeam = asRecord(lineup['awayTeam'])

    const homeStarters = asArray(homeTeam['starters'])
    const awayStarters = asArray(awayTeam['starters'])
    const homeSubs = asArray(homeTeam['subs'])
    const awaySubs = asArray(awayTeam['subs'])

    const homePlayers = [...parsePlayers(homeStarters, false), ...parsePlayers(homeSubs, true)]
    const awayPlayers = [...parsePlayers(awayStarters, false), ...parsePlayers(awaySubs, true)]

    debugLog(`[fotmob] lineup: ${homePlayers.length} home, ${awayPlayers.length} away players`)

    const h2hResult = parseH2H(content['h2h'])

    const result: FotmobMatchData = {
      homePlayers,
      awayPlayers,
      homeCoach: parseCoach(homeTeam['coach']),
      awayCoach: parseCoach(awayTeam['coach']),
      homeFormation: stringValue(homeTeam['formation']) || undefined,
      awayFormation: stringValue(awayTeam['formation']) || undefined,
      h2h: h2hResult?.matches,
      h2hSummary: h2hResult?.summary,
      injuredPlayers: parseInjuredPlayers(content),
    }

    return result
  } catch {
    return null
  }
}
