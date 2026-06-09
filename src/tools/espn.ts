/**
 * ESPN API service — multi-endpoint sports data fetcher.
 *
 * Supports: scoreboard, team news, league news, standings, game summary.
 * All public functions return plain data objects suitable for LLM context.
 * Cache is handled in espn-cache.ts and integrated in buildSportsContext.
 */

import { debugLog } from '../utils/debug.js'
import { getDb } from '../memory/database.js'

import {
  buildCacheKey,
  buildNewsCacheKey,
  buildStandingsCacheKey,
  buildSummaryCacheKey,
  getCachedScoreboard,
  setCachedScoreboard,
  getCachedNews,
  setCachedNews,
  getCachedStandings,
  setCachedStandings,
  getCachedSummary,
  setCachedSummary,
} from '../memory/espn-cache.js'

// ---------------------------------------------------------------------------
// Types — public
// ---------------------------------------------------------------------------

export interface ESPNCompetitor {
  homeAway: 'home' | 'away'
  team: string
  abbreviation: string
  score: string
  winner: boolean
}

export type GameStatus = 'scheduled' | 'in_progress' | 'final'

export interface ESPNGame {
  id: string
  name: string
  date: string          // ISO 8601 UTC
  status: GameStatus
  statusDetail: string  // e.g. "FT", "HT", "2nd Half 34'"
  home: ESPNCompetitor
  away: ESPNCompetitor
  venue?: string
  /** Tournament phase for this specific game (e.g. "Cuartos de Final", "Semifinales") */
  phase?: string
  /** Extra competition note (e.g. "1st Leg", "2nd Leg - Cruz Azul advance 5-3 on aggregate") */
  note?: string
}

export interface ESPNScoreboard {
  league: string
  leagueSlug: string
  season?: string
  /** Current phase/stage of the tournament from league-level season type */
  seasonPhase?: string
  games: ESPNGame[]
  effectiveRange: DateRange
}

export interface ESPNNewsArticle {
  headline: string
  description?: string
  published: string   // ISO 8601
  categories: string[]
  link?: string
}

export interface ESPNStandingsEntry {
  team: string
  abbreviation: string
  wins: number
  losses: number
  ties: number
  points: number
  gamesPlayed: number
  rank?: number
  note?: string       // e.g. "Clinched Playoffs", "Relegated"
}

export interface ESPNStandings {
  league: string
  season?: string
  groups: {
    name: string
    entries: ESPNStandingsEntry[]
  }[]
}

export interface ESPNGameSummary {
  gameId: string
  home: string
  away: string
  homeScore: string
  awayScore: string
  status: string
  keyEvents: { minute: string; text: string }[]
  topScorers: { name: string; team: string; stat: string }[]
}

/**
 * Unified context object returned by buildSportsContext().
 * Contains all fetched data for a query; caller uses it to build
 * the LLM context string and the display table.
 */
export interface ESPNSportsContext {
  /** Human-readable league name */
  league: string
  leagueSlug: string
  /** Scoreboard with games for the relevant period */
  scoreboard?: ESPNScoreboard
  /** League or team news articles */
  news?: ESPNNewsArticle[]
  /** League standings table */
  standings?: ESPNStandings
  /** Detailed summary for specific recent games */
  gameSummaries?: ESPNGameSummary[]
  /** If a specific team was asked about, its name */
  focusTeam?: string
}

export interface DateRange {
  from: Date
  to: Date
}

// ---------------------------------------------------------------------------
// Detection helpers — backed by espn_leagues + espn_teams SQLite tables
// ---------------------------------------------------------------------------

export function detectLeague(query: string): string | null {
  const q = query.toLowerCase()
  const db = getDb()

  // Check espn_leagues first (direct league aliases)
  const leagueRows = db
    .prepare('SELECT alias, league_slug FROM espn_leagues ORDER BY length(alias) DESC')
    .all() as { alias: string; league_slug: string }[]

  for (const row of leagueRows) {
    if (q.includes(row.alias)) {
      debugLog(`[espn] detectLeague: "${row.alias}" → ${row.league_slug}`)
      return row.league_slug
    }
  }

  // Fallback: check espn_teams (infer league from team mention)
  const teamRows = db
    .prepare('SELECT alias, league_slug FROM espn_teams ORDER BY length(alias) DESC')
    .all() as { alias: string; league_slug: string }[]

  for (const row of teamRows) {
    if (q.includes(row.alias)) {
      debugLog(`[espn] detectLeague via team: "${row.alias}" → ${row.league_slug}`)
      return row.league_slug
    }
  }

  debugLog(`[espn] detectLeague: no match for query "${q}"`)
  return null
}

export function detectTeam(query: string): { name: string; id?: string; leagueSlug: string } | null {
  const q = query.toLowerCase()
  const db = getDb()

  const rows = db
    .prepare('SELECT alias, canonical, league_slug, espn_id FROM espn_teams ORDER BY length(alias) DESC')
    .all() as { alias: string; canonical: string; league_slug: string; espn_id: string | null }[]

  for (const row of rows) {
    if (q.includes(row.alias)) {
      debugLog(`[espn] detectTeam: "${row.alias}" → ${row.canonical} in ${row.league_slug} (id: ${row.espn_id ?? 'unknown'})`)
      return {
        name: row.canonical,
        id: row.espn_id ?? undefined,
        leagueSlug: row.league_slug,
      }
    }
  }

  debugLog(`[espn] detectTeam: no team match for query "${q}"`)
  return null
}

