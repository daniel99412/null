import React, { useState, useEffect, useMemo } from 'react'
import { Box, Text, useInput, useWindowSize } from 'ink'
import { useTheme } from '../context/ThemeContext.js'
import { useScroll } from '../hooks/useScroll.js'
import { getMatchDetail } from '../../tools/sports/espn-match.js'
import type { DigestMatch, MatchDetailData } from '../../core/agent.types.js'

interface MatchDetailProps {
  match: DigestMatch
  onClose: () => void
}

type LoadStatus = 'loading' | 'ready' | 'error'
type DetailSection = 'stats' | 'events' | 'lineups' | 'h2h'

function positionLabel(pos: number): string {
  if (pos <= 0) return '?'
  if (pos <= 26) {
    return String.fromCharCode('a'.charCodeAt(0) + pos - 1)
  }
  const p = pos - 27
  const first = Math.floor(p / 26)
  const second = p % 26
  return String.fromCharCode('a'.charCodeAt(0) + first) + String.fromCharCode('a'.charCodeAt(0) + second)
}

function fmt(v: string | number): string {
  if (typeof v === 'number') return String(v)
  const n = Number.parseFloat(v)
  if (['0.3', '0.8', '0.9', '0.2', '0.5', '0.6'].includes(v) || (n > 0 && n < 1)) {
    return `${Math.round(n * 100)}%`
  }
  return v
}

function extractNum(v: string | number): number {
  if (typeof v === 'number') return v
  const n = Number.parseFloat(v)
  return Number.isFinite(n) ? n : 0
}

function renderStatBar(home: number, away: number, width: number): string {
  const total = Math.abs(home) + Math.abs(away)
  if (total === 0) return '░'.repeat(width)
  const ratio = Math.abs(home) / total
  const fillLen = Math.round(ratio * width)
  return '█'.repeat(fillLen) + '░'.repeat(width - fillLen)
}

const LABELS: Record<string, string> = {
  POSSESSION: 'Posesión',
  SHOTS: 'Tiros',
  'ON GOAL': 'A puerta',
  'Yellow Cards': 'T. Amarillas',
  'Red Cards': 'T. Rojas',
  Fouls: 'Faltas',
  'Corner Kicks': 'Córners',
  Offsides: 'Fueras',
  Saves: 'Atajadas',
  'Penalty Goals': 'Penales',
  'Blocked Shots': 'Tiros bloq.',
  'Accurate Passes': 'Pases precisos',
  Passes: 'Pases totales',
  'Pass Completion %': '% Pases',
  'Penalty Kicks Taken': 'Penales tomados',
  'On Target %': '% Precisión',
  'Effective Tackles': 'Entradas',
  Tackles: 'Entradas totales',
  'Tackle %': '% Entradas',
  'Accurate Crosses': 'Centros precisos',
  Crosses: 'Centros',
  'Cross %': '% Centros',
  'Long Balls': 'Balones largos',
  'Accurate Long Balls': 'Bal. largos precisos',
  'Long Balls %': '% Bal. largos',
  Interceptions: 'Intercepciones',
  'Effective Clearances': 'Despejes',
  Clearances: 'Despejes totales',
}

function labelOf(k: string): string {
  return LABELS[k] || k
}

