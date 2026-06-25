import type { MatchDetailData } from '../../core/agent.types.js'

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports'

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
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
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

export async function getMatchDetail(leaguePath: string, eventId: string): Promise<MatchDetailData> {
  const url = `${ESPN_BASE}/${leaguePath}/summary?event=${eventId}`
  const data = asRecord(await fetchJson(url))

  const header = asRecord(data['header'])
  const comps = asArray(asRecord(header['competitions']) || asRecord(header['competition'])?.['competitors'])
  // Fallback: competitions might be nested differently
  let competition = asRecord(header['competition'] ?? (asArray(header['competitions'])[0]))
  if (!competition['id']) {
    competition = asRecord(asArray(header['competitions'])?.[0] ?? data)
  }

  const competitors = asArray(competition['competitors'])
  const home = asRecord(competitors.find((c) => asRecord(c)['homeAway'] === 'home'))
  const away = asRecord(competitors.find((c) => asRecord(c)['homeAway'] === 'away'))
  const homeTeam = asRecord(home['team'])
  const awayTeam = asRecord(away['team'])
  const statusObj = asRecord(competition['status'])
  const statusType = asRecord(statusObj['type'])
  const statusDetail = stringValue(statusType['detail'] || statusObj['description'] || '')

  const boxscore = asRecord(data['boxscore'])
  const boxTeams = asArray(boxscore['teams'])
  const rawHomeStats = asArray(asRecord(boxTeams[0] ?? {})['statistics'] ?? [])
  const rawAwayStats = asArray(asRecord(boxTeams[1] ?? {})['statistics'] ?? [])

  const homeStats = rawHomeStats.map((s) => {
    const stat = asRecord(s)
    return { label: stringValue(stat['label'] || stat['name']), value: stringValue(stat['displayValue'] ?? stat['value']) || numberValue(stat['value']) }
  })

  const awayStats = rawAwayStats.map((s) => {
    const stat = asRecord(s)
    return { label: stringValue(stat['label'] || stat['name']), value: stringValue(stat['displayValue'] ?? stat['value']) || numberValue(stat['value']) }
  })

  const keyEvents = asArray(data['keyEvents'])
  const events = keyEvents.map((e) => {
    const ev = asRecord(e)
    const evType = stringValue(asRecord(ev['type'])['text'])
    let type: 'goal' | 'card' | 'substitution' | 'other' = 'other'
    if (evType === 'Goal') type = 'goal'
    else if (evType?.includes('Card') || evType?.includes('card')) type = 'card'
    else if (evType === 'Substitution') type = 'substitution'

    const team = asRecord(ev['team'])
    const teamName = stringValue(team['displayName'] ?? team['name'])
    const participants = asArray(ev['participants'])
    const firstParticipant = asRecord(participants[0] ?? {})
    const athlete = asRecord(firstParticipant['athlete'] ?? {})
    const playerName = stringValue(athlete['displayName'])
    const text = stringValue(ev['text'] || ev['shortText'])
    const description = playerName && text ? text : (evType === 'Goal' ? `${playerName} ⚽` : text)

    return {
      time: stringValue(asRecord(ev['clock'])['displayValue']),
      type,
      team: teamName,
      description,
      homeScore: numberValue(ev['homeScore']) || undefined,
      awayScore: numberValue(ev['awayScore']) || undefined,
    }
  })

  const rosters = asArray(data['rosters'])
  const parseRoster = (rawRoster: unknown) => {
    const r = asRecord(rawRoster)
    return asArray(r['roster']).map((p) => {
      const player = asRecord(p)
      const athlete = asRecord(player['athlete'])
      const pos = asRecord(player['position'] ?? {})
      return {
        jersey: stringValue(player['jersey'] ?? athlete['jersey']),
        name: stringValue(athlete['displayName']),
        position: stringValue(pos['abbreviation'] ?? '').slice(0, 3),
      }
    })
  }
  const homeRoster = parseRoster(rosters.find((r) => {
    const tr = asRecord(r)
    return stringValue(asRecord(tr['team'])['abbreviation']) === stringValue(homeTeam['abbreviation'])
  }))
  const awayRoster = parseRoster(rosters.find((r) => {
    const tr = asRecord(r)
    return stringValue(asRecord(tr['team'])['abbreviation']) === stringValue(awayTeam['abbreviation'])
  }))

  const h2hGames = asArray(data['headToHeadGames']).slice(0, 10)
  const h2h = h2hGames.map((g) => {
    const game = asRecord(g)
    const hTeam = asRecord(asArray(game['competitors'])?.[0] ?? {})
    const aTeam = asRecord(asArray(game['competitors'])?.[1] ?? {})
    return {
      home: stringValue(asRecord(hTeam['team'])['displayName'] ?? hTeam['name']),
      away: stringValue(asRecord(aTeam['team'])['displayName'] ?? aTeam['name']),
      score: `${numberValue(hTeam['score'])}-${numberValue(aTeam['score'])}`,
      date: stringValue(game['date']).slice(0, 10),
    }
  })

  const venue = asRecord(competition['venue'] ?? {})
  const tournamentInfo = asRecord(competition['tournament'] ?? data['season'] ?? {})
  const season = asRecord(competition['season'] ?? data['season'] ?? {})

  return {
    homeTeam: stringValue(homeTeam['displayName'] ?? homeTeam['name'] ?? homeTeam['location']),
    awayTeam: stringValue(awayTeam['displayName'] ?? awayTeam['name'] ?? awayTeam['location']),
    homeScore: numberValue(home['score']),
    awayScore: numberValue(away['score']),
    status: statusDetail || stringValue(asRecord(asRecord(competition['status'])['type'])['description']),
    tournament: stringValue(tournamentInfo['name'] ?? season['displayName'] ?? season['name']),
    venue: stringValue(venue['fullName'] ?? venue['shortName']) || undefined,
    date: stringValue(competition['date'] ?? data['date']).slice(0, 10),
    homeStats,
    awayStats,
    events,
    homePlayers: homeRoster,
    awayPlayers: awayRoster,
    h2h: h2h.length > 0 ? h2h : undefined,
  }
}
