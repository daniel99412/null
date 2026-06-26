import React, { useMemo } from 'react'
import { Box, Text } from 'ink'
import { generatePositions } from './utils/formation.js'
import { mapESPNRosters } from './utils/espn-mapper.js'
import type { RawFormation, RawRosterPlayer } from './types/lineup.js'

interface SoccerLineupProps {
  rawData: unknown
  accent: string
}

const COLS = 52
const ROWS = 26
const PANEL_W = 33

interface CanvasCell {
  char: string
  color?: string
}
type CanvasRow = CanvasCell[]

function makeCanvas(): CanvasRow[] {
  return Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, (): CanvasCell => ({ char: ' ' })),
  )
}

function setAt(canvas: CanvasRow[], row: number, col: number, char: string, color?: string): void {
  if (row >= 0 && row < ROWS && col >= 0 && col < COLS && char.length > 0) {
    canvas[row][col] = { char, color }
  }
}

function setStr(canvas: CanvasRow[], row: number, col: number, str: string, color?: string): void {
  for (let i = 0; i < str.length; i++) {
    setAt(canvas, row, col + i, str[i], color)
  }
}

function drawField(canvas: CanvasRow[]): void {
  for (let c = 0; c < COLS; c++) {
    setAt(canvas, 0, c, c === 0 ? '┌' : c === COLS - 1 ? '┐' : '─')
    setAt(canvas, ROWS - 1, c, c === 0 ? '└' : c === COLS - 1 ? '┘' : '─')
  }
  for (let r = 1; r < ROWS - 1; r++) {
    setAt(canvas, r, 0, '│')
    setAt(canvas, r, COLS - 1, '│')
  }

  const halfRow = Math.floor(ROWS / 2)
  for (let c = 1; c < COLS - 1; c++) {
    if (c === Math.floor(COLS / 2)) {
      setAt(canvas, halfRow, c, '◉')
    } else {
      setAt(canvas, halfRow, c, c % 2 === 0 ? '─' : ' ')
    }
  }

  // Top penalty box
  for (let r = 1; r <= 6; r++) {
    for (let c = 16; c <= 35; c++) {
      const isHoriz = r === 1 || r === 6
      const isVert = c === 16 || c === 35
      if (isHoriz && isVert) {
        setAt(canvas, r, c, r === 1 ? '┬' : '┴')
      } else if (isHoriz) {
        setAt(canvas, r, c, '─')
      } else if (isVert) {
        setAt(canvas, r, c, '│')
      }
    }
  }

  // Bottom penalty box
  for (let r = 19; r <= 24; r++) {
    for (let c = 16; c <= 35; c++) {
      const isHoriz = r === 19 || r === 24
      const isVert = c === 16 || c === 35
      if (isHoriz && isVert) {
        setAt(canvas, r, c, r === 19 ? '┬' : '┴')
      } else if (isHoriz) {
        setAt(canvas, r, c, '─')
      } else if (isVert) {
        setAt(canvas, r, c, '│')
      }
    }
  }

  // Goal mouths
  for (let c = 22; c <= 29; c++) {
    setAt(canvas, 0, c, c === 22 ? '▌' : c === 29 ? '▐' : ' ')
    setAt(canvas, ROWS - 1, c, c === 22 ? '▌' : c === 29 ? '▐' : ' ')
  }
}

function jerseyShort(j: string): string {
  const n = Number.parseInt(j, 10)
  if (Number.isNaN(n)) return j.slice(0, 2).padEnd(2)
  return String(n).padStart(2)
}

function placeTeam(canvas: CanvasRow[], formation: RawFormation, flipY: boolean): void {
  const hexColor = formation.color ? `#${formation.color}` : undefined
  const starters = formation.roster
    .filter((p) => p.starter && p.formationPlace !== '0')
    .sort((a, b) => Number(a.formationPlace) - Number(b.formationPlace))

  const positions = generatePositions(formation.formation, flipY)
  if (positions.length === 0) return

  const playerCount = Math.min(starters.length, positions.length)
  for (let i = 0; i < playerCount; i++) {
    const p = positions[i]
    const col = Math.round(p.x * (COLS - 6)) + 2
    const row = Math.round(p.y * (ROWS - 6)) + 2
    const marker = `●${jerseyShort(starters[i].jersey)}`
    setStr(canvas, row, col, marker, hexColor)
  }
}

