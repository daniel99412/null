import React, { useState, useMemo } from 'react'
import { Box, Text, useInput } from 'ink'
import { useTheme } from '../context/ThemeContext.js'

export interface CommandItem {
  id: string
  label: string
  description: string
  shortcut?: string
}

interface CommandPaletteProps {
  commands: CommandItem[]
  onSelect: (id: string) => void
  onClose: () => void
}

export function CommandPalette({ commands, onSelect, onClose }: CommandPaletteProps) {
  const { accent } = useTheme()
  const [filter, setFilter] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  const filtered = useMemo(() => {
    if (!filter) return commands
    const lower = filter.toLowerCase()
    return commands.filter(
      (c) =>
        c.label.toLowerCase().includes(lower) ||
        c.description.toLowerCase().includes(lower),
    )
  }, [commands, filter])

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
      const item = filtered[selectedIndex]
      if (item) {
        onSelect(item.id)
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
  const paletteWidth = Math.min(60, cols - 4)
  const maxItems = Math.min(filtered.length, rows - 8)

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
        borderColor={accent}
        paddingX={1}
      >
        {/* Search input */}
        <Box marginBottom={1}>
          <Text color={accent} bold>{'> '}</Text>
          <Text color="white">{filter}</Text>
          <Text color={accent} inverse>{' '}</Text>
          {!filter && <Text color="gray"> Search commands...</Text>}
        </Box>

        {/* Separator */}
        <Box>
          <Text color="gray">{'─'.repeat(paletteWidth - 4)}</Text>
        </Box>

        {/* Command list */}
        {visibleItems.length === 0 ? (
          <Box paddingY={1} justifyContent="center">
            <Text color="gray">No matching commands</Text>
          </Box>
        ) : (
          visibleItems.map((cmd, i) => {
            const actualIndex = visibleStartIndex + i
            const isSelected = actualIndex === selectedIndex
            return (
              <Box key={cmd.id} paddingX={1}>
                <Box flexGrow={1}>
                  <Text
                    color={isSelected ? accent : 'white'}
                    bold={isSelected}
                    inverse={isSelected}
                  >
                    {isSelected ? ' ' : ' '}
                    {cmd.label}
                    {'  '}
                  </Text>
                  <Text color="gray" dimColor={!isSelected}>
                    {cmd.description}
                  </Text>
                </Box>
                {cmd.shortcut ? (
                  <Text color="gray" dimColor>{cmd.shortcut}</Text>
                ) : null}
              </Box>
            )
          })
        )}

        {/* Footer hint */}
        <Box marginTop={1}>
          <Text color="gray">{'─'.repeat(paletteWidth - 4)}</Text>
        </Box>
        <Box justifyContent="space-between">
          <Text color="gray">arrows navigate  enter select  esc close</Text>
        </Box>
      </Box>
    </Box>
  )
}
