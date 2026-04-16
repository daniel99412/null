import React from 'react'
import { Box, Text } from 'ink'
import { renderLoadingBar } from '../utils/loading.js'

interface FooterProps {
  isLoading: boolean
  loadingPos: number
  isAtBottom: boolean
  hasMoreLines: boolean
  scrollOffset: number
}

export function Footer({
  isLoading,
  loadingPos,
  isAtBottom,
  hasMoreLines,
  scrollOffset,
}: FooterProps) {
  return (
    <Box height={1} paddingX={1} justifyContent="space-between">
      <Box>
        {isLoading ? (
          <Text color="cyan">{renderLoadingBar(loadingPos)}</Text>
        ) : (
          <Text color="gray">null v0.1.0</Text>
        )}
      </Box>
      <Box>
        {!isAtBottom && hasMoreLines ? (
          <Text color="yellow">{scrollOffset} lines above  </Text>
        ) : null}
        <Text color="gray">ctrl+p</Text>
        <Text color="white"> commands  </Text>
        <Text color="gray">arrows</Text>
        <Text color="white"> scroll  </Text>
        <Text color="gray">ctrl+c</Text>
        <Text color="white"> quit</Text>
      </Box>
    </Box>
  )
}
