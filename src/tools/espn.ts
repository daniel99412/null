/**
 * ESPN internal API client for sports scores and schedules.
 * No API key required — uses ESPN's public internal endpoints.
 */

// ---------------------------------------------------------------------------
// Types
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
  statusDetail: string  // e.g. "FT", "HT", "2nd Half 34'", "Sat, April 19 at 9:00 PM EDT"
  home: ESPNCompetitor
  away: ESPNCompetitor
  venue?: string
}

export interface ESPNScoreboard {
  league: string
  leagueSlug: string
  season?: string
  games: ESPNGame[]
}

// ---------------------------------------------------------------------------
// League map: natural language → ESPN slug
// ---------------------------------------------------------------------------

const LEAGUE_MAP: Record<string, string> = {
  // Liga MX
  'liga mx': 'mex.1',
  'ligamx': 'mex.1',
  'liga mexicana': 'mex.1',
  'primera división de mexico': 'mex.1',
  'primera division de mexico': 'mex.1',
  'mexico': 'mex.1',

  // MLS
  'mls': 'usa.1',
  'major league soccer': 'usa.1',
  'liga americana': 'usa.1',

  // Premier League
  'premier league': 'eng.1',
  'premier': 'eng.1',
  'epl': 'eng.1',
  'liga inglesa': 'eng.1',
  'england': 'eng.1',
  'inglaterra': 'eng.1',

  // La Liga
  'la liga': 'esp.1',
  'laliga': 'esp.1',
  'liga española': 'esp.1',
  'liga espanola': 'esp.1',
  'españa': 'esp.1',
  'spain': 'esp.1',

  // Serie A
  'serie a': 'ita.1',
  'liga italiana': 'ita.1',
  'italia': 'ita.1',
  'italy': 'ita.1',

  // Bundesliga
  'bundesliga': 'ger.1',
  'liga alemana': 'ger.1',
  'alemania': 'ger.1',
  'germany': 'ger.1',

  // Ligue 1
  'ligue 1': 'fra.1',
  'ligue1': 'fra.1',
  'liga francesa': 'fra.1',
  'francia': 'fra.1',
  'france': 'fra.1',

  // Champions League
  'champions league': 'uefa.champions',
  'champions': 'uefa.champions',
  'ucl': 'uefa.champions',
  'liga de campeones': 'uefa.champions',
  'champions league europea': 'uefa.champions',
}

