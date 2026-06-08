import React from 'react'
import { Box, Text } from 'ink'
import { renderMarkdown } from '../../utils/markdown.js'
import { useTheme } from '../context/ThemeContext.js'
import type { AccentColor } from '../../config/index.js'
import stringWidth from 'string-width'
import stripAnsi from 'strip-ansi'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'recall'
  content: string
}

interface MessageListProps {
  messages: ChatMessage[]
  visibleStart: number
  visibleCount: number
  terminalWidth: number
  dimmed?: boolean
}

/**
 * Wrap a line of text (possibly containing ANSI codes) to fit within `width` visual columns.
 * Splits on word boundaries. If a single word exceeds `width`, it is hard-split.
 */
function wrapLine(text: string, width: number): string[] {
  const visualLen = stringWidth(text)
  if (visualLen <= width) return [text]

  // Strip ANSI to work with plain text for splitting, then reconstruct
  const plain = stripAnsi(text)

  // If the text has ANSI codes, we need a different strategy:
  // split the plain text into wrapped lines, then for each plain line
  // find its position in the original and extract with ANSI codes.
  // However, this is complex. A simpler approach for assistant messages
  // (which have ANSI) is to split on words from the plain text.

  const hasAnsi = plain.length !== text.length

  if (!hasAnsi) {
    return wrapPlainLine(text, width)
  }

  // For ANSI text: wrap the plain text, then map back to ANSI substrings
  const plainWrapped = wrapPlainLine(plain, width)

  // Build a char-index map: for each plain char index, find its position in the original
  const ansiMap = buildAnsiMap(text, plain)

  const result: string[] = []
  let plainOffset = 0

  for (const plainLine of plainWrapped) {
    const lineLen = plainLine.length
    const start = plainOffset
    const end = plainOffset + lineLen

    // Extract the ANSI-rich substring for this range
    const ansiLine = extractAnsiSubstring(text, ansiMap, start, end)
    result.push(ansiLine)

    // Advance past the plain line content + any whitespace that was between words
    plainOffset = end
    // Skip leading space of next line (from word-wrap split)
    while (plainOffset < plain.length && plain[plainOffset] === ' ') {
      plainOffset++
    }
  }

  return result.length > 0 ? result : [text]
}

/**
 * Wrap a plain text line (no ANSI codes) to fit within `width`.
 */
function wrapPlainLine(text: string, width: number): string[] {
  if (stringWidth(text) <= width) return [text]

  const result: string[] = []
  const words = text.split(' ')
  let line = ''

  for (const word of words) {
    if (!word) continue

    const wordWidth = stringWidth(word)

    // Hard-split words that exceed width
    if (wordWidth > width) {
      if (line) {
        result.push(line)
        line = ''
      }
      // Break the word into chunks
      let remaining = word
      while (stringWidth(remaining) > width) {
        result.push(remaining.slice(0, width))
        remaining = remaining.slice(width)
      }
      if (remaining) line = remaining
      continue
    }

    const testLine = line ? line + ' ' + word : word
    if (stringWidth(testLine) > width) {
      if (line) result.push(line)
      line = word
    } else {
      line = testLine
    }
  }

  if (line) result.push(line)
  return result.length > 0 ? result : ['']
}

/**
 * Build a mapping from plain text char indices to original (ANSI-containing) string positions.
 * Returns an array where ansiMap[plainIndex] = originalIndex of that plain char.
 */
function buildAnsiMap(original: string, plain: string): number[] {
  const map: number[] = []
  let oi = 0

  for (let pi = 0; pi < plain.length; pi++) {
    // Skip ANSI escape sequences in the original
    while (oi < original.length) {
      if (original[oi] === '\x1B') {
        // Skip the entire escape sequence
        while (oi < original.length && !isAnsiTerminator(original[oi], oi > 0 && original[oi - 1] === '\x1B')) {
          oi++
        }
        if (oi < original.length) oi++ // skip the terminator
      } else {
        break
      }
    }
    map.push(oi)
    oi++
  }

  return map
}

