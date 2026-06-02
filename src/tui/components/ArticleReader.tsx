import React, { useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'
import { fetchPageText } from '../../tools/web-fetch.js'
import { useTheme } from '../context/ThemeContext.js'

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

const MAX_CONTENT_CHARS = 6000

export function ArticleReader({ article, onClose }: ArticleReaderProps) {
  const { accent } = useTheme()
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
        setContent(text.slice(0, MAX_CONTENT_CHARS))
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

  useInput((char, key) => {
    if (key.escape || char === 'q' || char === 'Q') {
      onClose()
      return
    }
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={accent} paddingX={1} flexGrow={1}>
      <Box justifyContent="space-between" marginBottom={1}>
        <Text color={accent} bold>
          ┌─ {article.category} · {article.source}
        </Text>
        <Text color="gray">[esc/q] cerrar</Text>
      </Box>

      <Box marginBottom={1} flexDirection="column">
        <Text color="white" bold>{article.title}</Text>
        <Text color="gray">{article.url}</Text>
      </Box>

      <Box flexDirection="column" flexGrow={1}>
        {status === 'loading' && (
          <Text color="gray">Cargando artículo…</Text>
        )}
        {status === 'error' && (
          <Text color="red">Error: {error}</Text>
        )}
        {status === 'ready' && (
          <Text color="white">{content}</Text>
        )}
      </Box>
    </Box>
  )
}
