import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import figlet from 'figlet'

const LOGO = figlet.textSync('null', {
  font: 'ANSI Shadow',
  horizontalLayout: 'default',
  verticalLayout: 'default',
  width: 80,
})

const LOGO_LINES = LOGO.split('\n')

interface GoodbyeProps {
  sessionId: string
  sessionDate: string
  hasMessages: boolean
}

export function Goodbye({ sessionId, sessionDate, hasMessages }: GoodbyeProps) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Small delay so the screen clears before showing
    const timer = setTimeout(() => setVisible(true), 50)
    return () => clearTimeout(timer)
  }, [])

  const rows = process.stdout?.rows || 24
  const topPad = Math.max(0, Math.floor((rows - LOGO_LINES.length - 8) / 2))

  if (!visible) return null

  return (
    <Box flexDirection="column" height={rows}>
      <Box height={topPad} />
      <Box flexDirection="column" alignItems="center">
        {LOGO_LINES.map((line, i) => (
          <Text key={i} color="cyan" bold dimColor>
            {line}
          </Text>
        ))}
      </Box>

      {hasMessages ? (
        <Box flexDirection="column" paddingX={2} marginTop={1}>
          <Box height={1} />
          <Box>
            <Text color="gray">  Session   </Text>
            <Text color="white">
              New session - {sessionDate}
            </Text>
          </Box>
          <Box>
            <Text color="gray">  Continue  </Text>
            <Text color="cyan">null -s {sessionId}</Text>
          </Box>
          <Box height={1} />
        </Box>
      ) : (
        <Box marginTop={1} justifyContent="center">
          <Text color="gray">No messages in this session.</Text>
        </Box>
      )}
    </Box>
  )
}
