import type { SportsStandings } from '../types.js'

export function formatStandingsTable(standings: SportsStandings): string {
  if (standings.groups.length === 0) {
    return `No encontré tabla de posiciones para ${standings.league}.`
  }

  return [
    `### ${standings.league} - tabla`,
    ...standings.groups.flatMap((group) => [
      standings.groups.length > 1 ? `\n#### ${group.name}` : '',
      '| # | Equipo | PJ | G | E | P | GF | GC | Pts | Forma |',
      '|---:|---|---:|---:|---:|---:|---:|---:|---:|---|',
      ...group.entries.map((entry, index) =>
        `| ${entry.rank ?? index + 1} | ${entry.team} | ${entry.played} | ${entry.wins} | ${entry.draws} | ${entry.losses} | ${entry.goalsFor} | ${entry.goalsAgainst} | ${entry.points} | ${entry.form ?? ''} |`,
      ),
    ]),
  ].filter(Boolean).join('\n')
}

export function formatStandingsContext(standings: SportsStandings): string {
  return [
    `=== ${standings.league} | Tabla ===`,
    ...standings.groups.flatMap((group) => [
      `[${group.name}]`,
      ...group.entries.map((entry, index) =>
        `${entry.rank ?? index + 1}. ${entry.team} - ${entry.points} pts (${entry.played} PJ, ${entry.wins}G ${entry.draws}E ${entry.losses}P)`,
      ),
    ]),
  ].join('\n')
}
