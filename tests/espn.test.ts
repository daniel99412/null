/**
 * Regression tests for src/tools/espn.ts
 *
 * These tests are purely synchronous / unit-level — no network calls.
 * They cover:
 *   - detectLeague()       → maps natural language to ESPN slugs
 *   - detectDateIntent()   → 'lastMatchday' vs 'range'
 *   - hasExplicitDateRange() → true/false
 *   - detectDateRange()    → correct DateRange for each keyword
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  detectLeague,
  detectDateIntent,
  hasExplicitDateRange,
  detectDateRange,
} from '../src/tools/espn.js'

// ---------------------------------------------------------------------------
// detectLeague
// ---------------------------------------------------------------------------

describe('detectLeague', () => {
  // Liga MX — direct name
  it('liga mx', () => expect(detectLeague('resultados de la liga mx')).toBe('mex.1'))
  it('ligamx', () => expect(detectLeague('ligamx hoy')).toBe('mex.1'))
  it('liga mexicana', () => expect(detectLeague('liga mexicana resultados')).toBe('mex.1'))

  // Liga MX — via team name
  it('america', () => expect(detectLeague('cómo quedó el america')).toBe('mex.1'))
  it('chivas', () => expect(detectLeague('jugaron las chivas')).toBe('mex.1'))
  it('pumas', () => expect(detectLeague('resultado de pumas unam')).toBe('mex.1'))
  it('tigres', () => expect(detectLeague('tigres uanl marcador')).toBe('mex.1'))
  it('rayados', () => expect(detectLeague('partido de rayados')).toBe('mex.1'))
  it('cruz azul', () => expect(detectLeague('marcador de cruz azul')).toBe('mex.1'))
  it('rebaño', () => expect(detectLeague('el rebaño sagrado jugó bien')).toBe('mex.1'))

  // Other leagues
  it('premier league', () => expect(detectLeague('resultados premier league')).toBe('eng.1'))
  it('premier (short)', () => expect(detectLeague('tabla de la premier')).toBe('eng.1'))
  it('la liga', () => expect(detectLeague('la liga española marcadores')).toBe('esp.1'))
  it('bundesliga', () => expect(detectLeague('bundesliga resultados')).toBe('ger.1'))
  it('serie a', () => expect(detectLeague('serie a italia')).toBe('ita.1'))
  it('champions league', () => expect(detectLeague('champions league última jornada')).toBe('uefa.champions'))
  it('mls', () => expect(detectLeague('mls standings')).toBe('usa.1'))

  // Unknown league
  it('returns null for unknown sport', () => expect(detectLeague('cómo estuvo el juego de la nfl')).toBeNull())
  it('returns null for no sport mention', () => expect(detectLeague('qué hora es')).toBeNull())
})

// ---------------------------------------------------------------------------
// detectDateIntent
// ---------------------------------------------------------------------------

describe('detectDateIntent', () => {
  it('última jornada → lastMatchday', () =>
    expect(detectDateIntent('última jornada de la liga mx')).toBe('lastMatchday'))
  it('ultima jornada (no accent) → lastMatchday', () =>
    expect(detectDateIntent('dame la ultima jornada')).toBe('lastMatchday'))
  it('jornada pasada → lastMatchday', () =>
    expect(detectDateIntent('jornada pasada liga mx')).toBe('lastMatchday'))
  it('jornada anterior → lastMatchday', () =>
    expect(detectDateIntent('resultados jornada anterior')).toBe('lastMatchday'))
  it('last matchday → lastMatchday', () =>
    expect(detectDateIntent('last matchday results')).toBe('lastMatchday'))

  // Everything else is 'range'
  it('fin de semana → range', () =>
    expect(detectDateIntent('resultados del fin de semana')).toBe('range'))
  it('semana pasada → range', () =>
    expect(detectDateIntent('resultados semana pasada')).toBe('range'))
  it('hoy → range', () =>
    expect(detectDateIntent('resultados de hoy')).toBe('range'))
  it('generic → range', () =>
    expect(detectDateIntent('resultados de la liga mx')).toBe('range'))
})

// ---------------------------------------------------------------------------
// hasExplicitDateRange
// ---------------------------------------------------------------------------

describe('hasExplicitDateRange', () => {
  it('fin de semana → true', () =>
    expect(hasExplicitDateRange('resultados del fin de semana')).toBe(true))
  it('semana pasada → true', () =>
    expect(hasExplicitDateRange('semana pasada')).toBe(true))
  it('esta semana → true', () =>
    expect(hasExplicitDateRange('esta semana liga mx')).toBe(true))
  it('hoy → true', () =>
    expect(hasExplicitDateRange('marcadores de hoy')).toBe(true))
  it('ayer → true', () =>
    expect(hasExplicitDateRange('resultados de ayer')).toBe(true))
  it('últimos → true', () =>
    expect(hasExplicitDateRange('últimos resultados')).toBe(true))
  it('ultimos (no accent) → true', () =>
    expect(hasExplicitDateRange('ultimos partidos')).toBe(true))
  it('próximos → true', () =>
    expect(hasExplicitDateRange('próximos partidos')).toBe(true))
  it('última jornada → true', () =>
    expect(hasExplicitDateRange('última jornada')).toBe(true))
  it('jornada 15 → true', () =>
    expect(hasExplicitDateRange('jornada 15')).toBe(true))

  // No explicit date
  it('generic query → false', () =>
    expect(hasExplicitDateRange('resultados de la liga mx')).toBe(false))
  it('team name only → false', () =>
    expect(hasExplicitDateRange('marcador del america')).toBe(false))
})

// ---------------------------------------------------------------------------
// detectDateRange
// ---------------------------------------------------------------------------

describe('detectDateRange', () => {
  // Helper: get day-of-week name
  const dayName = (d: Date) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]

  it('semana pasada → starts on Monday', () => {
    const { from } = detectDateRange('resultados semana pasada')
    expect(dayName(from)).toBe('Mon')
  })

  it('semana pasada → ends on Sunday', () => {
    const { to } = detectDateRange('resultados semana pasada')
    expect(dayName(to)).toBe('Sun')
  })

  it('semana pasada → 7 days range', () => {
    const { from, to } = detectDateRange('resultados semana pasada')
    const days = Math.round((to.getTime() - from.getTime()) / 86400000)
    expect(days).toBe(6)
  })

  it('fin de semana → starts on Friday', () => {
    const { from } = detectDateRange('resultados del fin de semana')
    expect(dayName(from)).toBe('Fri')
  })

  it('fin de semana → ends on Sunday', () => {
    const { to } = detectDateRange('resultados del fin de semana')
    expect(dayName(to)).toBe('Sun')
  })

  it('fin de semana → 3 days span (Fri, Sat, Sun)', () => {
    const { from, to } = detectDateRange('fin de semana')
    const days = Math.round((to.getTime() - from.getTime()) / 86400000)
    expect(days).toBe(3)
  })

  it('hoy → from and to are same day', () => {
    const { from, to } = detectDateRange('resultados de hoy')
    expect(from.toDateString()).toBe(to.toDateString())
  })

  it('ayer → from is yesterday', () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const { from } = detectDateRange('resultados de ayer')
    expect(from.toDateString()).toBe(yesterday.toDateString())
  })

  it('últimos → range ends today', () => {
    const today = new Date()
    const { to } = detectDateRange('últimos resultados')
    expect(to.toDateString()).toBe(today.toDateString())
  })

  it('últimos → range is approximately 7 days back (from midnight)', () => {
    const { from, to } = detectDateRange('últimos resultados')
    // from = 7 days ago at midnight, to = now → diff is 7–8 days depending on time of day
    const days = (to.getTime() - from.getTime()) / 86400000
    expect(days).toBeGreaterThanOrEqual(7)
    expect(days).toBeLessThan(8)
  })

  it('próximos → range starts today or later', () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const { from } = detectDateRange('próximos partidos')
    expect(from.getTime()).toBeGreaterThanOrEqual(today.getTime())
  })

  it('próximos → range is 7 days forward', () => {
    const { from, to } = detectDateRange('próximos partidos')
    const days = Math.round((to.getTime() - from.getTime()) / 86400000)
    expect(days).toBe(7)
  })

  it('esta semana → starts on Monday', () => {
    const { from } = detectDateRange('esta semana liga mx')
    expect(dayName(from)).toBe('Mon')
  })

  it('esta semana → ends on Sunday', () => {
    const { to } = detectDateRange('esta semana liga mx')
    expect(dayName(to)).toBe('Sun')
  })
})
