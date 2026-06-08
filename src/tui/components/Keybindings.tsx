import React from 'react'
import { Box, Text, useInput } from 'ink'
import { useTheme } from '../context/ThemeContext.js'

interface KeybindingEntry {
  keys: string
  action: string
}

const KEYBINDINGS: KeybindingEntry[] = [
  { keys: 'Ctrl+H', action: 'Open keybindings' },
  { keys: 'Ctrl+P', action: 'Open command palette' },
  { keys: 'Ctrl+W', action: 'Delete previous word' },
  { keys: 'Ctrl+C', action: 'Exit null' },
  { keys: 'Enter', action: 'Send message' },
  { keys: '↑ / ↓', action: 'Scroll messages' },
  { keys: '← / →', action: 'Move cursor' },
  { keys: 'Esc', action: 'Close overlay / Cancel' },
]

interface KeybindingsProps {
  onClose: () => void
}

export function Keybindings({ onClose }: KeybindingsProps) {
  const { accent } = useTheme()

  useInput((_char, key) => {
    if (key.escape) {
      onClose()
    }
  })

  const cols = process.stdout?.columns || 80
  const width = Math.min(48, cols - 4)

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center">
      <Box
        flexDirection="column"
        width={width}
        borderStyle="round"
        borderColor={accent}
        paddingX={1}
        backgroundColor="black"
      >
        <Box marginBottom={1}>
          <Text color={accent} bold>Keybindings</Text>
        </Box>

        <Box>
          <Text color="gray">{'─'.repeat(width - 4)}</Text>
        </Box>

        <Box paddingY={1} flexDirection="column">
          {KEYBINDINGS.map((kb) => (
            <Box key={kb.keys} paddingX={1} marginBottom={0}>
              <Box width={14}>
                <Text color={accent}>{kb.keys}</Text>
              </Box>
              <Text color="white">{kb.action}</Text>
            </Box>
          ))}
        </Box>

        <Box>
          <Text color="gray">{'─'.repeat(width - 4)}</Text>
        </Box>
        <Box justifyContent="space-between" marginTop={1}>
          <Text color="gray">esc close</Text>
        </Box>
      </Box>
    </Box>
  )
}
