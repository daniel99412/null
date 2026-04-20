import React, { createContext, useContext, useState, useCallback } from 'react'
import { loadConfig, setAccentColor as saveAccentColor } from '../../config/index.js'
import type { AccentColor } from '../../config/index.js'

interface ThemeContextValue {
  accent: AccentColor
  setAccent: (color: AccentColor) => void
}

const ThemeContext = createContext<ThemeContextValue>({
  accent: 'cyan',
  setAccent: () => {},
})

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext)
}

interface ThemeProviderProps {
  children: React.ReactNode
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [accent, setAccentState] = useState<AccentColor>(() => loadConfig().accentColor)

  const setAccent = useCallback((color: AccentColor) => {
    setAccentState(color)
    saveAccentColor(color)
  }, [])

  return (
    <ThemeContext value={{ accent, setAccent }}>
      {children}
    </ThemeContext>
  )
}
