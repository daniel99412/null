import type { Agent } from '../agent.types.js'
import { performSearch } from '../search-pipeline.js'

export const webSearchAgent: Agent = {
  id: 'web-search',
  name: 'Web Search Agent',
  description: 'Builds grounded web context for current or explicit search queries.',
  mode: 'deterministic',
  tools: ['web_search', 'web_fetch'],

  async handle(query, context) {
    context.onStatus?.('Searching the web...')

    try {
      const searchText = query.isExplicitSearch
        ? query.text.replace(/^\/search\s+/i, '').trim()
        : query.text
      const result = await performSearch(searchText, query.originalText)

      return {
        userContent: query.isExplicitSearch && result ? searchText : query.text,
        searchContext: result?.contextMessage ?? null,
        statusMessage: 'Searching the web...',
      }
    } catch {
      return {
        userContent: `${query.text}\n\n[Note: Web search failed due to a network error. Answer from your knowledge and mention you could not verify current information.]`,
        searchContext: null,
        statusMessage: 'Searching the web...',
      }
    }
  },
}
