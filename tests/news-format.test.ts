import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildArticleContext, performSearch, type FetchedArticle } from '../src/core/agent.js'
import { getCachedSearch, setCachedSearch } from '../src/memory/search-cache.js'

vi.mock('../src/memory/search-cache.js', () => ({
  getCachedSearch: vi.fn(),
  setCachedSearch: vi.fn(),
}))

vi.mock('../src/tools/web-fetch.js', () => ({
  fetchPageText: vi.fn(async (url: string) => `Fetched content for ${url}. `.repeat(30)),
}))

vi.mock('../src/core/tools.js', () => ({
  tools: {
    web_search: vi.fn(async (_query: string, limit?: number) => ({
      query: _query,
      extract: null,
      results: Array.from({ length: limit ?? 5 }, (_, index) => ({
        title: `Result ${index + 1}`,
        url: index < 8
          ? `https://cnn.com/story-${index + 1}`
          : `https://source${index + 1}.com/story`,
        snippet: `Snippet ${index + 1}`,
      })),
    })),
    get_time: vi.fn(),
    get_location: vi.fn(),
    get_weather: vi.fn(),
    web_fetch: vi.fn(),
  },
}))

describe('news article context', () => {
  beforeEach(() => {
    vi.mocked(getCachedSearch).mockReturnValue(null)
    vi.mocked(setCachedSearch).mockClear()
  })

  it('requests terminal cards with summaries and estimated alignment for news queries', () => {
    const articles: FetchedArticle[] = Array.from({ length: 10 }, (_, index) => ({
      title: `Noticia ${index + 1}`,
      url: `https://example${index + 1}.com/story`,
      content: `Contenido de la noticia ${index + 1}.`,
    }))

    const context = buildArticleContext(articles, 'últimas noticias de México')

    expect(context).toContain('Format the answer as exactly 10 terminal-friendly news cards')
    expect(context).toContain('one card represents exactly one article')
    expect(context).toContain('┌─ <category> · <source>')
    expect(context).toContain('│ Titular: <headline')
    expect(context).toContain('│ Resumen: <1-2 sentence summary')
    expect(context).toContain('│ Inclinación: <izquierda|centro|derecha|no estimable>')
    expect(context).toContain('Every card MUST include all three labeled fields')
    expect(context).toContain('Bad format: a card with only two unlabeled lines')
    expect(context).toContain('Do NOT claim this is verified by an external rating service')
    expect(context).toContain('For health, entertainment, technology, education, weather, or general service stories, write "no estimable"')
    expect(context).toContain('Source: example1.com')
  })

  it('requests a larger search pool and diversifies repeated sources for news', async () => {
    const result = await performSearch('últimas noticias de México', 'últimas noticias de México')

    expect(result?.contextMessage).toContain('Source: cnn.com')
    expect(result?.contextMessage.match(/Source: cnn\.com/g)).toHaveLength(2)
    expect(result?.contextMessage).toContain('Source: source9.com')
  })
})
