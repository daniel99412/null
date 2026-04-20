/**
 * Regression tests for src/utils/normalize.ts
 */

import { describe, it, expect } from 'vitest'
import { normalizeQuery } from '../src/utils/normalize.js'

describe('normalizeQuery', () => {
  it('lowercases the query', () =>
    expect(normalizeQuery('HELLO WORLD')).toBe('hello world'))

  it('trims leading/trailing whitespace', () =>
    expect(normalizeQuery('  hello  ')).toBe('hello'))

  it('collapses multiple spaces into one', () =>
    expect(normalizeQuery('hello   world')).toBe('hello world'))

  it('removes opening Spanish punctuation ¿ and ¡ (trailing ? is also stripped)', () =>
    expect(normalizeQuery('¿qué hora es?')).toBe('qué hora es'))

  it('removes trailing punctuation . , ; : ! ?', () => {
    expect(normalizeQuery('hola mundo.')).toBe('hola mundo')
    expect(normalizeQuery('qué es esto?')).toBe('qué es esto')
    expect(normalizeQuery('hola!')).toBe('hola')
  })

  it('preserves accented characters', () =>
    expect(normalizeQuery('última jornada')).toBe('última jornada'))

  it('handles empty string', () =>
    expect(normalizeQuery('')).toBe(''))

  it('handles combination of issues', () =>
    expect(normalizeQuery('  ¿Cuál es la CAPITAL de México?  ')).toBe('cuál es la capital de méxico'))
})
