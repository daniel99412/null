import type { SportsFixtures } from '../types.js'

export function formatFixturesTable(fixtures: SportsFixtures): string {
  if (fixtures.games.length === 0) {
    return `No encontré próximos partidos para ${fixtures.league} en ese rango.`
  }

  return [
    `### ${fixtures.league} - próximos partidos`,
    '| Fecha | Local | Visitante | Sede |',
    '|---|---|---|---|',
    ...fixtures.games.map((game) =>
      `| ${formatDateTime(game.date)} | ${game.home.team} | ${game.away.team} | ${game.venue ?? ''} |`,
    ),
  ].join('\n')
}

export function formatFixturesContext(fixtures: SportsFixtures): string {
  return [
    `=== ${fixtures.league} | Próximos partidos ===`,
    ...fixtures.games.map((game) =>
      `${formatDateTime(game.date)} · ${game.home.team} vs ${game.away.team}${game.venue ? ` · ${game.venue}` : ''}`,
    ),
  ].join('\n')
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value || '-'
  return date.toLocaleString('es-MX', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
