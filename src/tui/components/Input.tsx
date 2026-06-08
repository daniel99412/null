import React from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../context/ThemeContext.js'

interface InputProps {
  value: string
  cursorVisible: boolean
  isLoading: boolean
  width: number
  placeholder?: string
  dimmed?: boolean
}

/** Calculate how many terminal rows a string occupies given a max column width. */
function calcHeight(text: string, maxCols: number): number {
  if (text.length === 0) return 1
  // Account for the "> " prefix (2 chars) and paddingX={1} on each side (2 chars) + border (2 chars)
  const usable = Math.max(1, maxCols - 6)
  return Math.max(1, Math.ceil(text.length / usable))
}

export function Input({
  value,
  cursorVisible,
  isLoading,
  width: cols,
  placeholder = 'Ask anything...',
  dimmed = false,
}: InputProps) {
  const { accent } = useTheme()

  // +2 to account for top and bottom border rows
  const contentRows = calcHeight(value, cols)
  const boxHeight = contentRows + 2

  return (
    <Box
      flexDirection="row"
      borderStyle="round"
      borderColor={isLoading ? 'yellow' : accent}
      paddingX={1}
      height={boxHeight}
      width={cols - 2}
    >
      <Text color={accent} bold dimColor={dimmed}>{'> '}</Text>
      {value.length === 0 && !isLoading ? (
        <Text color="gray" dimColor={dimmed}>{placeholder}</Text>
      ) : (
        <Text color="white" dimColor={dimmed}>
          {value}
          {cursorVisible && !isLoading ? (
            <Text color={accent} inverse>{' '}</Text>
          ) : null}
        </Text>
      )}
      {isLoading ? (
        <Text color="yellow"> thinking...</Text>
      ) : null}
    </Box>
  )
}
