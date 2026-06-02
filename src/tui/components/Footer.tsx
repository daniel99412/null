import React from 'react'
import { Box, Text } from 'ink'
import { renderLoadingBar } from '../utils/loading.js'
import { useTheme } from '../context/ThemeContext.js'

interface FooterProps {
  isLoading: boolean
  loadingPos: number
  isAtBottom: boolean
  hasMoreLines: boolean
  scrollOffset: number
  digestCount?: number
  dimmed?: boolean
}

export function Footer({
  isLoading,
  loadingPos,
  isAtBottom,
  hasMoreLines,
  scrollOffset,
  digestCount = 0,
  dimmed = false,
}: FooterProps) {
  const { accent } = useTheme()

  return (
    <Box height={1} paddingX={1} justifyContent="space-between">
      <Box>
        {isLoading ? (
          <Text color={accent} dimColor={dimmed}>{renderLoadingBar(loadingPos)}</Text>
        ) : (
          <Text color="gray" dimColor={dimmed}>null v0.1.0</Text>
        )}
      </Box>
      <Box>
        {!isAtBottom && hasMoreLines ? (
          <Text color="yellow" dimColor={dimmed}>{scrollOffset} lines above  </Text>
        ) : null}
        {digestCount > 0 && !isLoading ? (
          <>
            <Text color="gray" dimColor={dimmed}>1-9</Text>
            <Text color="white" dimColor={dimmed}> leer  </Text>
          </>
        ) : null}
        <Text color="gray" dimColor={dimmed}>ctrl+p</Text>
        <Text color="white" dimColor={dimmed}> commands  </Text>
        <Text color="gray" dimColor={dimmed}>arrows</Text>
        <Text color="white" dimColor={dimmed}> scroll  </Text>
        <Text color="gray" dimColor={dimmed}>ctrl+c</Text>
        <Text color="white" dimColor={dimmed}> quit</Text>
      </Box>
    </Box>
  )
}
