import React from 'react'
import { Box, Text } from 'ink'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface MessageListProps {
  messages: ChatMessage[]
  visibleStart: number
  visibleCount: number
  terminalWidth: number
}

function wrapLine(text: string, width: number): string[] {
  if (text.length <= width) return [text]
  const result: string[] = []
  const words = text.split(' ')
  let line = ''
  for (const word of words) {
    if (line.length + word.length + 1 > width && line.length > 0) {
      result.push(line)
      line = word
    } else {
      line = line ? line + ' ' + word : word
    }
  }
  if (line) result.push(line)
  return result.length > 0 ? result : ['']
}

export function MessageList({
  messages,
  visibleStart,
  visibleCount,
  terminalWidth,
}: MessageListProps) {
  const contentWidth = Math.max(40, terminalWidth - 6)

  // Build all rendered lines with their styling info
  interface RenderLine {
    text: string
    role: 'user' | 'assistant'
    isLabel: boolean
    isSeparator: boolean
  }

  const allLines: RenderLine[] = []

  for (const msg of messages) {
    // Separator line before each message block
    if (allLines.length > 0) {
      allLines.push({ text: '', role: msg.role, isLabel: false, isSeparator: true })
    }

    // Role label
    const label = msg.role === 'user' ? '> You' : '> null'
    allLines.push({ text: label, role: msg.role, isLabel: true, isSeparator: false })

    // Content lines
    const paragraphs = msg.content.split('\n')
    for (const para of paragraphs) {
      if (para.trim() === '') {
        allLines.push({ text: '', role: msg.role, isLabel: false, isSeparator: false })
        continue
      }
      const wrapped = wrapLine(para, contentWidth)
      for (const wl of wrapped) {
        allLines.push({ text: wl, role: msg.role, isLabel: false, isSeparator: false })
      }
    }
  }

  // Slice visible portion from the end
  const totalLines = allLines.length
  const start = Math.max(0, totalLines - visibleCount - visibleStart)
  const visible = allLines.slice(start, start + visibleCount)

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={2} overflow="hidden">
      {visible.map((line, i) => {
        if (line.isSeparator) {
          return <Text key={start + i} color="gray">{' '}</Text>
        }
        if (line.isLabel) {
          return (
            <Text key={start + i} color={line.role === 'user' ? 'cyan' : 'green'} bold>
              {line.text}
            </Text>
          )
        }
        return (
          <Text key={start + i} color="white">
            {'  '}{line.text}
          </Text>
        )
      })}
    </Box>
  )
}

// Helper to count total rendered lines for scroll calculations
export function countRenderedLines(
  messages: ChatMessage[],
  terminalWidth: number,
): number {
  const contentWidth = Math.max(40, terminalWidth - 6)
  let count = 0
  for (let m = 0; m < messages.length; m++) {
    const msg = messages[m]
    if (m > 0) count++ // separator
    count++ // label
    const paragraphs = msg.content.split('\n')
    for (const para of paragraphs) {
      if (para.trim() === '') {
        count++
        continue
      }
      count += wrapLine(para, contentWidth).length
    }
  }
  return count
}