export function getSportForLeague(leagueSlug: string): string {
  const db = getDb()
  const row = db
    .prepare('SELECT sport FROM espn_leagues WHERE league_slug = ? LIMIT 1')
    .get(leagueSlug) as { sport: string } | undefined
  return row?.sport ?? 'soccer'
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

export interface ESPNDateIntent {
  type: 'lastMatchday' | 'range'
}

export type DateIntent = 'lastMatchday' | 'range'

function toESPNDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

function currentWeekRange(): DateRange {
  const now = new Date()
  const day = now.getDay()
  const diffToMon = day === 0 ? -6 : 1 - day
  const monday = new Date(now)
  monday.setDate(now.getDate() + diffToMon)
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)
  return { from: monday, to: sunday }
}

function lastWeekRange(): DateRange {
  const { from } = currentWeekRange()
  const monday = new Date(from)
  monday.setDate(from.getDate() - 7)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return { from: monday, to: sunday }
}

function lastWeekendRange(): DateRange {
  const now = new Date()
  const day = now.getDay()
  const daysSinceSun = day === 0 ? 7 : day
  const lastSunday = new Date(now)
  lastSunday.setDate(now.getDate() - daysSinceSun)
  lastSunday.setHours(23, 59, 59, 999)
  const lastFriday = new Date(lastSunday)
  lastFriday.setDate(lastSunday.getDate() - 2)
  lastFriday.setHours(0, 0, 0, 0)
  return { from: lastFriday, to: lastSunday }
}

function nextWeekendRange(): DateRange {
  const now = new Date()
  const day = now.getDay()
  const daysToFri = day <= 5 ? 5 - day : 5 - day + 7
  const friday = new Date(now)
  friday.setDate(now.getDate() + daysToFri)
  friday.setHours(0, 0, 0, 0)
  const sunday = new Date(friday)
  sunday.setDate(friday.getDate() + 2)
  sunday.setHours(23, 59, 59, 999)
  return { from: friday, to: sunday }
}

const EXPLICIT_DATE_PATTERNS = [
  /semana pasada|last week|semana anterior/,
  /fin de semana|weekend/,
  /esta semana|this week|semana actual/,
  /\bhoy\b|\btoday\b/,
  /\bayer\b|\byesterday\b/,
  /últimos|ultimos|recientes|recent|últimas|ultimas/,
  /próximos|proximos|siguientes|upcoming/,
  /jornada\s+\d+/,
  /última jornada|ultima jornada|last matchday|jornada pasada|jornada anterior/,
]

export function detectDateIntent(query: string): DateIntent {
  const q = query.toLowerCase()
  if (/última jornada|ultima jornada|last matchday|jornada pasada|jornada anterior/.test(q)) {
    return 'lastMatchday'
  }
  return 'range'
}

export function hasExplicitDateRange(query: string): boolean {
  const q = query.toLowerCase()
  return EXPLICIT_DATE_PATTERNS.some((p) => p.test(q))
}

export function detectDateRange(query: string): DateRange {
  const q = query.toLowerCase()

  if (/semana pasada|last week|semana anterior/.test(q)) return lastWeekRange()

  if (/fin de semana pasado|last weekend|el fin de semana|fin de semana/.test(q)) {
    if (/próximo|proximo|siguiente|next/.test(q)) return nextWeekendRange()
    return lastWeekendRange()
  }

  if (/esta semana|this week|semana actual|semana corriente/.test(q)) return currentWeekRange()

  if (/\bhoy\b|\btoday\b/.test(q)) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const end = new Date(today)
    end.setHours(23, 59, 59, 999)
    return { from: today, to: end }
  }

  if (/\bayer\b|\byesterday\b/.test(q)) {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    yesterday.setHours(0, 0, 0, 0)
    const end = new Date(yesterday)
    end.setHours(23, 59, 59, 999)
    return { from: yesterday, to: end }
  }

  if (/últimos|ultimos|recientes|recent|últimas|ultimas/.test(q)) {
    const to = new Date()
    const from = new Date()
    from.setDate(to.getDate() - 7)
    from.setHours(0, 0, 0, 0)
    return { from, to }
  }

  if (/próximos|proximos|siguientes|upcoming|next/.test(q)) {
    const from = new Date()
    const to = new Date()
    to.setDate(from.getDate() + 7)
    return { from, to }
  }

  return currentWeekRange()
}

// ---------------------------------------------------------------------------
// Raw API type interfaces (internal)
// ---------------------------------------------------------------------------

interface ESPNScoreboardRaw {
  leagues?: { name?: string; season?: { displayName?: string; type?: { name?: string } } }[]
  events?: ESPNEventRaw[]
}

interface ESPNEventRaw {
  id?: string
  name?: string
  date?: string
  season?: { slug?: string; type?: number }
  competitions?: ESPNCompetitionRaw[]
}

interface ESPNCompetitionRaw {
  status?: { type?: { name?: string; detail?: string } }
  venue?: { fullName?: string }
  competitors?: ESPNCompetitorRaw[]
  notes?: { text?: string }[]
}

interface ESPNCompetitorRaw {
  homeAway?: string
  score?: string
  winner?: boolean
  team?: { displayName?: string; abbreviation?: string }
}

// ---------------------------------------------------------------------------
// Internal parse helpers
// ---------------------------------------------------------------------------

function parseStatus(raw: string | undefined): GameStatus {
  if (!raw) return 'scheduled'
  const r = raw.toUpperCase()
  if (r.includes('FINAL') || r.includes('FULL_TIME') || r.includes('FT')) return 'final'
  if (r.includes('PROGRESS') || r.includes('HALF') || r.includes('LIVE')) return 'in_progress'
  return 'scheduled'
}

