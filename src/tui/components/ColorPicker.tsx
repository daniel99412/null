import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { AVAILABLE_COLORS } from '../../config/index.js'
import type { AccentColor } from '../../config/index.js'
import { useTheme } from '../context/ThemeContext.js'

interface ColorPickerProps {
  onClose: () => void
}

const COLOR_LABELS: Record<AccentColor, string> = {
  cyan: 'Cyan',
  green: 'Green',
  blue: 'Blue',
  magenta: 'Magenta',
  yellow: 'Yellow',
  red: 'Red',
  white: 'White',
}

export function ColorPicker({ onClose }: ColorPickerProps) {
  const { accent, setAccent } = useTheme()
  const [selectedIndex, setSelectedIndex] = useState(
    () => AVAILABLE_COLORS.indexOf(accent),
  )

  useInput((_char, key) => {
    if (key.escape) {
      onClose()
      return
    }

    if (key.return) {
      setAccent(AVAILABLE_COLORS[selectedIndex])
      onClose()
      return
    }

    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1))
      return
    }

    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(AVAILABLE_COLORS.length - 1, i + 1))
    }
  })

  const cols = process.stdout?.columns || 80
  const rows = process.stdout?.rows || 24
  const paletteWidth = Math.min(40, cols - 4)

  return (
    <Box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
    >
      <Box
        flexDirection="column"
        width={paletteWidth}
        borderStyle="round"
        borderColor={accent}
        paddingX={1}
        backgroundColor="black"
      >
        <Box marginBottom={1}>
          <Text color={accent} bold>Theme Color</Text>
        </Box>

        <Box>
          <Text color="gray">{'─'.repeat(paletteWidth - 4)}</Text>
        </Box>

        {AVAILABLE_COLORS.map((color, i) => {
          const isSelected = i === selectedIndex
          const isCurrent = color === accent

          return (
            <Box key={color} paddingX={1}>
              <Text
                color={color}
                bold={isSelected}
                inverse={isSelected}
              >
                {isSelected ? ' ' : ' '}
                {'█ '}
                {COLOR_LABELS[color]}
                {isCurrent ? ' (current)' : ''}
                {'  '}
              </Text>
            </Box>
          )
        })}

        <Box marginTop={1}>
          <Text color="gray">{'─'.repeat(paletteWidth - 4)}</Text>
        </Box>
        <Box>
          <Text color="gray">arrows navigate  enter select  esc cancel</Text>
        </Box>
      </Box>
    </Box>
  )
}
