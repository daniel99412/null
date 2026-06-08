import React from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../context/ThemeContext.js'

export interface FileEntry {
  name: string
  relativePath: string
}

interface FileMenuProps {
  files: FileEntry[]
  selectedIndex: number
  visible: boolean
  width: number
}

export function FileMenu({ files, selectedIndex, visible, width: cols }: FileMenuProps) {
  const { accent } = useTheme()

  if (!visible || files.length === 0) return null

  const rows = process.stdout?.rows || 24
  const menuWidth = Math.min(60, cols - 4)
  const maxItems = Math.min(files.length, rows - 8)

  const windowStart = Math.max(0, selectedIndex - maxItems + 1)
  const visibleItems = files.slice(windowStart, windowStart + maxItems)

  return (
    <Box
      flexDirection="column"
      width={menuWidth}
      borderStyle="round"
      borderColor={accent}
      paddingX={1}
      marginLeft={1}
    >
      <Box paddingX={1} marginBottom={1}>
        <Text color="gray" bold>Files</Text>
      </Box>
      {visibleItems.map((file, i) => {
        const actualIndex = windowStart + i
        const isSelected = actualIndex === selectedIndex
        return (
          <Box key={file.relativePath} paddingX={1}>
            <Box flexGrow={1}>
              <Text
                color={isSelected ? accent : 'white'}
                bold={isSelected}
                inverse={isSelected}
              >
                {' '}@{file.relativePath}
              </Text>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}
