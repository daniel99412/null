import type { SportsNewsItem } from '../types.js'

export function formatNewsCards(news: SportsNewsItem[]): string {
  if (news.length === 0) return 'No encontré noticias deportivas para esa consulta.'

  const now = new Date()
  const dateStr = now.toLocaleString('es-MX', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  const headerLabel = 'RESUMEN DE NOTICIAS — DEPORTES'
  const header = [
    '╔══════════════════════════════════════════════════╗',
    `║  ${headerLabel.padEnd(46)}  ║`,
    `║  ${dateStr.slice(0, 46).padEnd(46)}  ║`,
    '╚══════════════════════════════════════════════════╝',
    '',
  ].join('\n')

  const cards = news
    .slice(0, 10)
    .map((item, index) => formatSportsNewsCard(item, index === 9 ? '0' : String(index + 1), now))
    .join('\n\n')

  const sources = new Set(news.map((item) => item.source).filter(Boolean))
  const footer = [
    '',
    '─────────────────────────────────────────────────────',
    `Fuentes: ${sources.size} medios consultados`,
    'Nota: La inclinación de cobertura no se estima para noticias deportivas.',
  ].join('\n')

  return `${header}${cards}${footer}`
}

export function formatNewsContext(news: SportsNewsItem[]): string {
  return [
    '=== Noticias deportivas ===',
    ...news.slice(0, 10).map((item, index) =>
      `${index + 1}. ${item.headline} (${item.source}${item.published ? `, ${formatDate(item.published)}` : ''})${item.description ? ` - ${item.description}` : ''}${item.url ? ` URL: ${item.url}` : ''}`,
    ),
  ].join('\n')
}

function formatDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
}

function formatSportsNewsCard(item: SportsNewsItem, displayKey: string, now: Date): string {
  const CONTENT_WIDTH = 72
  const source = item.source || 'Fuente deportiva'
  const summary = item.description?.trim() || 'Sin resumen disponible.'
  const titularLines = wrapWithPrefix(item.headline, '│ ', CONTENT_WIDTH)
  const resumenLines = wrapWithPrefix(`Resumen: ${summary}`, '│ ', CONTENT_WIDTH)

  const lines: string[] = []
  lines.push(`┌─(${displayKey}) Deportes · ${source}`)
  lines.push('│')
  for (const line of titularLines) lines.push(line)
  lines.push('│')
  for (const line of resumenLines) lines.push(line)
  lines.push('│')
  lines.push('│ Cobertura: 1 medio')
  lines.push(`│ Recencia: ${formatRecency(item.published, now)}`)
  lines.push('│')
  lines.push('│ Inclinación de cobertura: no estimable')
  lines.push('│ Polarización: no estimable')
  lines.push('└')

  return lines.join('\n')
}

function formatRecency(published: string, now: Date): string {
  const date = new Date(published)
  if (!published || Number.isNaN(date.getTime())) return 'fecha desconocida'

  const minutesAgo = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60000))
  const timeStr = date.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  if (minutesAgo < 60) return `hace ${minutesAgo} min (${timeStr})`

  const hoursAgo = Math.round(minutesAgo / 60)
  if (hoursAgo === 1) return `hace 1 hora (${timeStr})`
  if (hoursAgo < 24) return `hace ${hoursAgo} horas (${timeStr})`

  const daysAgo = Math.round(hoursAgo / 24)
  return daysAgo === 1 ? 'hace 1 día' : `hace ${daysAgo} días`
}

function wrapWithPrefix(text: string, prefix: string, maxWidth: number): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  const contentWidth = maxWidth - prefix.length
  if (contentWidth <= 0) return [`${prefix}${clean}`]

  const words = clean.split(' ')
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    if (current.length === 0) {
      current = word
    } else if (current.length + 1 + word.length <= contentWidth) {
      current = `${current} ${word}`
    } else {
      lines.push(`${prefix}${current}`)
      current = word
    }
  }

  if (current.length > 0) lines.push(`${prefix}${current}`)
  return lines
}
