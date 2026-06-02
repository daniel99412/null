import React, { useState, useEffect, useMemo } from 'react'
import { Box, Text, useInput, useWindowSize } from 'ink'
import { fetchPageText } from '../../tools/web-fetch.js'
import { useTheme } from '../context/ThemeContext.js'
import { useScroll } from '../hooks/useScroll.js'
import { wrapText } from '../utils/text.js'

export interface DigestArticle {
  position: number
  title: string
  url: string
  source: string
  category: string
}

interface ArticleReaderProps {
  article: DigestArticle
  onClose: () => void
}

type Status = 'loading' | 'ready' | 'error'

const MAX_CONTENT_CHARS = 12000
const HEADER_LINES = 5   // top border + category + title + url + spacer
const FOOTER_LINES = 2   // scroll indicator + bottom border

export function ArticleReader({ article, onClose }: ArticleReaderProps) {
  const { accent } = useTheme()
  const { columns, rows } = useWindowSize()
  const [status, setStatus] = useState<Status>('loading')
  const [content, setContent] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setContent('')
    setError(null)

    fetchPageText(article.url, { maxChars: MAX_CONTENT_CHARS })
      .then((text) => {
        if (cancelled) return
        if (!text || text.length < 50) {
          setError('No se pudo extraer contenido legible del artículo.')
          setStatus('error')
          return
        }
        setContent(text)
        setStatus('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        setStatus('error')
      })

    return () => { cancelled = true }
  }, [article.url])

  // Wrap content to fit the available width.
  // Width accounts for the rounded border (2 chars) + paddingX (2 chars each side).
  // Window dimensions — leave some breathing room around the modal.
  const windowWidth = Math.min(120, Math.max(60, Math.floor(columns * 0.85)))
  const windowHeight = Math.max(12, Math.floor(rows * 0.85))
  const innerWidth = Math.max(20, windowWidth - 6) // border (2) + paddingX (2 each side)

  const allLines = useMemo(() => {
    if (status !== 'ready') return []
    return wrapText(content, innerWidth)
  }, [content, innerWidth, status])

  const visibleHeight = Math.max(3, windowHeight - HEADER_LINES - FOOTER_LINES)
  const {
    visibleLines,
    isAtBottom,
    handleUp,
    handleDown,
    resetScroll,
  } = useScroll(allLines, { maxLines: visibleHeight })

  useEffect(() => {
    resetScroll()
  }, [article.url, resetScroll])

  useInput((char, key) => {
    if (key.escape || char === 'q' || char === 'Q') {
      onClose()
      return
    }

    if (status !== 'ready') return

    // Vim-like + arrow nav
    if (key.upArrow || char === 'k') {
      handleUp()
      return
    }
    if (key.downArrow || char === 'j') {
      handleDown()
      return
    }
    if (key.pageUp || char === 'b') {
      for (let i = 0; i < Math.max(1, Math.floor(visibleHeight / 2)); i++) handleUp()
      return
    }
    if (key.pageDown || char === ' ' || char === 'f') {
      for (let i = 0; i < Math.max(1, Math.floor(visibleHeight / 2)); i++) handleDown()
      return
    }
    if (char === 'g' || key.home) {
      // Jump to top
      while (!isAtBottom) handleDown()
      return
    }
    if (char === 'G' || key.end) {
      // Jump to bottom
      for (let i = 0; i < 9999; i++) handleUp()
      return
    }
  })

  const lineInfo = status === 'ready' && allLines.length > 0
    ? `${allLines.length} líneas${isAtBottom ? ' · final' : ' · sigue para ver más'}`
    : ''

  return (
    <Box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
    >
      <Box
        flexDirection="column"
        width={windowWidth}
        height={windowHeight}
        borderStyle="round"
        borderColor={accent}
        paddingX={1}
        backgroundColor="black"
      >
        <Box justifyContent="space-between">
          <Text color={accent} bold>
            {article.category} · {article.source}
          </Text>
          <Text color="gray">[esc] cerrar  [↑↓] scroll  [space] página</Text>
        </Box>

        <Box flexDirection="column" marginY={1}>
          <Text color="white" bold wrap="wrap">{article.title}</Text>
          <Text color="gray" wrap="truncate-end">{article.url}</Text>
        </Box>

        <Box flexDirection="column" flexGrow={1} overflow="hidden">
          {status === 'loading' && (
            <Text color="gray">Cargando artículo…</Text>
          )}
          {status === 'error' && (
            <Text color="red">Error: {error}</Text>
          )}
          {status === 'ready' && (
            <Box flexDirection="column">
              {visibleLines.map((line, i) => (
                <Text key={i} color="white">{line || ' '}</Text>
              ))}
            </Box>
          )}
        </Box>

        <Box justifyContent="space-between">
          <Text color="gray">{lineInfo}</Text>
          <Text color="gray">artículo {article.position}</Text>
        </Box>
      </Box>
    </Box>
  )
}
