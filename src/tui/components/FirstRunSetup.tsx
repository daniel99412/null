import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { AVAILABLE_COLORS, completeSetup } from '../../config/index.js'
import type { AccentColor } from '../../config/index.js'
import { useTheme } from '../context/ThemeContext.js'
import { upsertMemory } from '../../memory/memory-store.js'

const COLOR_LABELS: Record<AccentColor, string> = {
  cyan: 'Cyan',
  green: 'Green',
  blue: 'Blue',
  magenta: 'Magenta',
  yellow: 'Yellow',
  red: 'Red',
  white: 'White',
}

interface FirstRunSetupProps {
  onDone: () => void
}

/**
 * One-time setup screen shown the very first time the TUI is launched.
 * Lets the user set their name (saved as `alias_self` memory so the LLM
 * knows how to address them) and pick a theme color. Esc skips the name.
 */
export function FirstRunSetup({ onDone }: FirstRunSetupProps) {
  const { accent, setAccent } = useTheme()
  const [name, setName] = useState('')
  const [colorIndex, setColorIndex] = useState(() => AVAILABLE_COLORS.indexOf(accent))
  const [saved, setSaved] = useState(false)

  const finish = () => {
    if (saved) return
    setSaved(true)
    const pickedColor = AVAILABLE_COLORS[colorIndex]
    setAccent(pickedColor)
    completeSetup({ userName: name.trim() || undefined, accentColor: pickedColor })
    if (name.trim()) {
      try {
        upsertMemory({
          type: 'alias_self',
          value: name.trim(),
          source: 'explicit',
        })
      } catch {
        // Memory persistence is best-effort during setup; the LLM can still
        // learn the name from future conversation history.
      }
    }
    onDone()
  }

  useInput((char, key) => {
    if (saved) return

    if (key.return) {
      finish()
      return
    }

    if (key.leftArrow) {
      setColorIndex((i) => (i - 1 + AVAILABLE_COLORS.length) % AVAILABLE_COLORS.length)
      return
    }

    if (key.rightArrow) {
      setColorIndex((i) => (i + 1) % AVAILABLE_COLORS.length)
      return
    }

    if (key.backspace || key.delete) {
      setName((n) => n.slice(0, -1))
      return
    }

    // Printable characters only
    if (char && !key.ctrl && !key.meta && char.length === 1 && char.charCodeAt(0) >= 32) {
      setName((n) => (n + char).slice(0, 40))
    }
  })

  const pickedColor = AVAILABLE_COLORS[colorIndex]
  const cols = process.stdout?.columns || 80
  const width = Math.min(60, cols - 4)

  return (
    <Box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
    >
      <Box
        flexDirection="column"
        width={width}
        borderStyle="round"
        borderColor={accent}
        paddingX={2}
        paddingY={1}
        backgroundColor="black"
      >
        <Box marginBottom={1}>
          <Text color={accent} bold>Hola, soy null.</Text>
        </Box>
        <Box marginBottom={1}>
          <Text color="white">Configurémoslo en un minuto. Esto solo aparece la primera vez.</Text>
        </Box>

        <Box flexDirection="column" marginY={1}>
          <Text color="gray">¿Cómo te llamas? (opcional — déjalo vacío para omitir)</Text>
          <Box>
            <Text color={accent}>{'> '}</Text>
            <Text color="white">{name}</Text>
            <Text color={accent} inverse>{' '}</Text>
          </Box>
        </Box>

        <Box flexDirection="column" marginY={1}>
          <Text color="gray">Tema:</Text>
          <Box>
            {AVAILABLE_COLORS.map((c, i) => (
              <Box key={c} marginRight={1}>
                <Text
                  color={c}
                  bold={i === colorIndex}
                  inverse={i === colorIndex}
                >
                  {' '}{COLOR_LABELS[c]}{' '}
                </Text>
              </Box>
            ))}
          </Box>
          <Box>
            <Text color="gray">usa ← → para cambiar</Text>
          </Box>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text color="gray">{'─'.repeat(width - 6)}</Text>
        </Box>

        <Box>
          <Text color="gray">enter </Text>
          <Text color={accent}>guardar y continuar</Text>
        </Box>
        <Box>
          <Text color="gray">esc </Text>
          <Text color="gray">omitir nombre</Text>
        </Box>
      </Box>
    </Box>
  )
}
