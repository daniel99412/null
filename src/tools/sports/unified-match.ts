import type { DigestMatch, MatchDetailData } from '../../core/agent.types.js'
import type { UnifiedPlayer } from '../../core/sports.types.js'
import { getMatchDetail } from './espn-match.js'
import { findFotmobMatchUrl, getFotmobMatchData } from './fotmob-match.js'
import { getSportsCache, setSportsCache } from './cache.js'
import { debugLog } from '../../utils/debug.js'

const CACHE_VERSION = 2

function cacheKey(match: DigestMatch): string {
  return `match-detail:v${CACHE_VERSION}:${match.leaguePath}:${match.eventId}`
}

function ttlForStatus(status: string): number {
  const s = status.toLowerCase()
  if (s.includes('live') || s.includes('in progress') || s.includes('playing') || s.includes("'") || /^\d/.test(s)) return 60
  if (s.includes('final') || s.includes('ft') || s.includes('finished')) return 24 * 60 * 60
  if (s.includes('halftime') || s.includes('ht')) return 60
  return 60 * 60
}

function mergeFotmobPlayers(
  espnPlayers: UnifiedPlayer[],
  fotmobPlayers: UnifiedPlayer[] | undefined,
): UnifiedPlayer[] {
  if (!fotmobPlayers || fotmobPlayers.length === 0) return espnPlayers

  const fotmobByName = new Map<string, UnifiedPlayer>()
  for (const fp of fotmobPlayers) {
    fotmobByName.set(fp.name.toLowerCase().trim(), fp)
  }

  return espnPlayers.map((ep) => {
    const key = ep.name.toLowerCase().trim()
    const fm = fotmobByName.get(key)
    if (!fm) return ep
    return { ...ep, captain: fm.captain || ep.captain, position: fm.position }
  })
}

export async function getUnifiedMatchDetail(match: DigestMatch): Promise<MatchDetailData | null> {
  const key = cacheKey(match)
  const cached = getSportsCache<MatchDetailData>(key)
  if (cached) {
    debugLog(`[unified-match] cache hit for ${match.homeTeam} vs ${match.awayTeam}`)
    return cached
  }

  debugLog(`[unified-match] fetching ${match.homeTeam} vs ${match.awayTeam}`)

  let data: MatchDetailData | null = null

  try {
    data = await getMatchDetail(match.leaguePath, match.eventId)
  } catch {
    return null
  }

  if (!data) return null

  try {
    const pageUrl = await findFotmobMatchUrl(
      data.homeTeam,
      data.awayTeam,
      match.date,
      match.leaguePath,
    )

    if (!pageUrl) {
      setSportsCache(key, data, ttlForStatus(data.status))
      return data
    }

    const fotmobData = await getFotmobMatchData(pageUrl)
    if (!fotmobData) {
      setSportsCache(key, data, ttlForStatus(data.status))
      return data
    }

    data.homePlayers = mergeFotmobPlayers(data.homePlayers, fotmobData.homePlayers)
    data.awayPlayers = mergeFotmobPlayers(data.awayPlayers, fotmobData.awayPlayers)
    data.homeCoach = fotmobData.homeCoach
    data.awayCoach = fotmobData.awayCoach
    data.homeFormation = fotmobData.homeFormation
    data.awayFormation = fotmobData.awayFormation
    data.h2h = fotmobData.h2h
    data.h2hSummary = fotmobData.h2hSummary
    data.injuredPlayers = fotmobData.injuredPlayers
  } catch {
    // FotMob supplement is optional
  }

  setSportsCache(key, data, ttlForStatus(data?.status ?? match.status))
  return data
}
