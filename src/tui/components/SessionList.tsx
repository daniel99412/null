import React, { useState, useMemo } from 'react'
import { Box, Text, useInput } from 'ink'
import { listSessions, deleteSession } from '../../memory/sessions.js'
import type { Session } from '../../memory/sessions.js'

interface SessionListProps {
  onSelect: (sessionId: string) => void
  onClose: () => void
  currentSessionId: string
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString()
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str
  return str.slice(0, max - 3) + '...'
}

export function SessionList({ onSelect, onClose, currentSessionId }: SessionListProps) {
  const [sessions, setSessions] = useState<Session[]>(() => listSessions(20))
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [filter, setFilter] = useState('')

  const filtered = useMemo(() => {
    if (!filter) return sessions
    const lower = filter.toLowerCase()
    return sessions.filter(
      (s) =>
        (s.title || '').toLowerCase().includes(lower) ||
        s.id.toLowerCase().includes(lower),
    )
  }, [sessions, filter])

  const clamped = Math.min(selectedIndex, Math.max(0, filtered.length - 1))
  if (clamped !== selectedIndex) {
    setSelectedIndex(clamped)
  }

  useInput((char, key) => {
    if (key.escape) {
      onClose()
      return
    }

    if (key.return) {
      const session = filtered[selectedIndex]
      if (session) {
        onSelect(session.id)
      }
      return
    }

    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1))
      return
    }

    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(filtered.length - 1, i + 1))
      return
    }

    if (key.delete || (key.ctrl && char === 'd')) {
      const session = filtered[selectedIndex]
      if (session && session.id !== currentSessionId) {
        deleteSession(session.id)
        setSessions(listSessions(20))
        setSelectedIndex((i) => Math.max(0, i - 1))
      }
      return
    }

    if (key.backspace) {
      setFilter((f) => f.slice(0, -1))
      setSelectedIndex(0)
      return
    }

    if (char && !key.ctrl && !key.meta) {
      setFilter((f) => f + char)
      setSelectedIndex(0)
    }
  })

  const cols = process.stdout?.columns || 80
  const rows = process.stdout?.rows || 24
  const paletteWidth = Math.min(70, cols - 4)
  const maxItems = Math.min(filtered.length, rows - 10)
  const labelWidth = Math.max(20, paletteWidth - 30)

  const windowStart = Math.max(0, selectedIndex - maxItems + 1)
  const visibleItems = filtered.slice(windowStart, windowStart + maxItems)
  const visibleStartIndex = windowStart

  return (
    <Box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      height={rows}
      width={cols}
    >
      <Box
        flexDirection="column"
        width={paletteWidth}
        borderStyle="round"
        borderColor="cyan"
        paddingX={1}
      >
        {/* Title */}
        <Box marginBottom={1}>
          <Text color="cyan" bold>Sessions</Text>
          <Text color="gray"> ({sessions.length} total)</Text>
        </Box>

        {/* Search */}
        <Box>
          <Text color="cyan" bold>{'> '}</Text>
          <Text color="white">{filter}</Text>
          <Text color="cyan" inverse>{' '}</Text>
          {!filter && <Text color="gray"> Filter sessions...</Text>}
        </Box>

        <Box>
          <Text color="gray">{'─'.repeat(paletteWidth - 4)}</Text>
        </Box>

        {/* Session list */}
        {visibleItems.length === 0 ? (
          <Box paddingY={1} justifyContent="center">
            <Text color="gray">No sessions found</Text>
          </Box>
        ) : (
          visibleItems.map((session, i) => {
            const actualIndex = visibleStartIndex + i
            const isSelected = actualIndex === selectedIndex
            const isCurrent = session.id === currentSessionId
            const title = session.title || 'Untitled session'

            return (
              <Box key={session.id} paddingX={1} justifyContent="space-between">
                <Box>
                  <Text
                    color={isSelected ? 'cyan' : isCurrent ? 'green' : 'white'}
                    bold={isSelected}
                    inverse={isSelected}
                  >
                    {isSelected ? ' ' : ' '}
                    {truncate(title, labelWidth)}
                    {'  '}
                  </Text>
                </Box>
                <Box>
                  {isCurrent ? (
                    <Text color="green" dimColor> current </Text>
                  ) : null}
                  <Text color="gray" dimColor>{formatDate(session.updated_at)}</Text>
                </Box>
              </Box>
            )
          })
        )}

        {/* Footer */}
        <Box marginTop={1}>
          <Text color="gray">{'─'.repeat(paletteWidth - 4)}</Text>
        </Box>
        <Box justifyContent="space-between">
          <Text color="gray">enter resume  ctrl+d delete  esc back</Text>
        </Box>
      </Box>
    </Box>
  )
}
