import React from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../context/ThemeContext.js'

interface HeaderProps {
  model: string
  sessionId: string
}

export function Header({ model, sessionId }: HeaderProps) {
  const { accent } = useTheme()
  const cols = process.stdout?.columns || 80

  return (
    <Box
      height={1}
      width={cols}
      paddingX={1}
      justifyContent="space-between"
    >
      <Box>
        <Text color={accent} bold>null</Text>
        <Text color="gray"> | </Text>
        <Text color="white">{model}</Text>
      </Box>
      <Box>
        <Text color="gray">session </Text>
        <Text color="white" dimColor>{sessionId}</Text>
      </Box>
    </Box>
  )
}
