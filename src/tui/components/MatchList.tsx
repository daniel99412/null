import React, { useMemo, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { useTheme } from '../context/ThemeContext.js'
import type { DigestMatch } from '../../core/agent.types.js'

interface MatchListProps {
  matches: DigestMatch[]
  onOpenMatch: (match: DigestMatch) => void
  onClose: () => void
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return value.slice(0, Math.max(0, max - 3)) + '...'
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '-'
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr.slice(0, 10)
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' })
}

function statusBadge(game: DigestMatch): string {
  if (game.status === 'in_progress') return 'EN VIVO'
  if (game.status === 'final') return 'FINAL'
  return game.statusDetail || 'PROX'
}

function isToday(dateStr: string): boolean {
  if (!dateStr) return false
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return false
  const today = new Date()
  return (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  )
}

export function MatchList({ matches, onOpenMatch, onClose }: MatchListProps) {
  const { accent } = useTheme()
  const [selectedIndex, setSelectedIndex] = useState(0)

  const clamped = Math.min(selectedIndex, Math.max(0, matches.length - 1))
  if (clamped !== selectedIndex) setSelectedIndex(clamped)

  const selected = useMemo(() => matches[selectedIndex], [matches, selectedIndex])

  useInput((char, key) => {
    if (key.escape || char === 'q' || char === 'Q') {
      onClose()
      return
    }

    if (key.upArrow || char === 'k') {
      setSelectedIndex((i) => Math.max(0, i - 1))
      return
    }

    if (key.downArrow || char === 'j') {
      setSelectedIndex((i) => Math.min(matches.length - 1, i + 1))
      return
    }

    if (key.return) {
      const match = matches[selectedIndex]
      if (match) onOpenMatch(match)
      return
    }

    if (char === 'g' || key.home) {
      setSelectedIndex(0)
      return
    }

    if (char === 'G' || key.end) {
      setSelectedIndex(Math.max(0, matches.length - 1))
      return
    }


  })

  const cols = process.stdout?.columns || 80
  const rows = process.stdout?.rows || 24
  const width = Math.min(84, cols - 4)

  // Compute how many items fit in the terminal
  const borderHeight = 2
  const headerLines = 2
  const footerLines = 2
  const itemLines = 2
  const availableLines = Math.max(4, rows - borderHeight - headerLines - footerLines - 2)
  const maxVisibleItems = Math.max(1, Math.floor(availableLines / itemLines))
  const actualMaxItems = Math.min(matches.length, maxVisibleItems)
  const windowStart = Math.max(0, Math.min(selectedIndex - actualMaxItems + 1, matches.length - actualMaxItems))
  const visibleItems = matches.slice(windowStart, windowStart + actualMaxItems)
  const contentHeight = visibleItems.length * itemLines

  const hasMoreAbove = windowStart > 0
  const hasMoreBelow = windowStart + visibleItems.length < matches.length
  const scrollbarVisible = matches.length > maxVisibleItems

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center">
      <Box
        flexDirection="column"
        width={width}
        borderStyle="round"
        borderColor={accent}
        paddingX={1}
        backgroundColor="black"
      >
        <Box justifyContent="space-between" marginBottom={1}>
          <Text color={accent} bold>Partidos</Text>
          <Text color="gray">{matches.length} partidos</Text>
        </Box>

        <Box>
          <Text color="gray">{'─'.repeat(width - 4)}</Text>
        </Box>

        <Box flexDirection="column" height={contentHeight} overflow="hidden">
          {visibleItems.length === 0 ? (
            <Box paddingY={1}>
              <Text color="gray">No hay partidos disponibles.</Text>
            </Box>
          ) : (
            visibleItems.map((match, index) => {
              const actualIndex = windowStart + index
              const isSelected = actualIndex === selectedIndex
              const score = match.status === 'scheduled'
                ? 'vs'
                : `${match.homeScore}-${match.awayScore}`
              const badge = statusBadge(match)
              const scrollbarWidth = scrollbarVisible ? 2 : 0
              const today = isToday(match.date)
              const todayWidth = today ? 2 : 0
              const teamWidth = Math.max(3, Math.floor((width - score.length - badge.length - 14 - scrollbarWidth - todayWidth) / 2))

              // Scrollbar thumb for this row
              let sb: string | null = null
              if (scrollbarVisible) {
                const scrollPos = visibleItems.length > 1 && matches.length > 1
                  ? Math.round((actualIndex / (matches.length - 1)) * (visibleItems.length - 1))
                  : 0
                sb = index === scrollPos ? '█' : '│'
              }

              return (
                <Box key={`${match.eventId}-${match.position}`} paddingX={1}>
                    <Box flexDirection="column" width={width - 4}>
                      <Box>
                        <Box flexGrow={1}>
                        {today && (
                          <Text color="yellow" bold>! </Text>
                        )}
                        <Text
                          color={isSelected ? accent : 'white'}
                          bold={isSelected}
                          inverse={isSelected}
                        >
                          {truncate(match.homeTeam, teamWidth)}
                        </Text>
                        <Text
                          color={isSelected ? accent : 'white'}
                          bold={true}
                        >
                          {' '}{score}{' '}
                        </Text>
                        <Text
                          color={isSelected ? accent : 'white'}
                          bold={isSelected}
                          inverse={isSelected}
                        >
                          {truncate(match.awayTeam, teamWidth)}
                        </Text>
                        <Text
                          color={match.status === 'in_progress' ? 'red' : match.status === 'final' ? 'green' : (isSelected ? accent : 'gray')}
                          bold={match.status === 'in_progress' || match.status === 'final'}
                        >
                          {' '}{badge}
                        </Text>
                      </Box>
                      {sb ? (
                        <Box width={scrollbarWidth} justifyContent="center" marginLeft={1}>
                          <Text color="gray">{sb}</Text>
                        </Box>
                      ) : null}
                    </Box>
                    <Text color="gray" dimColor={!isSelected}>
                      {truncate(formatDate(match.date) + (match.venue ? ' · ' + match.venue : ''), width - 14 - scrollbarWidth)}
                    </Text>
                  </Box>
                </Box>
              )
            })
          )}
        </Box>

        <Box>
          <Text color="gray">{'─'.repeat(width - 4)}</Text>
        </Box>

        <Box justifyContent="space-between">
          <Text color="gray">enter abrir · esc/q cerrar</Text>
          <Box>
            {hasMoreAbove ? <Text color="gray">↑{windowStart} </Text> : null}
            <Text color="gray">{selectedIndex + 1}/{matches.length}</Text>
            {hasMoreBelow ? <Text color="gray"> ↓{matches.length - windowStart - visibleItems.length}</Text> : null}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