// Teams that implicitly map to a league (for "resultados del america")
const TEAM_LEAGUE_MAP: Record<string, string> = {
  // Liga MX teams
  'america': 'mex.1', 'águilas': 'mex.1', 'aguilas': 'mex.1',
  'chivas': 'mex.1', 'guadalajara': 'mex.1', 'rebaño': 'mex.1', 'rebano': 'mex.1',
  'cruz azul': 'mex.1', 'la maquina': 'mex.1', 'la máquina': 'mex.1',
  'pumas': 'mex.1', 'pumas unam': 'mex.1',
  'tigres': 'mex.1', 'tigres uanl': 'mex.1',
  'monterrey': 'mex.1', 'rayados': 'mex.1',
  'atlas': 'mex.1', 'zorros': 'mex.1',
  'toluca': 'mex.1', 'diablos rojos': 'mex.1',
  'pachuca': 'mex.1', 'tuzos': 'mex.1',
  'santos': 'mex.1', 'santos laguna': 'mex.1', 'guerreros': 'mex.1',
  'leon': 'mex.1', 'león': 'mex.1', 'esmeralda': 'mex.1',
  'necaxa': 'mex.1', 'rayos': 'mex.1',
  'puebla': 'mex.1', 'camoteros': 'mex.1',
  'queretaro': 'mex.1', 'querétaro': 'mex.1', 'gallos': 'mex.1',
  'tijuana': 'mex.1', 'xolos': 'mex.1',
  'juarez': 'mex.1', 'juárez': 'mex.1', 'bravos': 'mex.1',
  'mazatlan': 'mex.1', 'mazatlán': 'mex.1', 'cañoneros': 'mex.1', 'canoneros': 'mex.1',
  'san luis': 'mex.1', 'atletico san luis': 'mex.1', 'atlético san luis': 'mex.1',
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/**
 * Format a Date to YYYYMMDD string (ESPN API format).
 */
function toESPNDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

/**
 * Get Monday and Sunday of the current week (local time).
 */
function currentWeekRange(): { from: Date; to: Date } {
  const now = new Date()
  const day = now.getDay() // 0=Sun, 1=Mon...
  const diffToMon = day === 0 ? -6 : 1 - day
  const monday = new Date(now)
  monday.setDate(now.getDate() + diffToMon)
  monday.setHours(0, 0, 0, 0)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  sunday.setHours(23, 59, 59, 999)
  return { from: monday, to: sunday }
}

/**
 * Get Monday and Sunday of the PREVIOUS week (local time).
 */
function lastWeekRange(): { from: Date; to: Date } {
  const { from } = currentWeekRange()
  const monday = new Date(from)
  monday.setDate(from.getDate() - 7)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return { from: monday, to: sunday }
}

// ---------------------------------------------------------------------------
// ESPN API fetch
// ---------------------------------------------------------------------------

interface ESPNScoreboardRaw {
  leagues?: { name?: string; season?: { displayName?: string } }[]
  events?: ESPNEventRaw[]
}

interface ESPNEventRaw {
  id?: string
  name?: string
  date?: string
  competitions?: ESPNCompetitionRaw[]
}

interface ESPNCompetitionRaw {
  status?: { type?: { name?: string; detail?: string } }
  venue?: { fullName?: string }
  competitors?: ESPNCompetitorRaw[]
}

interface ESPNCompetitorRaw {
  homeAway?: string
  score?: string
  winner?: boolean
  team?: { displayName?: string; abbreviation?: string }
}

function parseStatus(raw: string | undefined): GameStatus {
  if (!raw) return 'scheduled'
  const r = raw.toUpperCase()
  if (r.includes('FINAL') || r.includes('FULL_TIME') || r.includes('FT')) return 'final'
  if (r.includes('PROGRESS') || r.includes('HALF') || r.includes('LIVE')) return 'in_progress'
  return 'scheduled'
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

async function fetchScoreboard(leagueSlug: string, dateParam: string): Promise<ESPNScoreboardRaw> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueSlug}/scoreboard?dates=${dateParam}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NullCLI/1.0)' },
  })
  if (!res.ok) throw new Error(`ESPN API error: ${res.status} for ${url}`)
  return await res.json() as ESPNScoreboardRaw
}