function slugToPhaseLabel(slug: string | undefined): string | undefined {
  if (!slug) return undefined
  const s = slug.toLowerCase()
  if (s.includes('final---') || s.endsWith('-final') || s.includes('---final')) return 'Final'
  if (s.includes('semifinal')) return 'Semifinales'
  if (s.includes('quarterfinal') || s.includes('quarter-final')) return 'Cuartos de Final'
  if (s.includes('round-of-16') || s.includes('octavos')) return 'Octavos de Final'
  if (s.includes('8th-seed') || s.includes('repechaje') || s.includes('play-in')) return 'Repechaje'
  if (s.includes('playoff')) return 'Playoffs'
  if (s.includes('regular')) return 'Temporada Regular'
  return undefined
}

function parseCompetitor(raw: ESPNCompetitorRaw): ESPNCompetitor {
  return {
    homeAway: raw.homeAway === 'home' ? 'home' : 'away',
    team: raw.team?.displayName ?? 'Unknown',
    abbreviation: raw.team?.abbreviation ?? '???',
    score: raw.score ?? '-',
    winner: raw.winner ?? false,
  }
}

const ESPN_HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; NullCLI/1.0)' }

async function espnFetch(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: ESPN_HEADERS })
  if (!res.ok) throw new Error(`ESPN API ${res.status}: ${url}`)
  return res.json()
}

// ---------------------------------------------------------------------------
// Scoreboard
// ---------------------------------------------------------------------------

function parseScoreboard(raw: ESPNScoreboardRaw, leagueSlug: string, range: DateRange): ESPNScoreboard {
  const league = raw.leagues?.[0]
  const games: ESPNGame[] = []

  for (const event of raw.events ?? []) {
    const comp = event.competitions?.[0]
    if (!comp) continue
    const competitors = comp.competitors ?? []
    const home = competitors.find((c) => c.homeAway === 'home')
    const away = competitors.find((c) => c.homeAway === 'away')
    if (!home || !away) continue

    games.push({
      id: event.id ?? '',
      name: event.name ?? '',
      date: event.date ?? '',
      status: parseStatus(comp.status?.type?.name),
      statusDetail: comp.status?.type?.detail ?? '',
      home: parseCompetitor(home),
      away: parseCompetitor(away),
      venue: comp.venue?.fullName,
      phase: slugToPhaseLabel(event.season?.slug),
      note: comp.notes?.[0]?.text,
    })
  }

  return {
    league: league?.name ?? leagueSlug,
    leagueSlug,
    season: league?.season?.displayName,
    seasonPhase: league?.season?.type?.name,
    games,
    effectiveRange: range,
  }
}

export async function getScoreboard(leagueSlug: string, range: DateRange): Promise<ESPNScoreboard> {
  const sport = getSportForLeague(leagueSlug)
  const dateParam = `${toESPNDate(range.from)}-${toESPNDate(range.to)}`
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${leagueSlug}/scoreboard?dates=${dateParam}`
  const raw = await espnFetch(url) as ESPNScoreboardRaw
  return parseScoreboard(raw, leagueSlug, range)
}

export async function getLastMatchdayRange(leagueSlug: string): Promise<DateRange> {
  const to = new Date()
  const from = new Date()
  from.setDate(to.getDate() - 21)
  from.setHours(0, 0, 0, 0)

  const sport = getSportForLeague(leagueSlug)
  const dateParam = `${toESPNDate(from)}-${toESPNDate(to)}`
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${leagueSlug}/scoreboard?dates=${dateParam}`

  try {
    const raw = await espnFetch(url) as ESPNScoreboardRaw
    const games = parseScoreboard(raw, leagueSlug, { from, to }).games
    const finals = games.filter((g) => g.status === 'final')
    if (finals.length === 0) return lastWeekendRange()

    const dateMap = new Map<string, Date>()
    for (const g of finals) {
      const d = new Date(g.date)
      const key = d.toISOString().slice(0, 10)
      dateMap.set(key, d)
    }

    const sortedDates = [...dateMap.keys()].sort().reverse()
    if (sortedDates.length === 0) return lastWeekendRange()

    const latestDate = new Date(sortedDates[0] + 'T00:00:00Z')
    const clusterDates = sortedDates.filter((ds) => {
      const diff = (latestDate.getTime() - new Date(ds + 'T00:00:00Z').getTime()) / 86400000
      return diff <= 4
    })

    const clusterFrom = new Date(clusterDates[clusterDates.length - 1] + 'T00:00:00Z')
    clusterFrom.setHours(0, 0, 0, 0)
    const clusterTo = new Date(clusterDates[0] + 'T23:59:59Z')
    clusterTo.setHours(23, 59, 59, 999)

    return { from: clusterFrom, to: clusterTo }
  } catch {
    return lastWeekendRange()
  }
}

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------

interface ESPNNewsRaw {
  articles?: {
    headline?: string
    description?: string
    published?: string
    links?: { web?: { href?: string } }
    categories?: { type?: string; description?: string }[]
  }[]
}

function parseNews(raw: ESPNNewsRaw): ESPNNewsArticle[] {
  return (raw.articles ?? []).map((a) => ({
    headline: a.headline ?? '',
    description: a.description,
    published: a.published ?? '',
    categories: (a.categories ?? [])
      .filter((c) => c.type && ['team', 'league', 'athlete'].includes(c.type))
      .map((c) => c.description ?? '')
      .filter(Boolean),
    link: a.links?.web?.href,
  }))
}

/**
 * Fetch recent news for a league (e.g. Liga MX, EPL).
 */
