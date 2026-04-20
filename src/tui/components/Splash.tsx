import React, { useEffect, useState } from 'react'
import { Box, Text } from 'ink'
import figlet from 'figlet'
import { useTheme } from '../context/ThemeContext.js'

const LOGO = figlet.textSync('null', {
  font: 'ANSI Shadow',
  horizontalLayout: 'default',
  verticalLayout: 'default',
  width: 80,
})

const LOGO_LINES = LOGO.split('\n')
const TOTAL_CHARS = LOGO.length

interface SplashProps {
  onDone: () => void
}

export function Splash({ onDone }: SplashProps) {
  const { accent } = useTheme()
  const [charIndex, setCharIndex] = useState(0)
  const [showTagline, setShowTagline] = useState(false)
  const [fadeOut, setFadeOut] = useState(false)

  useEffect(() => {
    if (charIndex >= TOTAL_CHARS) {
      const taglineTimer = setTimeout(() => setShowTagline(true), 200)
      return () => clearTimeout(taglineTimer)
    }
    const speed = Math.max(2, 8 - Math.floor(charIndex / 30))
    const timer = setTimeout(() => {
      setCharIndex((i) => Math.min(i + 3, TOTAL_CHARS))
    }, speed)
    return () => clearTimeout(timer)
  }, [charIndex])

  useEffect(() => {
    if (!showTagline) return
    const timer = setTimeout(() => setFadeOut(true), 600)
    return () => clearTimeout(timer)
  }, [showTagline])

  useEffect(() => {
    if (!fadeOut) return
    const timer = setTimeout(onDone, 300)
    return () => clearTimeout(timer)
  }, [fadeOut, onDone])

  const rows = process.stdout?.rows || 24
  const topPad = Math.max(0, Math.floor((rows - LOGO_LINES.length - 4) / 2))

  const revealed = LOGO.slice(0, charIndex)
  const revealedLines = revealed.split('\n')

  return (
    <Box flexDirection="column" height={rows}>
      <Box height={topPad} />
      <Box flexDirection="column" alignItems="center">
        {LOGO_LINES.map((_, i) => (
          <Text key={i} color={fadeOut ? 'gray' : accent} bold dimColor={fadeOut}>
            {revealedLines[i] || ''}
          </Text>
        ))}
      </Box>
      <Box height={1} />
      <Box justifyContent="center">
        <Text color={fadeOut ? 'gray' : 'white'} dimColor={fadeOut}>
          {showTagline ? 'Your private AI secretary, running locally.' : ''}
        </Text>
      </Box>
      <Box justifyContent="center">
        <Text color="gray" dimColor>
          {showTagline ? 'v0.1.0' : ''}
        </Text>
      </Box>
    </Box>
  )
}
