import type { RawFormation, RawRosterPlayer } from '../types/lineup.js'

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
}

function normalizePosition(pos: string): string {
  return pos.replace(/-(L|R)$/, '')
}

export function mapESPNRosters(rawData: unknown): RawFormation[] {
  const data = asRecord(rawData)
  const rosters = asArray(data['rosters'])
  const header = asRecord(data['header'])
  const comps = asArray(header['competitions'] ?? [])
  const competition = asRecord(comps[0] ?? {})
  const competitors = asArray(competition['competitors'])

  const colorMap = new Map<string, string>()
  for (const c of competitors) {
    const comp = asRecord(c)
    const team = asRecord(comp['team'])
    const abbr = stringValue(team['abbreviation'])
    const color = stringValue(team['color'])
    if (abbr) colorMap.set(abbr, color || '')
  }

  return rosters.map((r): RawFormation => {
    const roster = asRecord(r)
    const team = asRecord(roster['team'])
    const abbr = stringValue(team['abbreviation'])
    const teamName = stringValue(team['displayName'] || team['name'] || team['location'])
    const formation = stringValue(roster['formation'])
    const homeAway = stringValue(roster['homeAway']) as 'home' | 'away'
    const color = stringValue(team['color']) || colorMap.get(abbr) || ''

    const players: RawRosterPlayer[] = asArray(roster['roster']).map((p): RawRosterPlayer => {
      const player = asRecord(p)
      const athlete = asRecord(player['athlete'])
      const pos = asRecord(player['position'] ?? {})
      const plays = asArray(player['plays'])
      const rawPos = stringValue(pos['abbreviation'] ?? '')
      const yellowCard = plays.some((pl) => asRecord(pl)['yellowCard'] === true)
      const redCard = plays.some((pl) => asRecord(pl)['redCard'] === true)

      return {
        jersey: stringValue(player['jersey'] ?? athlete['jersey']),
        shortName: stringValue(athlete['shortName'] || athlete['displayName']),
        position: normalizePosition(rawPos),
        starter: player['starter'] === true,
        formationPlace: stringValue(player['formationPlace'] || '0'),
        yellowCard,
        redCard,
        subbedOut: player['subbedOut'] === true,
        subbedIn: player['subbedIn'] === true,
      }
    })

    return { teamName, abbreviation: abbr, color, formation, homeAway, roster: players }
  })
}