export async function getLeagueNews(leagueSlug: string, limit = 5): Promise<ESPNNewsArticle[]> {
  const sport = getSportForLeague(leagueSlug)
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${leagueSlug}/news?limit=${limit}`
  const raw = await espnFetch(url) as ESPNNewsRaw
  return parseNews(raw)
}

/**
 * Fetch recent news for a specific team.
 */
export async function getTeamNews(leagueSlug: string, teamId: string, limit = 5): Promise<ESPNNewsArticle[]> {
  const sport = getSportForLeague(leagueSlug)
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${leagueSlug}/teams/${teamId}/news?limit=${limit}`
  const raw = await espnFetch(url) as ESPNNewsRaw
  return parseNews(raw)
}

// ---------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------

interface ESPNStandingsRaw {
  uid?: string
  season?: { year?: number; displayName?: string }
  name?: string
  children?: {
    name?: string
    abbreviation?: string
    standings?: {
      entries?: {
        team?: { id?: string; displayName?: string; abbreviation?: string }
        note?: { description?: string }
        stats?: { name?: string; displayValue?: string; value?: number }[]
      }[]
    }
  }[]
  // flat (no children) — some leagues return entries directly
  standings?: {
    entries?: {
      team?: { displayName?: string; abbreviation?: string }
      note?: { description?: string }
      stats?: { name?: string; displayValue?: string; value?: number }[]
    }[]
  }
}

function parseStandingsEntries(
  entries: NonNullable<NonNullable<ESPNStandingsRaw['children']>[0]['standings']>['entries'],
): ESPNStandingsEntry[] {
  return (entries ?? []).map((e) => {
    const stat = (name: string) => {
      const s = (e.stats ?? []).find((s) => s.name === name)
      return s?.value ?? 0
    }
    return {
      team: e.team?.displayName ?? 'Unknown',
      abbreviation: e.team?.abbreviation ?? '???',
      wins: stat('wins'),
      losses: stat('losses'),
      ties: stat('ties'),
      points: stat('points'),
      gamesPlayed: stat('gamesPlayed'),
      rank: stat('rank') || undefined,
      note: e.note?.description,
    }
  })
}

/**
 * Fetch league standings. Soccer uses /apis/v2/ (site/v2 returns empty).
 */
export async function getStandings(leagueSlug: string): Promise<ESPNStandings> {
  const sport = getSportForLeague(leagueSlug)
  // Soccer standings require /apis/v2/ not /apis/site/v2/
  const isSoccer = sport === 'soccer'
  const baseUrl = isSoccer
    ? `https://site.api.espn.com/apis/v2/sports/${sport}/${leagueSlug}/standings`
    : `https://site.api.espn.com/apis/v2/sports/${sport}/${leagueSlug}/standings`
  const raw = await espnFetch(baseUrl) as ESPNStandingsRaw

  const leagueName = raw.name ?? leagueSlug
  const season = raw.season?.displayName

  // Multi-conference format
  if (raw.children && raw.children.length > 0) {
    const groups = raw.children.map((child) => ({
      name: child.name ?? '',
      entries: parseStandingsEntries(child.standings?.entries),
    }))
    return { league: leagueName, season, groups }
  }

  // Flat format (single group)
  if (raw.standings?.entries) {
    return {
      league: leagueName,
      season,
      groups: [{ name: '', entries: parseStandingsEntries(raw.standings.entries) }],
    }
  }

  return { league: leagueName, season, groups: [] }
}

// ---------------------------------------------------------------------------
// Game summary
// ---------------------------------------------------------------------------

interface ESPNSummaryRaw {
  header?: {
    competitions?: {
      competitors?: { team?: { displayName?: string }; score?: string }[]
      status?: { type?: { description?: string } }
    }[]
  }
  keyEvents?: {
    type?: { text?: string }
    text?: string
    clock?: { displayValue?: string }
  }[]
  leaders?: {
    team?: { displayName?: string }
    leaders?: {
      displayName?: string
      leaders?: { displayValue?: string; athlete?: { displayName?: string } }[]
    }[]
  }[]
}

