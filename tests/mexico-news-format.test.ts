import { describe, expect, it } from 'vitest'
import { formatDigest } from '../src/tools/mexico-news.js'
import type { NewsStory } from '../src/tools/news-cluster.js'

function story(index: number): NewsStory {
  return {
    title: `Nota ${index}`,
    category: 'Política',
    publishedAt: '2026-06-09T12:00:00.000Z',
    sources: ['El Financiero'],
    relevanceScore: 1,
    minutesAgo: 30,
    articles: [{
      source: 'El Financiero',
      sourceId: index,
      biasBase: 5.5,
      reliability: 0.9,
      title: `Nota ${index}`,
      url: `https://example.com/${index}`,
      snippet: `Resumen de la nota ${index}`,
      publishedAt: '2026-06-09T12:00:00.000Z',
      category: 'Política',
    }],
  }
}

describe('Mexico news digest formatting', () => {
  it('shows keyboard numbers on each news card', () => {
    const formatted = formatDigest(
      Array.from({ length: 10 }, (_, index) => story(index + 1)),
      new Date('2026-06-09T18:00:00.000Z'),
      'México',
    )

    expect(formatted).toContain('┌─(1) Política · El Financiero')
    expect(formatted).toContain('┌─(9) Política · El Financiero')
    expect(formatted).toContain('┌─(0) Política · El Financiero')
  })
})
