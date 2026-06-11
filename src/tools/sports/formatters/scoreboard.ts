import type { SportsScoreboard } from '../types.js'

export function formatScoreboardTable(scoreboard: SportsScoreboard): string {
  if (scoreboard.games.length === 0) {
    return `No encontré partidos para ${scoreboard.league} en ese rango.`
  }

  const rows = [
    `| Fecha | Estado | Local | Marcador | Visitante |`,
    `|---|---:|---|---:|---|`,
    ...scoreboard.games.map((game) => {
      const score = game.status === 'scheduled'
        ? 'vs'
        : `${game.home.score || '0'}-${game.away.score || '0'}`
      return `| ${formatDate(game.date)} | ${game.statusDetail || game.status} | ${game.home.team} | ${score} | ${game.away.team} |`
    }),
  ]

  return [`### ${scoreboard.league} - resultados`, ...rows].join('\n')
}

export function formatScoreboardContext(scoreboard: SportsScoreboard): string {
  return [
    `=== ${scoreboard.league} | Resultados ===`,
    ...scoreboard.games.map((game) => {
      const score = game.status === 'scheduled'
        ? 'vs'
        : `${game.home.score || '0'}-${game.away.score || '0'}`
      return `${formatDate(game.date)} · ${game.statusDetail || game.status} · ${game.home.team} ${score} ${game.away.team}`
    }),
  ].join('\n')
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value || '-'
  return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
}