export async function getGameSummary(leagueSlug: string, gameId: string): Promise<ESPNGameSummary | null> {
  const sport = getSportForLeague(leagueSlug)
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${leagueSlug}/summary?event=${gameId}`
  try {
    const raw = await espnFetch(url) as ESPNSummaryRaw
    const comp = raw.header?.competitions?.[0]
    const competitors = comp?.competitors ?? []
    const home = competitors.find((_, i) => i === 0) // ESPN puts home first in summary
    const away = competitors.find((_, i) => i === 1)

    const keyEvents = (raw.keyEvents ?? []).slice(0, 10).map((e) => ({
      minute: e.clock?.displayValue ?? '',
      text: e.text ?? '',
    }))

    const topScorers: ESPNGameSummary['topScorers'] = []
    for (const teamLeader of raw.leaders ?? []) {
      const teamName = teamLeader.team?.displayName ?? ''
      for (const cat of teamLeader.leaders ?? []) {
        const top = cat.leaders?.[0]
        if (top?.athlete?.displayName) {
          topScorers.push({
            name: top.athlete.displayName,
            team: teamName,
            stat: `${cat.displayName}: ${top.displayValue}`,
          })
        }
      }
    }

    return {
      gameId,
      home: home?.team?.displayName ?? '',
      away: away?.team?.displayName ?? '',
      homeScore: home?.score ?? '-',
      awayScore: away?.score ?? '-',
      status: comp?.status?.type?.description ?? '',
      keyEvents,
      topScorers: topScorers.slice(0, 6),
    }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Sports commentary prompt builder — ordered by date, recent vs prior
// ---------------------------------------------------------------------------

export interface SportsCommentaryContext {
  /** Short system block for the LLM: recent games first, prior context below */
  systemPrompt: string
  /** The user-facing instruction injected as the final user message */
  userInstruction: string
}

/**
 * Build a structured, date-ordered commentary context from scoreboard data.
 * Separates "most recent" games (last 3 days) from "prior context" games.
 * This keeps the model focused on what actually just happened.
 */
export function buildSportsCommentaryPrompt(
  scoreboard: ESPNScoreboard,
  userQuery: string,
  tz: string,
  preferencesContext?: string,
): SportsCommentaryContext {
  const now = new Date()
  const recentCutoff = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000) // 3 days ago

  const finals = scoreboard.games.filter((g) => g.status === 'final')
  const scheduled = scoreboard.games.filter((g) => g.status === 'scheduled')

  // Sort finals by date descending
  const sortedFinals = [...finals].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  )

  const recentFinals = sortedFinals.filter((g) => new Date(g.date) >= recentCutoff)
  const priorFinals = sortedFinals.filter((g) => new Date(g.date) < recentCutoff)

  const fmtGame = (g: ESPNGame): string => {
    const date = new Date(g.date).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz })
    const phase = g.phase ? ` [${g.phase}]` : ''
    const note = g.note ? ` — ${g.note}` : ''
    const winner = g.home.winner ? g.home.team : g.away.winner ? g.away.team : null
    const result = winner
      ? `${g.home.team} ${g.home.score}-${g.away.score} ${g.away.team} (${winner} won)`
      : `${g.home.team} ${g.home.score}-${g.away.score} ${g.away.team}`
    return `• ${result}${phase}${note} — ${date}`
  }

  const fmtScheduled = (g: ESPNGame): string => {
    const date = new Date(g.date)
    const dateStr = date.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz })
    const timeStr = date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: tz })
    const phase = g.phase ? ` [${g.phase}]` : ''
    return `• ${g.home.team} vs ${g.away.team}${phase} — ${dateStr} ${timeStr}`
  }

  const parts: string[] = [
    `League: ${scoreboard.league}${scoreboard.season ? ` — ${scoreboard.season}` : ''}`,
    `Current phase: ${scoreboard.seasonPhase ?? 'unknown'}`,
    '',
  ]

  if (preferencesContext) {
    parts.push(preferencesContext)
    parts.push('')
  }

  if (recentFinals.length > 0) {
    parts.push('=== MOST RECENT RESULTS (last matchday) ===')
    recentFinals.forEach((g) => parts.push(fmtGame(g)))
    parts.push('')
  }

  if (priorFinals.length > 0) {
    parts.push('=== CONTEXT — previous results ===')
    priorFinals.forEach((g) => parts.push(fmtGame(g)))
    parts.push('')
  }

  if (scheduled.length > 0) {
    parts.push('=== UPCOMING MATCHES ===')
    scheduled.forEach((g) => parts.push(fmtScheduled(g)))
    parts.push('')
  }

  const hasRecent = recentFinals.length > 0
  const hasNext = scheduled.length > 0

  const userInstruction = `User question: "${userQuery}"

Write 2-4 lines of sports commentary in English.

RULES — follow strictly:
1. Focus on the MOST RECENT RESULTS (section above)
2. You may briefly mention prior context (who advanced from quarterfinals, etc.)
3. If there are upcoming matches, mention the next one
4. Do NOT invent anything not in the data above
5. Do NOT mention champions, relegations, or titles unless explicitly shown
6. Do NOT repeat exact scores (they're already in the table)
7. Tone: casual sports analyst, direct
${!hasRecent ? '8. No recent results — describe only upcoming matches or say "Matchday in progress."' : ''}
${!hasNext && !hasRecent ? '8. Not enough data → respond only: "No information available for this matchday."' : ''}`

  return {
    systemPrompt: parts.join('\n'),
    userInstruction,
  }
}


/**
 * Format games as a Markdown table grouped by phase.
 * Notes are intentionally NOT shown in cells — they are passed to LLM via context only.
 */
export function formatScoreboardTable(games: ESPNGame[], localTZ?: string): string {
  if (games.length === 0) return ''

  const groups: Map<string, ESPNGame[]> = new Map()
  for (const game of games) {
    const key = game.phase ?? ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(game)
  }

  const buildRow = (game: ESPNGame): string => {
    const home = game.home.team
    const away = game.away.team
    let center: string

    if (game.status === 'final') {
      center = `**${game.home.score} - ${game.away.score}**`
    } else if (game.status === 'in_progress') {
      const minute = game.statusDetail.match(/\d+'/)?.[0] ?? game.statusDetail
      center = `${game.home.score}-${game.away.score} ${minute}`.trim()
    } else {
      const date = new Date(game.date)
      const month = date.toLocaleDateString('es-MX', { month: 'numeric', day: 'numeric', timeZone: localTZ })
      const time = date.toLocaleTimeString('es-MX', {
        hour: '2-digit', minute: '2-digit', hour12: true, timeZone: localTZ,
      })
      center = `${month} ${time}`
    }

    return `| ${home} | ${center} | ${away} |`
  }

  const parts: string[] = []

  for (const [phase, phaseGames] of groups) {
    if (phase && groups.size > 1) {
      parts.push(`**${phase}**`)
      parts.push('')
    }
    parts.push('| Local | Marcador | Visita |')
    parts.push('|-------|----------|--------|')
    for (const game of phaseGames) {
      parts.push(buildRow(game))
    }
    parts.push('')
  }

  while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop()
  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Context formatters — for LLM injection (includes notes, phase, standings, news)
// ---------------------------------------------------------------------------

export function formatScoreboardContext(scoreboard: ESPNScoreboard, range: DateRange): string {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const fromStr = range.from.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz })
  const toStr = range.to.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz })

  const finals = scoreboard.games.filter((g) => g.status === 'final')
  const live = scoreboard.games.filter((g) => g.status === 'in_progress')
  const scheduled = scoreboard.games.filter((g) => g.status === 'scheduled')

  const lines: string[] = [
    `=== ${scoreboard.league}${scoreboard.season ? ` — ${scoreboard.season}` : ''} ===`,
    `Periodo: ${fromStr} al ${toStr}`,
    scoreboard.seasonPhase ? `Fase actual del torneo: ${scoreboard.seasonPhase}` : '',
    `Total de partidos: ${scoreboard.games.length}`,
    '',
  ].filter(Boolean)

  const formatGameLine = (game: ESPNGame): string => {
    const date = new Date(game.date)
    const localDate = date.toLocaleDateString('es-MX', { weekday: 'short', month: 'short', day: 'numeric', timeZone: tz })
    const phaseNote = [game.phase, game.note].filter(Boolean).join(' — ')
    const bracket = phaseNote ? ` [${phaseNote}]` : ''

    if (game.status === 'final') {
      const homeDisplay = game.home.winner ? `**${game.home.team}**` : game.home.team
      const awayDisplay = game.away.winner ? `**${game.away.team}**` : game.away.team
      return `• ${homeDisplay} ${game.home.score} - ${game.away.score} ${awayDisplay} (Final)${bracket} — ${localDate}`
    }
    if (game.status === 'in_progress') {
      return `• ${game.home.team} ${game.home.score} - ${game.away.score} ${game.away.team} [${game.statusDetail}]${bracket} — EN VIVO`
    }
    const localTime = date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: tz })
    return `• ${game.home.team} vs ${game.away.team}${bracket} — ${localDate} ${localTime}`
  }

  if (live.length > 0) {
    lines.push('EN VIVO:')
    live.forEach((g) => lines.push(formatGameLine(g)))
    lines.push('')
  }
  if (finals.length > 0) {
    lines.push('Resultados:')
    finals.forEach((g) => lines.push(formatGameLine(g)))
    lines.push('')
  }
  if (scheduled.length > 0) {
    lines.push('Proximos partidos:')
    scheduled.forEach((g) => lines.push(formatGameLine(g)))
    lines.push('')
  }
  if (scoreboard.games.length === 0) {
    lines.push('No se encontraron partidos para este periodo.')
  }

  return lines.join('\n')
}

function formatNewsContext(articles: ESPNNewsArticle[], label: string): string {
  if (articles.length === 0) return ''
  const lines = [`Noticias — ${label}:`]
  for (const a of articles) {
    const date = a.published ? new Date(a.published).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }) : ''
    lines.push(`• ${a.headline}${date ? ` (${date})` : ''}`)
    if (a.description) lines.push(`  ${a.description.slice(0, 120)}`)
  }
  return lines.join('\n')
}

function formatStandingsContext(standings: ESPNStandings): string {
  if (standings.groups.length === 0) return ''
  const lines = [`Tabla de posiciones — ${standings.league}${standings.season ? ` (${standings.season})` : ''}:`]
  for (const group of standings.groups) {
    if (group.name) lines.push(`  ${group.name}:`)
    // top 10 only to keep context lean
    const top = group.entries.slice(0, 10)
    for (const e of top) {
      const pos = e.rank ? `${e.rank}.` : ''
      const record = `${e.wins}G-${e.losses}P-${e.ties}E`
      const pts = e.points ? ` | ${e.points}pts` : ''
      const note = e.note ? ` (${e.note})` : ''
      lines.push(`  ${pos} ${e.team} (${record}${pts})${note}`)
    }
  }
  return lines.join('\n')
}

function formatSummaryContext(summary: ESPNGameSummary): string {
  const lines = [`Resumen — ${summary.home} ${summary.homeScore} - ${summary.awayScore} ${summary.away} (${summary.status}):`]
  if (summary.keyEvents.length > 0) {
    lines.push('  Eventos clave:')
    summary.keyEvents.slice(0, 6).forEach((e) => lines.push(`  • ${e.minute ? e.minute + ' ' : ''}${e.text}`))
  }
  if (summary.topScorers.length > 0) {
    lines.push('  Líderes:')
    summary.topScorers.forEach((s) => lines.push(`  • ${s.name} (${s.team}): ${s.stat}`))
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Main orchestrator — buildSportsContext
// ---------------------------------------------------------------------------

/**
 * Build a complete sports context for the LLM based on the query.
 *
 * Strategy:
 * - If a specific team is mentioned → fetch scoreboard + team news + standings (parallel)
 *   and optionally game summaries for recent finals
 * - If only a league is mentioned → fetch scoreboard + league news + standings (parallel)
 *
 * Returns both:
 *   - `llmContext`: full text block for the LLM system prompt
 *   - `tableOutput`: pre-rendered Markdown table for immediate TUI display
 *   - `seasonPhase`: phase name for the commentary prompt
 */
export interface SportsQueryOutput {
  llmContext: string
  tableOutput: string
  seasonPhase?: string
  /** Raw scoreboard — passed through to TUI for structured commentary prompt */
  scoreboard?: ESPNScoreboard
  /** True when the query is primarily about news/headlines — TUI skips scoreboard commentary */
  newsIntent?: boolean
  /** Number of news articles found specifically about the focus team (0 = weak ESPN context) */
  teamNewsCount?: number
  /** Focus team name, if one was detected */
  focusTeamName?: string
}

/**
 * Returns true when the query is primarily asking for team/league news
 * (headlines, transfers, injuries) rather than scores or standings.
 */
export function detectNewsIntent(query: string): boolean {
  const q = query.toLowerCase()
  return /noticias?|news|novedades?|transfer(encias?)?|fichajes?|lesion(es)?|lesionado|injured/.test(q)
}

export async function buildSportsContext(query: string): Promise<SportsQueryOutput | null> {
  const leagueSlug = detectLeague(query)
  if (!leagueSlug) {
    debugLog(`[espn] buildSportsContext: no league detected — returning null`)
    return null
  }

  const focusTeam = detectTeam(query)
  const intent = detectDateIntent(query)
  const hasExplicit = hasExplicitDateRange(query)
  const newsIntent = detectNewsIntent(query)
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone

  debugLog(`[espn] buildSportsContext: league=${leagueSlug} team=${focusTeam?.name ?? 'none'} intent=${intent} hasExplicit=${hasExplicit} newsIntent=${newsIntent}`)

  // --- Resolve scoreboard date range ---
  let scoreboardRange: DateRange
  if (intent === 'lastMatchday' || !hasExplicit) {
    scoreboardRange = await getLastMatchdayRange(leagueSlug)
  } else {
    scoreboardRange = detectDateRange(query)
  }

  // --- Cached scoreboard fetch ---
  const scoreboardKey = buildCacheKey(leagueSlug, scoreboardRange.from, scoreboardRange.to)
  let scoreboard: ESPNScoreboard | undefined = getCachedScoreboard(scoreboardKey) ?? undefined
  if (!scoreboard) {
    try {
      debugLog(`[espn] fetching scoreboard: ${leagueSlug} ${scoreboardRange.from.toISOString().slice(0,10)} – ${scoreboardRange.to.toISOString().slice(0,10)}`)
      scoreboard = await getScoreboard(leagueSlug, scoreboardRange)
      debugLog(`[espn] scoreboard: ${scoreboard.games.length} games`)
      setCachedScoreboard(scoreboardKey, scoreboard)
    } catch (err) {
      debugLog(`[espn] scoreboard fetch failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  } else {
    debugLog(`[espn] scoreboard cache hit`)
  }

  // --- Cached news fetch ---
  const newsKey = buildNewsCacheKey(leagueSlug, focusTeam?.id)
  let news: ESPNNewsArticle[] | undefined = getCachedNews(newsKey) ?? undefined
  // Tracks how many articles specifically matched the focus team (0 = weak context)
  let teamNewsCount = 0
  if (!news) {
    try {
      if (focusTeam?.id) {
        debugLog(`[espn] fetching team news: ${focusTeam.id}`)
        const teamNews = await getTeamNews(leagueSlug, focusTeam.id, 5)
        if (teamNews.length > 0) {
          news = teamNews
          teamNewsCount = teamNews.length
        } else {
          // Team news endpoint returned empty (common for Liga MX) — fall back to
          // league news and filter articles that mention the team by name
          debugLog(`[espn] team news empty — falling back to league news filtered by team`)
          const leagueNews = await getLeagueNews(leagueSlug, 20)
          const teamNameLower = focusTeam.name.toLowerCase()
          const filtered = leagueNews.filter((a) =>
            a.headline.toLowerCase().includes(teamNameLower) ||
            (a.description ?? '').toLowerCase().includes(teamNameLower) ||
            a.categories.some((c) => c.toLowerCase().includes(teamNameLower))
          )
          teamNewsCount = filtered.length
          news = filtered.length > 0 ? filtered.slice(0, 5) : leagueNews.slice(0, 5)
          debugLog(`[espn] filtered league news: ${filtered.length} matching (teamNewsCount=${teamNewsCount})`)
        }
      } else {
        debugLog(`[espn] fetching league news: ${leagueSlug}`)
        news = await getLeagueNews(leagueSlug, 5)
        teamNewsCount = news.length
      }
      debugLog(`[espn] news: ${news.length} articles`)
      setCachedNews(newsKey, news)
    } catch (err) {
      debugLog(`[espn] news fetch failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  } else {
    debugLog(`[espn] news cache hit`)
    // Recompute teamNewsCount from cache when focusTeam present
    if (focusTeam) {
      const t = focusTeam.name.toLowerCase()
      teamNewsCount = news.filter((a) =>
        a.headline.toLowerCase().includes(t) ||
        (a.description ?? '').toLowerCase().includes(t)
      ).length
    } else {
      teamNewsCount = news.length
    }
  }

  // --- Cached standings fetch ---
  const standingsKey = buildStandingsCacheKey(leagueSlug)
  let standings: ESPNStandings | undefined = getCachedStandings(standingsKey) ?? undefined
  if (!standings) {
    try {
      debugLog(`[espn] fetching standings: ${leagueSlug}`)
      standings = await getStandings(leagueSlug)
      debugLog(`[espn] standings: ${standings.groups.length} groups`)
      setCachedStandings(standingsKey, standings)
    } catch (err) {
      debugLog(`[espn] standings fetch failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  } else {
    debugLog(`[espn] standings cache hit`)
  }

  // --- Optionally fetch game summaries for recent finals (max 2, only if team focused) ---
  let summaries: ESPNGameSummary[] = []
  if (focusTeam && scoreboard) {
    const teamName = focusTeam.name.toLowerCase()
    const recentFinals = scoreboard.games
      .filter((g) =>
        g.status === 'final' &&
        (g.home.team.toLowerCase().includes(teamName) || g.away.team.toLowerCase().includes(teamName))
      )
      .slice(0, 2)

    if (recentFinals.length > 0) {
      const summaryResults = await Promise.allSettled(
        recentFinals.map(async (g) => {
          const summaryKey = buildSummaryCacheKey(leagueSlug, g.id)
          const cached = getCachedSummary(summaryKey)
          if (cached) return cached
          const fetched = await getGameSummary(leagueSlug, g.id)
          if (fetched) setCachedSummary(summaryKey, fetched)
          return fetched
        })
      )
      summaries = summaryResults
        .filter((r): r is PromiseFulfilledResult<ESPNGameSummary> =>
          r.status === 'fulfilled' && r.value !== null
        )
        .map((r) => r.value)
    }
  }

  // --- Build table output (display) ---
  const tableParts: string[] = []
  if (scoreboard) {
    const headerLine = `**${scoreboard.league}${scoreboard.season ? ` — ${scoreboard.season}` : ''}**`
    const fromStr = scoreboard.effectiveRange.from.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', timeZone: tz })
    const toStr = scoreboard.effectiveRange.to.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', timeZone: tz })
    tableParts.push(headerLine)
    tableParts.push(`_${fromStr} – ${toStr}_`)
    if (scoreboard.seasonPhase) tableParts.push(`_${scoreboard.seasonPhase}_`)
    tableParts.push('')

    // When news intent with a focus team, only show that team's games in the table
    const teamFilterFn = (focusTeam && newsIntent)
      ? (g: ESPNGame) => {
          const t = focusTeam.name.toLowerCase()
          return g.home.team.toLowerCase().includes(t) || g.away.team.toLowerCase().includes(t)
        }
      : (_g: ESPNGame) => true

    const live = scoreboard.games.filter((g) => g.status === 'in_progress' && teamFilterFn(g))
    const finals = scoreboard.games.filter((g) => g.status === 'final' && teamFilterFn(g))
    const scheduled = scoreboard.games.filter((g) => g.status === 'scheduled' && teamFilterFn(g))

    if (live.length > 0) { tableParts.push('EN VIVO'); tableParts.push(formatScoreboardTable(live, tz)); tableParts.push('') }
    if (finals.length > 0) { tableParts.push('Resultados'); tableParts.push(formatScoreboardTable(finals, tz)); tableParts.push('') }
    if (scheduled.length > 0) { tableParts.push('Proximos'); tableParts.push(formatScoreboardTable(scheduled, tz)); tableParts.push('') }
    if (live.length === 0 && finals.length === 0 && scheduled.length === 0) tableParts.push('No se encontraron partidos para este periodo.')
  }
  while (tableParts.length > 0 && tableParts[tableParts.length - 1] === '') tableParts.pop()

  // When news intent, append news headlines to the visual table output
  if (newsIntent && news && news.length > 0) {
    const teamLabel = focusTeam ? focusTeam.name : (scoreboard?.league ?? leagueSlug)
    tableParts.push('')
    tableParts.push(`**Noticias — ${teamLabel}**`)
    tableParts.push('')
    for (const a of news) {
      const date = a.published
        ? new Date(a.published).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
        : ''
      tableParts.push(`- ${a.headline}${date ? ` _(${date})_` : ''}`)
      if (a.description) tableParts.push(`  ${a.description.slice(0, 120)}`)
    }
  }

  // --- Build LLM context (includes notes, standings, news, summaries) ---
  const contextParts: string[] = []

  // When news intent, put news first so LLM focuses on it
  if (newsIntent && news && news.length > 0) {
    const label = focusTeam
      ? `${focusTeam.name}`
      : `${scoreboard?.league ?? leagueSlug}`
    contextParts.push(formatNewsContext(news, label))
    contextParts.push('')
  }

  if (scoreboard) {
    // For news intent with focus team, only include that team's game lines in context
    if (focusTeam && newsIntent) {
      const teamName = focusTeam.name.toLowerCase()
      const filtered: ESPNScoreboard = {
        ...scoreboard,
        games: scoreboard.games.filter(
          (g) => g.home.team.toLowerCase().includes(teamName) || g.away.team.toLowerCase().includes(teamName)
        ),
      }
      contextParts.push(formatScoreboardContext(filtered, filtered.effectiveRange))
    } else {
      contextParts.push(formatScoreboardContext(scoreboard, scoreboard.effectiveRange))
    }
  }

  if (standings) {
    contextParts.push('')
    contextParts.push(formatStandingsContext(standings))
  }

  for (const summary of summaries) {
    contextParts.push('')
    contextParts.push(formatSummaryContext(summary))
  }

  // Non-news intent: append news at the end
  if (!newsIntent && news && news.length > 0) {
    const label = focusTeam
      ? `Noticias recientes — ${focusTeam.name}`
      : `Noticias recientes — ${scoreboard?.league ?? leagueSlug}`
    contextParts.push('')
    contextParts.push(formatNewsContext(news, label))
  }

  contextParts.push('')
  contextParts.push('INSTRUCCIONES: Usa estos datos para responder la pregunta del usuario. Menciona marcadores específicos, fases del torneo, posiciones en la tabla y noticias relevantes. NO repitas datos que ya están en la tabla visual. Responde en el idioma en que el usuario escribió.')

  return {
    llmContext: contextParts.join('\n'),
    tableOutput: tableParts.join('\n'),
    seasonPhase: scoreboard?.seasonPhase,
    scoreboard,
    newsIntent,
    teamNewsCount,
    focusTeamName: focusTeam?.name,
  }
}
