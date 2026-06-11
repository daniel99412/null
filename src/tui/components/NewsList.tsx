import React, { useMemo, useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { useTheme } from '../context/ThemeContext.js'
import type { DigestArticle } from './ArticleReader.js'

interface NewsListProps {
  articles: DigestArticle[]
  onOpenArticle: (article: DigestArticle) => void
  onClose: () => void
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  return value.slice(0, Math.max(0, max - 3)) + '...'
}

function sourceLabel(url: string, source: string): string {
  if (source) return source
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function NewsList({ articles, onOpenArticle, onClose }: NewsListProps) {
  const { accent } = useTheme()
  const [selectedIndex, setSelectedIndex] = useState(0)

  const clamped = Math.min(selectedIndex, Math.max(0, articles.length - 1))
  if (clamped !== selectedIndex) setSelectedIndex(clamped)

  const selected = useMemo(() => articles[selectedIndex], [articles, selectedIndex])

  useInput((char, key) => {
    if (key.escape) {
      onClose()
      return
    }

    if (key.upArrow || char === 'k') {
      setSelectedIndex((i) => Math.max(0, i - 1))
      return
    }

    if (key.downArrow || char === 'j') {
      setSelectedIndex((i) => Math.min(articles.length - 1, i + 1))
      return
    }

    if (key.return) {
      const article = articles[selectedIndex]
      if (article) onOpenArticle(article)
      return
    }

    if (char === 'g' || key.home) {
      setSelectedIndex(0)
      return
    }

    if (char === 'G' || key.end) {
      setSelectedIndex(Math.max(0, articles.length - 1))
    }
  })

  const cols = process.stdout?.columns || 80
  const rows = process.stdout?.rows || 24
  const width = Math.min(84, cols - 4)
  const maxItems = Math.min(articles.length, rows - 10)
  const windowStart = Math.max(0, selectedIndex - maxItems + 1)
  const visibleItems = articles.slice(windowStart, windowStart + maxItems)

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
        <Box justifyContent="space-between" marginBottom={1}>
          <Text color={accent} bold>News List</Text>
          <Text color="gray">{articles.length} articles</Text>
        </Box>

        <Box>
          <Text color="gray">{'─'.repeat(width - 4)}</Text>
        </Box>

        {visibleItems.length === 0 ? (
          <Box paddingY={1}>
            <Text color="gray">No news articles available.</Text>
          </Box>
        ) : (
          visibleItems.map((article, index) => {
            const actualIndex = windowStart + index
            const isSelected = actualIndex === selectedIndex
            const src = sourceLabel(article.url, article.source)
            return (
              <Box key={`${article.position}-${article.title}`} paddingX={1}>
                <Box flexDirection="column" width={width - 4}>
                  <Text
                    color={isSelected ? accent : 'white'}
                    bold={isSelected}
                    inverse={isSelected}
                  >
                    {truncate(`${article.position}. ${article.title}`, width - 10)}
                  </Text>
                  <Text color="gray" dimColor={!isSelected}>
                    {truncate(`${src} · ${article.category}`, width - 10)}
                  </Text>
                </Box>
              </Box>
            )
          })
        )}

        <Box>
          <Text color="gray">{'─'.repeat(width - 4)}</Text>
        </Box>

        <Box justifyContent="space-between">
          <Text color="gray">enter open  esc close</Text>
          {selected ? <Text color="gray">{selected.position}/{articles.length}</Text> : null}
        </Box>
      </Box>
    </Box>
  )
}
