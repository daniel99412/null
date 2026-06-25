import React, { useEffect, useState, useMemo, useCallback } from 'react'
import { Box, Text } from 'ink'
import figlet from 'figlet'
import { useTheme } from '../context/ThemeContext.js'

const LOGO = figlet.textSync('null', {
  font: 'Small Slant',
  horizontalLayout: 'default',
  verticalLayout: 'default',
  width: 80,
})

const RAW_LINES = LOGO.split('\n')

const VOCHO_NORMAL = [' .(___).', '(o\\_|_/o)']
const VOCHO_BLINK = [' .(___).', '(-\\_|_/-)']
const VOCHO_WINK = [' .(___).', '(-\\_|_/o)']

const GAP = 4

function buildCombined(vocho: string[]): string[] {
  const combined: string[] = []
  for (let i = 0; i < RAW_LINES.length; i++) {
    if (i >= 2 && i <= 3) {
      combined.push(RAW_LINES[i] + ' '.repeat(GAP) + vocho[i - 2])
    } else {
      combined.push(RAW_LINES[i])
    }
  }
  const maxW = Math.max(...combined.map(l => l.length))
  return combined.map(l => l.padEnd(maxW))
}

interface AnimFrame {
  vocho: string[]
  ms: number
}

const ANIMATION: AnimFrame[] = [
  { vocho: VOCHO_NORMAL, ms: 700 },
  { vocho: VOCHO_BLINK, ms: 150 },
  { vocho: VOCHO_NORMAL, ms: 800 },
  { vocho: VOCHO_BLINK, ms: 150 },
  { vocho: VOCHO_NORMAL, ms: 700 },
  { vocho: VOCHO_WINK, ms: 200 },
  { vocho: VOCHO_NORMAL, ms: 300 },
  { vocho: VOCHO_NORMAL, ms: 500 },
]

interface SplashProps {
  onDone: () => void
}

export function Splash({ onDone }: SplashProps) {
  const { accent } = useTheme()
  const [breath, setBreath] = useState(false)
  const [frame, setFrame] = useState(0)
  const [fadeOut, setFadeOut] = useState(false)

  const advance = useCallback(() => {
    setFrame(f => Math.min(f + 1, ANIMATION.length - 1))
  }, [])

  useEffect(() => {
    const interval = setInterval(() => setBreath(b => !b), 2000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const timer = setTimeout(advance, ANIMATION[frame].ms)
    return () => clearTimeout(timer)
  }, [frame, advance])

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFadeOut(true), 3500)
    const doneTimer = setTimeout(onDone, 3800)
    return () => {
      clearTimeout(fadeTimer)
      clearTimeout(doneTimer)
    }
  }, [onDone])

  const rows = process.stdout?.rows || 24
  const topPad = Math.max(0, Math.floor((rows - RAW_LINES.length - 2) / 2))
  const lines = useMemo(() => buildCombined(ANIMATION[frame].vocho), [frame])

  return (
    <Box flexDirection="column" height={rows}>
      <Box height={topPad} />
      <Box flexDirection="column" alignItems="center">
        {lines.map((line, i) => (
          <Text
            key={i}
            color={accent}
            bold
            dimColor={fadeOut || (breath && !fadeOut)}
          >
            {line}
          </Text>
        ))}
      </Box>

    </Box>
  )
}