function renderCanvasRow(row: CanvasRow): React.ReactNode {
  const segments: { text: string; color?: string }[] = []
  for (const cell of row) {
    const last = segments[segments.length - 1]
    if (last && last.color === cell.color) {
      last.text += cell.char
    } else {
      segments.push({ text: cell.char, color: cell.color })
    }
  }
  while (segments.length > 1 && segments[segments.length - 1]?.text === ' ') {
    segments.pop()
  }
  return (
    <Text>
      {segments.map((seg, si) =>
        seg.color ? <Text key={si} color={seg.color}>{seg.text}</Text> : <Text key={si}>{seg.text}</Text>,
      )}
    </Text>
  )
}

function evString(p: RawRosterPlayer, asSub = false): string {
  let s = ''
  if (p.subbedOut) s += '↓'
  if (p.subbedIn && asSub) s += '↑'
  if (p.yellowCard) s += '!'
  if (p.redCard) s += 'R'
  return s
}

function evColor(s: string): string {
  if (s.includes('R') || s.includes('↓')) return 'red'
  if (s.includes('↑')) return 'green'
  if (s.includes('!')) return 'yellow'
  return 'white'
}

/**
 * Build starting XI rows (fill array[0..ROWS-1]).
 */
function buildStarters(
  formation: RawFormation | undefined,
  isHome: boolean,
  accent: string,
): React.ReactNode[][] {
  if (!formation) return Array.from({ length: ROWS }, () => [])

  const hexColor = formation.color ? `#${formation.color}` : accent
  const positions = generatePositions(formation.formation, !isHome)
  const starters = formation.roster
    .filter((p) => p.starter && p.formationPlace !== '0')
    .sort((a, b) => Number(a.formationPlace) - Number(b.formationPlace))

  const rows: React.ReactNode[][] = Array.from({ length: ROWS }, () => [])

  // Row 0: header
  const hdr = `${isHome ? '← ' : ''}${formation.abbreviation || formation.teamName} ${formation.formation}${isHome ? '' : ' →'}`
  rows[0] = [<Text key="h" bold color={isHome ? hexColor : accent}>{hdr}</Text>]

  // Row 1: separator
  rows[1] = [<Text key="s" color="gray">{'─'.repeat(PANEL_W)}</Text>]

  // Rows 2-12: starting XI
  let rr = 2
  for (let i = 0; i < Math.min(starters.length, positions.length); i++) {
    const player = starters[i]
    const posLabel = positions[i].pos
    const ev = evString(player)

    if (isHome) {
      const txt = `${posLabel.padEnd(4)} ${player.jersey.padStart(2)} ${player.shortName}`
      const els: React.ReactNode[] = [<Text key="i" color={hexColor}>{txt}</Text>]
      if (ev) els.push(<Text key="ev" color={evColor(ev)}>{ev}</Text>)
      if (rr < ROWS) rows[rr] = els
    } else {
      const txt = `${player.shortName.padEnd(12)} ${player.jersey.padStart(2)}  ${posLabel}`
      const els: React.ReactNode[] = []
      if (ev) {
        els.push(
          <Text key="full">
            <Text color={evColor(ev)}>{ev.padEnd(14)}</Text>
            <Text color="white">{txt}</Text>
          </Text>,
        )
      } else {
        els.push(<Text key="full"><Text>{' '.repeat(14)}</Text><Text color="white">{txt}</Text></Text>)
      }
      if (rr < ROWS) rows[rr] = els
    }
    rr++
  }

  return rows
}

/**
 * Build substitute rows array (one element per row).
 */
