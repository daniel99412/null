import { describe, expect, it } from 'vitest'
import { extractDeterministicMemoriesFromMessage } from '../src/memory/memory-extractor.js'
import { buildGeneralMemoryContext } from '../src/memory/memory-retrieval.js'

describe('deterministic memory extraction', () => {
  it('stores and retrieves the user name without the LLM extractor', () => {
    const extracted = extractDeterministicMemoriesFromMessage('hola, me llamo Test Persona')

    expect(extracted).toContainEqual(expect.objectContaining({
      type: 'alias_self',
      value: 'Test Persona',
    }))

    const context = buildGeneralMemoryContext('cómo me llamo')
    expect(context).toContain('test persona')
  })

  it('retrieves the user name for "quién soy"', () => {
    extractDeterministicMemoriesFromMessage('me llamo Identity Persona')

    const context = buildGeneralMemoryContext('quién soy')
    expect(context).toContain('identity persona')
  })
})
