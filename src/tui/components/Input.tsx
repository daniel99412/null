import React from 'react'
import { Box, Text } from 'ink'

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
  const cols = process.stdout?.columns || 80

  return (
    <Box
      flexDirection="row"
      borderStyle="round"
      borderColor={isLoading ? 'yellow' : 'cyan'}
      paddingX={1}
      height={3}
      width={cols - 2}
    >
      <Text color="cyan" bold>{'> '}</Text>
      {value.length === 0 && !isLoading ? (
        <Text color="gray">{placeholder}</Text>
      ) : (
        <Text color="white">
          {value}
          {cursorVisible && !isLoading ? (
            <Text color="cyan" inverse>{' '}</Text>
          ) : null}
        </Text>
      )}
      {isLoading ? (
        <Text color="yellow"> thinking...</Text>
      ) : null}
    </Box>
  )
}