function buildSubs(
  formation: RawFormation | undefined,
  isHome: boolean,
  accent: string,
  maxRows: number,
): React.ReactNode[][] {
  const rows: React.ReactNode[][] = Array.from({ length: maxRows }, () => [])
  if (!formation) return rows

  const hexColor = formation.color ? `#${formation.color}` : accent
  const subs = formation.roster
    .filter((p) => !p.starter)
    .sort((a, b) => Number(a.jersey) - Number(b.jersey))
  if (subs.length === 0) return rows

  const push = (idx: number, els: React.ReactNode[]) => {
    if (idx < maxRows) rows[idx] = els
  }

  let r = 0
  push(r++, [<Text key="sep" color="gray">{'─'.repeat(PANEL_W)}</Text>])
  push(r++, [<Text key="hdr" color="gray">Suplentes</Text>])
  push(r++, [<Text key="sep2" color="gray">{'─'.repeat(PANEL_W)}</Text>])

  for (const p of subs) {
    if (r >= maxRows) break
    const ev = evString(p, true)

    if (isHome) {
      const txt = `${p.jersey.padStart(3)}  ${p.shortName}`
      const els: React.ReactNode[] = [<Text key="i" color={hexColor}>{txt}</Text>]
      if (ev) els.push(<Text key="ev" color={evColor(ev)}>{ev}</Text>)
      push(r++, els)
    } else {
      const txt = `${p.shortName.padEnd(12)}  ${p.jersey.padStart(2)}`
      const els: React.ReactNode[] = []
      if (ev) {
        els.push(
          <Text key="full">
            <Text color={evColor(ev)}>{ev.padEnd(14)}</Text>
            <Text color="white">{txt}</Text>
          </Text>,
        )
      } else {
        els.push(<Text key="full"><Text>{' '.repeat(14)}</Text><Text color="white">{txt}</Text></Text>)
      }
      push(r++, els)
    }
  }

  return rows
}

export function SoccerLineup({ rawData, accent }: SoccerLineupProps) {
  const formations = useMemo(() => mapESPNRosters(rawData), [rawData])
  const home = formations.find((f) => f.homeAway === 'home')
  const away = formations.find((f) => f.homeAway === 'away')

  const { canvas, homeRows, awayRows, extraHome, extraAway } = useMemo(() => {
    const field = makeCanvas()
    drawField(field)
    if (home) placeTeam(field, home, false)
    if (away) placeTeam(field, away, true)

    const hr = buildStarters(home, true, accent)
    const ar = buildStarters(away, false, accent)

    const extra = 35
    const hs = buildSubs(home, true, accent, extra)
    const as = buildSubs(away, false, accent, extra)

    let si = 0
    for (let rr = 13; rr < ROWS && si < extra; rr++, si++) {
      if (hs[si]?.length) hr[rr] = hs[si]
      if (as[si]?.length) ar[rr] = as[si]
    }

    return {
      canvas: field,
      homeRows: hr,
      awayRows: ar,
      extraHome: hs.slice(ROWS - 13),
      extraAway: as.slice(ROWS - 13),
    }
  }, [home, away, accent])

  // Determine how many extra rows we need (both teams have subs beyond canvas)
  const extraCount = Math.max(extraHome.length, extraAway.length)

  return (
    <Box flexDirection="column">
      {canvas.map((row, r) => (
        <Box key={r} flexDirection="row" alignItems="flex-start">
          <Box width={PANEL_W} justifyContent="flex-start">
            {homeRows[r].length > 0 ? (
              <Box flexDirection="row" justifyContent="space-between" width="100%">
                {homeRows[r]}
              </Box>
            ) : (
              <Text> </Text>
            )}
          </Box>
          <Box flexGrow={1} justifyContent="center">
            {renderCanvasRow(row)}
          </Box>
          <Box width={PANEL_W} justifyContent="flex-start">
            {awayRows[r].length > 0 ? (
              <Box flexDirection="row" justifyContent="flex-start" width="100%">
                {awayRows[r]}
              </Box>
            ) : (
              <Text> </Text>
            )}
          </Box>
        </Box>
      ))}
      {/* Legend */}
      <Box flexDirection="row" alignItems="flex-start">
        <Box width={PANEL_W} justifyContent="flex-start"><Text> </Text></Box>
        <Box flexGrow={1} justifyContent="center">
          <Text color="gray">● jugador + dorsal</Text>
        </Box>
        <Box width={PANEL_W} justifyContent="flex-start"><Text> </Text></Box>
      </Box>
      {/* Extra rows for subs beyond canvas */}
      {Array.from({ length: extraCount }, (_, i) => (
        <Box key={`x-${i}`} flexDirection="row" alignItems="flex-start">
          <Box width={PANEL_W} justifyContent="flex-start">
            {extraHome[i]?.length ? (
              <Box flexDirection="row" justifyContent="space-between" width="100%">
                {extraHome[i]}
              </Box>
            ) : <Text> </Text>}
          </Box>
          <Box flexGrow={1} justifyContent="center"><Text> </Text></Box>
          <Box width={PANEL_W} justifyContent="flex-start">
            {extraAway[i]?.length ? (
              <Box flexDirection="row" justifyContent="flex-start" width="100%">
                {extraAway[i]}
              </Box>
            ) : <Text> </Text>}
          </Box>
        </Box>
      ))}
    </Box>
  )
}
