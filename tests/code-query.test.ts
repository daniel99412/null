import { describe, expect, it } from 'vitest'
import { isCodeQuery } from '../src/core/code-query.js'

describe('isCodeQuery', () => {
  it('detects code and implementation requests', () => {
    expect(isCodeQuery('implementa una función en TypeScript')).toBe(true)
    expect(isCodeQuery('debug this stack trace')).toBe(true)
    expect(isCodeQuery('arregla src/core/router.ts')).toBe(true)
  })

  it('does not route normal assistant questions to the code model', () => {
    expect(isCodeQuery('qué clima hay hoy')).toBe(false)
    expect(isCodeQuery('dame las últimas noticias')).toBe(false)
    expect(isCodeQuery('qué hora es')).toBe(false)
  })
})
