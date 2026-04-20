import React from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../context/ThemeContext.js'

interface InputProps {
  value: string
  cursorVisible: boolean
  isLoading: boolean
  placeholder?: string
}

export function Input({
  value,
  cursorVisible,
  isLoading,
  placeholder = 'Ask anything...',
}: InputProps) {
  const { accent } = useTheme()
  const cols = process.stdout?.columns || 80

  return (
    <Box
      flexDirection="row"
      borderStyle="round"
      borderColor={isLoading ? 'yellow' : accent}
      paddingX={1}
      height={3}
      width={cols - 2}
    >
      <Text color={accent} bold>{'> '}</Text>
      {value.length === 0 && !isLoading ? (
        <Text color="gray">{placeholder}</Text>
      ) : (
        <Text color="white">
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