function parseScoreboard(raw: ESPNScoreboardRaw, leagueSlug: string): ESPNScoreboard {
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
    })
  }

  return {
    league: league?.name ?? leagueSlug,
    leagueSlug,
    season: league?.season?.displayName,
    games,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface DateRange {
  from: Date
  to: Date
}

/**
 * Fetch scoreboard for a league and optional date range.
 * Defaults to the current week if no range provided.
 */
export async function getScoreboard(leagueSlug: string, range?: DateRange): Promise<ESPNScoreboard> {
  const r = range ?? currentWeekRange()
  const dateParam = `${toESPNDate(r.from)}-${toESPNDate(r.to)}`
  const raw = await fetchScoreboard(leagueSlug, dateParam)
  return parseScoreboard(raw, leagueSlug)
}

/**
 * Detect which league the user is asking about.
 * Returns the ESPN league slug or null if not detected.
 */
export function detectLeague(query: string): string | null {
  const q = query.toLowerCase()

  // Direct league name match
  for (const [keyword, slug] of Object.entries(LEAGUE_MAP)) {
    if (q.includes(keyword)) return slug
  }

  // Implicit league via team name
  for (const [team, slug] of Object.entries(TEAM_LEAGUE_MAP)) {
    if (q.includes(team)) return slug
  }

  return null
}

/**
 * Detect the date range the user is asking about.
 * Returns a DateRange or defaults to current week.
 */
export function detectDateRange(query: string): DateRange {
  const q = query.toLowerCase()

  // "semana pasada", "la semana pasada", "last week"
  if (/semana pasada|last week|semana anterior/.test(q)) {
    return lastWeekRange()
  }

  // "esta semana", "this week", "semana actual"
  if (/esta semana|this week|semana actual|semana corriente/.test(q)) {
    return currentWeekRange()
  }

  // "hoy", "today" → just today
  if (/\bhoy\b|\btoday\b/.test(q)) {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const end = new Date(today)
    end.setHours(23, 59, 59, 999)
    return { from: today, to: end }
  }

  // "ayer", "yesterday"
  if (/\bayer\b|\byesterday\b/.test(q)) {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    yesterday.setHours(0, 0, 0, 0)
    const end = new Date(yesterday)
    end.setHours(23, 59, 59, 999)
    return { from: yesterday, to: end }
  }

  // "últimos resultados", "recientes" → last 7 days
  if (/últimos|ultimos|recientes|recent|últimas|ultimas/.test(q)) {
    const to = new Date()
    const from = new Date()
    from.setDate(to.getDate() - 7)
    from.setHours(0, 0, 0, 0)
    return { from, to }
  }

  // "próximos partidos", "siguientes", "upcoming" → next 7 days
  if (/próximos|proximos|siguientes|upcoming|next/.test(q)) {
    const from = new Date()
    const to = new Date()
    to.setDate(from.getDate() + 7)
    return { from, to }
  }

  // Default: current week
  return currentWeekRange()
}

// ---------------------------------------------------------------------------
// Format helpers (build a context string for the LLM)
// ---------------------------------------------------------------------------

function formatGameLine(game: ESPNGame, localTZ?: string): string {
  const date = new Date(game.date)
  const localDate = date.toLocaleDateString('es-MX', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: localTZ,
  })
  const localTime = date.toLocaleTimeString('es-MX', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: localTZ,
    hour12: true,
  })

  if (game.status === 'final') {
    const winner = game.home.winner ? `**${game.home.team}**` : game.home.team
    const loser = game.away.winner ? `**${game.away.team}**` : game.away.team
    const homeDisplay = game.home.winner ? `**${game.home.team}**` : game.home.team
    const awayDisplay = game.away.winner ? `**${game.away.team}**` : game.away.team
    void winner; void loser
    return `• ${homeDisplay} ${game.home.score} - ${game.away.score} ${awayDisplay} (Final) — ${localDate}`
  }

  if (game.status === 'in_progress') {
    return `• ${game.home.team} ${game.home.score} - ${game.away.score} ${game.away.team} [${game.statusDetail}] — EN VIVO`
  }

  // scheduled
  return `• ${game.home.team} vs ${game.away.team} — ${localDate} ${localTime}`
}

/**
 * Build a formatted context string from a scoreboard to inject into LLM.
 */
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
    `Total de partidos: ${scoreboard.games.length}`,
    '',
  ]

  if (live.length > 0) {
    lines.push('⚡ EN VIVO:')
    for (const g of live) lines.push(formatGameLine(g, tz))
    lines.push('')
  }

  if (finals.length > 0) {
    lines.push('✅ Resultados:')
    for (const g of finals) lines.push(formatGameLine(g, tz))
    lines.push('')
  }

  if (scheduled.length > 0) {
    lines.push('📅 Próximos partidos:')
    for (const g of scheduled) lines.push(formatGameLine(g, tz))
    lines.push('')
  }

  if (scoreboard.games.length === 0) {
    lines.push('No se encontraron partidos para este periodo.')
  }

  lines.push('INSTRUCCIONES: Usa estos datos para responder la pregunta del usuario. Menciona marcadores específicos, equipos y fechas. Responde en el idioma en que el usuario escribió.')

  return lines.join('\n')
}
