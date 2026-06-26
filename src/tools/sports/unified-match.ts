import type { DigestMatch, MatchDetailData } from '../../core/agent.types.js'
import type { UnifiedPlayer } from '../../core/sports.types.js'
import { getMatchDetail } from './espn-match.js'
import { findFotmobMatchUrl, getFotmobMatchData } from './fotmob-match.js'

function mergeCaptains(
  espnPlayers: UnifiedPlayer[],
  fotmobPlayers: UnifiedPlayer[] | undefined,
): UnifiedPlayer[] {
  if (!fotmobPlayers || fotmobPlayers.length === 0) return espnPlayers

  const fotmobByName = new Map<string, boolean>()
  for (const fp of fotmobPlayers) {
    const key = fp.name.toLowerCase().trim()
    fotmobByName.set(key, true)
  }

  return espnPlayers.map((ep) => {
    if (ep.captain) return ep
    const key = ep.name.toLowerCase().trim()
    if (fotmobByName.has(key)) {
      return { ...ep, captain: true }
    }
    return ep
  })
}

export async function getUnifiedMatchDetail(match: DigestMatch): Promise<MatchDetailData | null> {
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

    if (!pageUrl) return data

    const fotmobData = await getFotmobMatchData(pageUrl)
    if (!fotmobData) return data

    data.homePlayers = mergeCaptains(data.homePlayers, fotmobData.homePlayers)
    data.awayPlayers = mergeCaptains(data.awayPlayers, fotmobData.awayPlayers)
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

  return data
}
