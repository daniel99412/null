import React from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../context/ThemeContext.js'

export interface SlashCommandEntry {
  alias: string
  description: string
  argHint: string | null
}

interface SlashMenuProps {
  commands: SlashCommandEntry[]
  selectedIndex: number
  visible: boolean
  width: number
}

export function SlashMenu({ commands, selectedIndex, visible, width: cols }: SlashMenuProps) {
  const { accent } = useTheme()

  if (!visible || commands.length === 0) return null

  const rows = process.stdout?.rows || 24
  const menuWidth = Math.min(50, cols - 4)
  const maxItems = Math.min(commands.length, rows - 8)

  const windowStart = Math.max(0, selectedIndex - maxItems + 1)
  const visibleItems = commands.slice(windowStart, windowStart + maxItems)

  return (
    <Box
      flexDirection="column"
      width={menuWidth}
      borderStyle="round"
      borderColor={accent}
      paddingX={1}
      marginLeft={1}
    >
      {visibleItems.map((cmd, i) => {
        const actualIndex = windowStart + i
        const isSelected = actualIndex === selectedIndex
        const label = `/${cmd.alias}${cmd.argHint ? ` ${cmd.argHint}` : ''}`
        return (
          <Box key={cmd.alias} paddingX={1}>
            <Box flexGrow={1}>
              <Text
                color={isSelected ? accent : 'white'}
                bold={isSelected}
                inverse={isSelected}
              >
                {' '}{label}{'  '}
              </Text>
              <Text color="gray" dimColor={!isSelected}>
                {cmd.description}
              </Text>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}
