import type { Agent } from '../agent.types.js'
import { buildSportsContext } from '../../tools/sports.js'
import { buildSportsMemoryContext } from '../../memory/memory-retrieval.js'
import { performSearch } from '../search-pipeline.js'
import { debugLog } from '../../utils/debug.js'

function memoryValues(memoryContext: string): string {
  return memoryContext
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.replace(/^- \w+:\s*/, ''))
    .join(' ')
}

export const sportsAgent: Agent = {
  id: 'sports',
  name: 'Sports Agent',
  description: 'Fetches scores, standings, fixtures, and sports news context.',
  mode: 'deterministic',
  tools: ['web_search', 'web_fetch'],

  async handle(query, context) {
    context.onStatus?.('Consultando resultados deportivos...')

    const sportsResult = await buildSportsContext(query.text)
    if (sportsResult) {
      const memCtx = buildSportsMemoryContext()
      let llmContext = memCtx
        ? `${memCtx}\n\n${sportsResult.llmContext}`
        : sportsResult.llmContext

      if (sportsResult.newsIntent && (sportsResult.teamNewsCount ?? 0) < 2) {
        const webQuery = sportsResult.focusTeamName
          ? `noticias ${sportsResult.focusTeamName} futbol`
          : query.text
        debugLog(`[agent:sports] sports news thin (${sportsResult.teamNewsCount ?? 0}) — supplementing with webSearch: "${webQuery}"`)
        context.onStatus?.('Buscando noticias en la web...')
        const webResult = await performSearch(webQuery, query.text)
        if (webResult) {
          llmContext = `${llmContext}\n\n--- Noticias adicionales (web) ---\n${webResult.contextMessage}`
          debugLog(`[agent:sports] webSearch supplement added (${webResult.contextMessage.length} chars)`)
        }
      }

      return {
        userContent: query.text,
        searchContext: llmContext,
        statusMessage: 'Consultando resultados deportivos...',
        tableOutput: sportsResult.tableOutput,
        seasonPhase: sportsResult.seasonPhase,
        scoreboard: sportsResult.scoreboard,
        newsIntent: sportsResult.newsIntent,
        teamNewsCount: sportsResult.teamNewsCount,
      }
    }

    const memCtx = buildSportsMemoryContext()
    if (memCtx) {
      debugLog(`[agent:sports] sports league not detected — retrying with memory context: ${memCtx.slice(0, 80)}`)
      const enrichedQuery = `${query.text} ${memoryValues(memCtx)}`
      const retryResult = await buildSportsContext(enrichedQuery)

      if (retryResult) {
        return {
          userContent: query.text,
          searchContext: `${memCtx}\n\n${retryResult.llmContext}`,
          statusMessage: 'Consultando resultados deportivos...',
          tableOutput: retryResult.tableOutput,
          seasonPhase: retryResult.seasonPhase,
          scoreboard: retryResult.scoreboard,
          newsIntent: retryResult.newsIntent,
          teamNewsCount: retryResult.teamNewsCount,
        }
      }

      debugLog('[agent:sports] sports retry failed — falling back to webSearch with enriched query')
    }

    const searchQuery = memCtx ? `${query.text} ${memoryValues(memCtx)}` : query.text
    const result = await performSearch(searchQuery, query.text)

    return {
      userContent: query.text,
      searchContext: result?.contextMessage ?? null,
      statusMessage: 'Consultando resultados deportivos...',
    }
  },
}
