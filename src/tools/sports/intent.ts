import { normalizeQuery } from '../../utils/normalize.js'
import { getDb } from '../../memory/database.js'
import type { DateRange, EntityType, SportsCapability, SportsIntentResult } from './types.js'

const INTENT_SIGNALS: Record<SportsCapability, RegExp[]> = {
  scoreboard: [
    /\b(resultados?|marcador(?:es)?|scores?|c[oó]mo\s+qued[oó]|c[oó]mo\s+termin[oó])\b/i,
    /\b([uú]ltima\s+jornada|jornada\s+(pasada|anterior)|fin\s+de\s+semana)\b/i,
    /\b(jug[oó]|jugaron|gan[oó]|empat[oó]|perdi[oó])\b/i,
  ],
  standings: [
    /\b(tabla|standings?|posiciones|clasificaci[oó]n|puntaje|general)\b/i,
    /\b(qui[eé]n\s+va\s+primero|l[ií]der\s+de\s+la\s+liga)\b/i,
  ],
  fixtures: [
    /\b(calendario|fixture|pr[oó]ximos?\s+(partidos?|juegos?)|cu[aá]ndo\s+juega)\b/i,
    /\b(upcoming|next\s+match|siguiente\s+partido)\b/i,
  ],
  news: [
    /\b(noticias?|news|novedades?|transfers?|fichajes?|rumores?)\b/i,
    /\b(deportes?|deportiv[ao]s?)\b/i,
    /\bqu[eé]\s+(pas[oó]|hay|hubo)\b.*\b(equipo|club|liga)\b/i,
  ],
}

export function detectSportsCapability(query: string): SportsCapability {
  const normalized = normalizeQuery(query)

  for (const capability of ['standings', 'fixtures', 'news', 'scoreboard'] as SportsCapability[]) {
    if (INTENT_SIGNALS[capability].some((pattern) => pattern.test(normalized))) {
      return capability
    }
  }

  return 'scoreboard'
}

export function hasExplicitDateRange(query: string): boolean {
  return /(^|\s)(fin\s+de\s+semana|semana\s+pasada|esta\s+semana|hoy|ayer|[uú]ltimos?|pr[oó]ximos?|[uú]ltima\s+jornada|jornada\s+\d+|last\s+matchday)(\s|$)/i.test(query)
}

export function detectDateIntent(query: string): 'lastMatchday' | 'range' {
  return /(^|\s)([uú]ltima\s+jornada|jornada\s+(pasada|anterior)|last\s+matchday)(\s|$)/i.test(query)
    ? 'lastMatchday'
    : 'range'
}

export function detectDateRange(query: string, now = new Date()): DateRange {
  const normalized = normalizeQuery(query)
  const today = startOfDay(now)

  if (/\bayer\b/i.test(normalized)) {
    const from = addDays(today, -1)
    return { from, to: endOfDay(from) }
  }

  if (/\bsemana\s+pasada\b/i.test(normalized)) {
    const currentMonday = startOfWeek(today)
    const from = addDays(currentMonday, -7)
    return { from, to: addDays(from, 6) }
  }

  if (/\besta\s+semana\b/i.test(normalized)) {
    const from = startOfWeek(today)
    return { from, to: addDays(from, 6) }
  }

  if (/\bfin\s+de\s+semana\b/i.test(normalized)) {
    const friday = nextOrSameWeekday(today, 5)
    return { from: friday, to: endOfDay(addDays(friday, 2)) }
  }

  if (/\b(pr[oó]ximos?|siguiente|upcoming|next)\b/i.test(normalized)) {
    return { from: today, to: addDays(today, 7) }
  }

  if (/(^|\s)([uú]ltimos?|[uú]ltima\s+jornada|jornada\s+(pasada|anterior)|last\s+matchday)(\s|$)/i.test(normalized)) {
    return { from: addDays(today, -7), to: endOfDay(today) }
  }

  if (/\bhoy\b/i.test(normalized)) {
    return { from: today, to: endOfDay(today) }
  }

  return { from: addDays(today, -7), to: endOfDay(today) }
}

export function detectSportsIntent(query: string): SportsIntentResult {
  const entity = detectSportsEntity(query)
  const intent = detectSportsCapability(query)

  return {
    intent,
    leagueId: entity.leagueId,
    teamId: entity.entityType === 'team' ? entity.entityId : undefined,
    entityType: entity.entityType,
    entityId: entity.entityId,
    dateRange: detectDateRange(query),
  }
}

export function detectLeague(query: string): string | null {
  return detectExplicitSportsEntity(query)?.providerLeagueId ?? null
}

interface DetectedSportsEntity {
  entityType: EntityType
  entityId: string
  leagueId: string
  providerLeagueId: string | null
}

function detectSportsEntity(query: string): DetectedSportsEntity {
  return detectExplicitSportsEntity(query) ?? {
    entityType: 'league',
    entityId: 'liga_mx',
    leagueId: 'liga_mx',
    providerLeagueId: getProviderExternalId('league', 'liga_mx', 'espn'),
  }
}

function detectExplicitSportsEntity(query: string): DetectedSportsEntity | null {
  const normalized = normalizeQuery(query)
  const db = getDb()
  const aliases = db.prepare(`
    SELECT alias, entity_id, entity_type
    FROM sports_aliases
    ORDER BY length(alias) DESC
  `).all() as { alias: string; entity_id: string; entity_type: EntityType }[]

  for (const alias of aliases) {
    if (containsAlias(normalized, alias.alias)) {
      if (alias.entity_type === 'league') {
        return {
          entityType: 'league',
          entityId: alias.entity_id,
          leagueId: alias.entity_id,
          providerLeagueId: getProviderExternalId('league', alias.entity_id, 'espn'),
        }
      }

      const team = db.prepare('SELECT league_id FROM teams WHERE id = ?').get(alias.entity_id) as { league_id: string } | undefined
      const leagueId = team?.league_id ?? 'liga_mx'
      return {
        entityType: 'team',
        entityId: alias.entity_id,
        leagueId,
        providerLeagueId: getProviderExternalId('league', leagueId, 'espn'),
      }
    }
  }

  return null
}

function containsAlias(query: string, alias: string): boolean {
  const normalizedAlias = normalizeQuery(alias)
  const escaped = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|\\W)${escaped}(\\W|$)`, 'i').test(query)
}

function getProviderExternalId(entityType: EntityType, entityId: string, provider: string): string | null {
  const db = getDb()
  const row = db.prepare(`
    SELECT external_id
    FROM entity_providers
    WHERE entity_type = ? AND entity_id = ? AND provider = ?
  `).get(entityType, entityId, provider) as { external_id: string } | undefined
  return row?.external_id ?? null
}

function startOfDay(date: Date): Date {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  return next
}

function endOfDay(date: Date): Date {
  const next = new Date(date)
  next.setHours(23, 59, 59, 999)
  return next
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function startOfWeek(date: Date): Date {
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  return addDays(startOfDay(date), diff)
}

function nextOrSameWeekday(date: Date, weekday: number): Date {
  const diff = (weekday - date.getDay() + 7) % 7
  return addDays(startOfDay(date), diff)
}
