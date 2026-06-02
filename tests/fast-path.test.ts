import { describe, expect, it } from 'vitest'
import { isFastPathConversation } from '../src/core/fast-path.js'
import { processQuery } from '../src/core/agent.js'

describe('fast path conversation', () => {
  it('detects simple conversational messages', () => {
    expect(isFastPathConversation('hola')).toBe(true)
    expect(isFastPathConversation('gracias')).toBe(true)
    expect(isFastPathConversation('quién eres?')).toBe(true)
  })

  it('does not fast-path local document requests', () => {
    expect(isFastPathConversation('resume @README.md')).toBe(false)
  })

  it('bypasses router/ReAct for hola', async () => {
    const result = await processQuery('hola')
    expect(result.userContent).toBe('hola')
    expect(result.searchContext).toBeNull()
    expect(result.useReAct).toBe(false)
  })

  it('obvious tool queries still route heuristically', async () => {
    const result = await processQuery('qué hora es')
    expect(result.userContent).toContain('Current time:')
    expect(result.useReAct).toBeUndefined()
  })
})