export function MatchDetail({ match, onClose }: MatchDetailProps) {
  const { accent } = useTheme()
  const { columns, rows } = useWindowSize()
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [detail, setDetail] = useState<MatchDetailData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [section, setSection] = useState<DetailSection>('stats')

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setError(null)

    getMatchDetail(match.leaguePath, match.eventId)
      .then((data) => {
        if (cancelled) return
        if (!data) {
          setError('No se pudieron obtener los detalles del partido.')
          setStatus('error')
          return
        }
        setDetail(data)
        setStatus('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        setStatus('error')
      })

    return () => { cancelled = true }
  }, [match.eventId, match.leaguePath])

  const windowWidth = Math.min(120, Math.max(60, Math.floor(columns * 0.85)))
  const windowHeight = Math.max(14, Math.floor(rows * 0.85))
  const innerWidth = Math.max(20, windowWidth - 6)
  const footerHeight = 1
  const headerHeight = 4
  const borderHeight = 2
  const visibleHeight = Math.max(3, windowHeight - headerHeight - footerHeight - borderHeight)

  const sectionLines = useMemo(() => {
    if (status !== 'ready' || !detail) return []

    const lines: string[] = []

    if (section === 'stats') {
      const barWidth = Math.min(20, Math.max(8, Math.floor(innerWidth * 0.18)))

      const show = detail.homeStats.map((hs, i) => ({
        label: hs.label,
        home: fmt(hs.value),
        away: fmt(detail.awayStats[i]?.value ?? ''),
        homeRaw: extractNum(hs.value),
        awayRaw: extractNum(detail.awayStats[i]?.value ?? 0),
      }))

      lines.push('')
      for (const s of show) {
        const homeS = String(s.home).padStart(5)
        const awayS = String(s.away).padEnd(5)
        const lbl = labelOf(s.label).padEnd(20)
        const bar = renderStatBar(s.homeRaw, s.awayRaw, barWidth)
        lines.push(`  ${homeS}  ${bar}  ${awayS}  ${lbl}`)
      }
    }

    if (section === 'events') {
      const goals = detail.events.filter((e) => e.type === 'goal')
      const cards = detail.events.filter((e) => e.type === 'card')
      const subs = detail.events.filter((e) => e.type === 'substitution')

      if (goals.length > 0) {
        lines.push('')
        lines.push('  ⚽ Goles')
        for (const ev of goals) {
          const s = ev.homeScore !== undefined ? ` (${ev.homeScore}-${ev.awayScore})` : ''
          lines.push(`    ${ev.time.padEnd(6)} ${ev.team.padEnd(14)} ${ev.description.slice(0, innerWidth - 34)}${s}`)
        }
      }

      if (cards.length > 0) {
        lines.push('')
        lines.push('  🟨 Tarjetas')
        for (const ev of cards) {
          lines.push(`    ${ev.time.padEnd(6)} ${ev.team.padEnd(14)} ${ev.description}`)
        }
      }

      if (subs.length > 0) {
        lines.push('')
        lines.push('  🔄 Cambios')
        for (const ev of subs) {
          lines.push(`    ${ev.time.padEnd(6)} ${ev.team.padEnd(14)} ${ev.description.slice(0, innerWidth - 34)}`)
        }
      }

      if (!goals.length && !cards.length && !subs.length) {
        lines.push('')
        lines.push('  No hay eventos registrados.')
      }
    }

    if (section === 'lineups') {
      lines.push('')
      const max = Math.max(detail.homePlayers.length, detail.awayPlayers.length)
      for (let i = 0; i < max; i++) {
        const hp = detail.homePlayers[i]
        const ap = detail.awayPlayers[i]
        const hc = hp ? `${hp.jersey.padStart(2)} ${hp.name.padEnd(18)} ${hp.position.padEnd(4)}` : ''.padEnd(26)
        const ac = ap ? `${ap.jersey.padStart(2)} ${ap.name.padEnd(18)} ${ap.position.padEnd(4)}` : ''
        lines.push(`  ${hc}  ${ac}`)
      }
    }

    if (section === 'h2h') {
      if (detail.h2h && detail.h2h.length > 0) {
        lines.push('')
        for (const h of detail.h2h) {
          lines.push(`  ${h.home.padEnd(20)} ${h.score.padStart(5)}  ${h.away.padEnd(20)}  ${h.date || ''}`)
        }
      } else {
        lines.push('')
        lines.push('  No hay historial de enfrentamientos.')
      }
    }

    return lines
  }, [detail, status, section, innerWidth])

  const {
    visibleLines,
    isAtBottom,
    handleUp,
    handleDown,
    resetScroll,
  } = useScroll(sectionLines, { maxLines: visibleHeight })

  useEffect(() => {
    resetScroll()
  }, [section, match.eventId, resetScroll])

  useInput((char, key) => {
    if (key.escape || char === 'q' || char === 'Q') {
      onClose()
      return
    }

    if (key.upArrow || char === 'k') { handleUp(); return }
    if (key.downArrow || char === 'j') { handleDown(); return }
    if (key.pageUp || char === 'b') {
      for (let i = 0; i < Math.max(1, Math.floor(visibleHeight / 2)); i++) handleUp()
      return
    }
    if (key.pageDown || char === ' ' || char === 'f') {
      for (let i = 0; i < Math.max(1, Math.floor(visibleHeight / 2)); i++) handleDown()
      return
    }
    if (char === 'g' || key.home) { resetScroll(); return }
    if (char === 'G' || key.end) { for (let i = 0; i < 9999; i++) handleDown(); return }
    if (char === '1') setSection('stats')
    if (char === '2') setSection('events')
    if (char === '3') setSection('lineups')
    if (char === '4') setSection('h2h')
  })

  const sections: DetailSection[] = ['stats', 'events', 'lineups', 'h2h']
  const tabLabels: Record<DetailSection, string> = { stats: '1Est', events: '2Ev', lineups: '3Ali', h2h: '4H2H' }

  const scrollInfo = status === 'ready' && sectionLines.length > visibleHeight
    ? ` · ${isAtBottom ? 'final' : 'sigue ↓'}`
    : ''

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center">
      <Box
        flexDirection="column"
        width={windowWidth}
        height={windowHeight}
        borderStyle="round"
        borderColor={accent}
        paddingX={1}
        backgroundColor="black"
      >
        {/* Compact header: score + status + nav hint */}
        <Box justifyContent="space-between" marginBottom={1}>
          <Box>
            {detail ? (
              <Text color="white" bold>
                {detail.homeTeam} {detail.homeScore}-{detail.awayScore} {detail.awayTeam}
              </Text>
            ) : (
              <Text color="white">Cargando...</Text>
            )}
            {detail ? (
              <Text color="gray">
                {' '}· {detail.status}{detail.venue ? ` · ${detail.venue}` : ''}
              </Text>
            ) : null}
          </Box>
          <Text color="gray">esc/q cerrar</Text>
        </Box>

        {/* Section tabs: inline, compact */}
        <Box marginBottom={1}>
          {sections.map((s) => {
            const active = s === section
            return (
              <Box key={s} marginRight={1}>
                <Text color={active ? accent : 'gray'} bold={active} inverse={active}>
                  {tabLabels[s]}
                </Text>
              </Box>
            )
          })}
          <Text color="gray">  [1-4] sección{scrollInfo}</Text>
        </Box>

        {/* Content */}
        <Box flexDirection="column" height={visibleHeight} overflow="hidden">
          {status === 'loading' && <Text color="gray">Cargando detalles...</Text>}
          {status === 'error' && <Text color="red">Error: {error}</Text>}
          {status === 'ready' && (
            <Text color="white" wrap="wrap">{visibleLines.join('\n')}</Text>
          )}
        </Box>

        {/* Footer: position + scroll status */}
        <Box justifyContent="space-between">
          <Text color="gray">{sectionLines.length} líneas</Text>
          <Text color="gray">p{positionLabel(match.position)} [↑↓] scroll</Text>
        </Box>
      </Box>
    </Box>
  )
}