function isAnsiTerminator(char: string, _afterEsc: boolean): boolean {
  // ANSI CSI sequences end with a letter (A-Z, a-z)
  const code = char.charCodeAt(0)
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

/**
 * Extract a substring from an ANSI-containing string based on plain text positions.
 * Preserves all ANSI codes that appear in the range and any open sequences.
 */
function extractAnsiSubstring(original: string, ansiMap: number[], plainStart: number, plainEnd: number): string {
  if (ansiMap.length === 0) return ''

  const origStart = plainStart < ansiMap.length ? ansiMap[plainStart] : original.length
  // Find the end position: after the last plain char in range
  let origEnd: number
  if (plainEnd <= 0) return ''
  if (plainEnd - 1 < ansiMap.length) {
    origEnd = ansiMap[plainEnd - 1] + 1
    // Include any trailing ANSI codes after the last char
    while (origEnd < original.length && original[origEnd] === '\x1B') {
      while (origEnd < original.length) {
        origEnd++
        if (origEnd < original.length) {
          const code = original.charCodeAt(origEnd)
          if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) {
            origEnd++
            break
          }
        }
      }
    }
  } else {
    origEnd = original.length
  }

  // Also include any ANSI codes that appear just before origStart (open sequences)
  let actualStart = origStart
  // Walk backwards to capture any ANSI sequences that precede this range
  // but are part of formatting that applies to this text
  const prefix = original.slice(0, origStart)
  const ansiRegex = /\x1B\[[0-9;]*m/g
  let activeAnsi = ''
  let match: RegExpExecArray | null
  while ((match = ansiRegex.exec(prefix)) !== null) {
    const code = match[0]
    if (code === '\x1B[0m' || code === '\x1B[39m' || code === '\x1B[49m') {
      activeAnsi = ''
    } else {
      activeAnsi += code
    }
  }

  return activeAnsi + original.slice(actualStart, origEnd)
}

interface RenderLine {
  text: string
  role: 'user' | 'assistant' | 'recall'
  isLabel: boolean
  isSeparator: boolean
}

function buildLines(messages: ChatMessage[], contentWidth: number): RenderLine[] {
  const allLines: RenderLine[] = []

  for (const msg of messages) {
    if (allLines.length > 0) {
      allLines.push({ text: '', role: msg.role, isLabel: false, isSeparator: true })
    }

    // Role label
    const label = msg.role === 'user' ? 'You' : msg.role === 'recall' ? 'recall' : 'null'
    allLines.push({ text: label, role: msg.role, isLabel: true, isSeparator: false })

    // Content
    const renderedContent = msg.role === 'assistant'
      ? renderMarkdown(msg.content)
      : msg.content
    const paragraphs = renderedContent.split('\n')
    for (const para of paragraphs) {
      if (para === '') {
        allLines.push({ text: '', role: msg.role, isLabel: false, isSeparator: false })
        continue
      }
      const wrapped = wrapLine(para, contentWidth)
      for (const wl of wrapped) {
        allLines.push({ text: wl, role: msg.role, isLabel: false, isSeparator: false })
      }
    }
  }

  return allLines
}

function getBarColor(role: 'user' | 'assistant' | 'recall', accent: AccentColor): string {
  if (role === 'user') return accent
  if (role === 'recall') return 'yellow'
  return 'gray'
}

function renderMessageText(line: RenderLine, accent: AccentColor, dimmed: boolean): React.ReactNode {
  if (line.role !== 'user') {
    return (
      <Text color={line.role === 'recall' ? 'yellowBright' : 'white'} dimColor={dimmed} wrap="wrap">
        {line.text}
      </Text>
    )
  }

  const parts: React.ReactNode[] = []
  const pattern = /@(?:"[^"]+"|'[^']+'|[^\s]+)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(line.text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <Text key={`plain-${lastIndex}`} color="white" dimColor={dimmed}>
          {line.text.slice(lastIndex, match.index)}
        </Text>,
      )
    }
    parts.push(
      <Text key={`file-${match.index}`} color={accent} dimColor={dimmed}>
        {match[0]}
      </Text>,
    )
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < line.text.length) {
    parts.push(
      <Text key={`plain-${lastIndex}`} color="white" dimColor={dimmed}>
        {line.text.slice(lastIndex)}
      </Text>,
    )
  }

  return <Text wrap="wrap">{parts.length > 0 ? parts : line.text}</Text>
}

export function MessageList({
  messages,
  visibleStart,
  visibleCount,
  terminalWidth,
  dimmed = false,
}: MessageListProps) {
  const { accent } = useTheme()
  // 4 = paddingX(1) * 2 + bar('┃ ' = 2) + some margin
  const contentWidth = Math.max(40, terminalWidth - 6)
  const allLines = buildLines(messages, contentWidth)

  const totalLines = allLines.length
  const start = Math.max(0, totalLines - visibleCount - visibleStart)
  const visible = allLines.slice(start, start + visibleCount)

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
      {visible.map((line, i) => {
        if (line.isSeparator) {
          return <Box key={start + i} height={1} />
        }

        const barColor = getBarColor(line.role, accent)

        if (line.isLabel) {
          return (
            <Box key={start + i} flexDirection="row">
              <Text color={barColor} dimColor={dimmed}>{'┃ '}</Text>
              <Text color={barColor} bold dimColor={dimmed}>{line.text}</Text>
            </Box>
          )
        }

        return (
          <Box key={start + i} flexDirection="row">
            <Text color={barColor} dimColor={dimmed}>{'┃ '}</Text>
            {renderMessageText(line, accent, dimmed)}
          </Box>
        )
      })}
    </Box>
  )
}

export function countRenderedLines(
  messages: ChatMessage[],
  terminalWidth: number,
): number {
  const contentWidth = Math.max(40, terminalWidth - 6)
  const lines = buildLines(messages, contentWidth)
  return lines.length
}
