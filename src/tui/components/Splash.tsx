import React, { useEffect, useState, useMemo } from 'react'
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
const VOCHO_BLINK = [' .(___).', '(-\\_|_-)']

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

interface SplashProps {
  onDone: () => void
}

export function Splash({ onDone }: SplashProps) {
  const { accent } = useTheme()
  const [breath, setBreath] = useState(false)
  const [blink, setBlink] = useState(false)
  const [fadeOut, setFadeOut] = useState(false)

  useEffect(() => {
    const interval = setInterval(() => setBreath(b => !b), 2000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (fadeOut) return
    const timer = setTimeout(() => {
      setBlink(true)
      setTimeout(() => setBlink(false), 150)
    }, 3000 + Math.random() * 3000)
    return () => clearTimeout(timer)
  }, [blink, fadeOut])

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
  const vocho = blink ? VOCHO_BLINK : VOCHO_NORMAL
  const lines = useMemo(() => buildCombined(vocho), [vocho])

  return (
    <Box flexDirection="column" height={rows}>
      <Box height={topPad} />
      <Box flexDirection="column" alignItems="center">
        {lines.map((line, i) => (
          <Text
            key={i}
            color={fadeOut ? 'gray' : accent}
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
