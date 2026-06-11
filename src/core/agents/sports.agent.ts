import type { Agent } from '../agent.types.js'
import { buildNewsIntro } from '../news-intro.js'

export const sportsAgent: Agent = {
  id: 'sports',
  name: 'Sports Agent',
  description: 'Gets live sports scores, standings, fixtures, and sports news.',
  mode: 'deterministic',
  tools: ['sports_context'],

  async handle(query, context) {
    const statusMessage = 'Obteniendo información deportiva...'
    context.onStatus?.(statusMessage)

    try {
      const { buildSportsContext } = await import('../../tools/sports/index.js')
      const result = await buildSportsContext(query.text)

      if (result.intent === 'news') {
        const directResponse = await buildNewsIntro(query.text, result.news?.length ?? 0)
        return {
          userContent: query.text,
          searchContext: null,
          statusMessage,
          directResponse,
          digestArticles: result.news
            ?.map((item, index) => ({
              position: index + 1,
              title: item.headline,
              url: item.url ?? '',
              source: item.source,
              category: 'Deportes',
            }))
            .filter((item) => item.url.length > 0),
        }
      }

      return {
        userContent: query.text,
        searchContext: result.llmContext,
        statusMessage,
        directResponse: [
          result.tableOutput,
          '',
          `_Fuente: ${result.provider}_`,
        ].join('\n'),
        digestArticles: result.news
          ?.map((item, index) => ({
            position: index + 1,
            title: item.headline,
            url: item.url ?? '',
            source: item.source,
            category: 'Deportes',
          }))
          .filter((item) => item.url.length > 0),
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        userContent: query.text,
        searchContext: null,
        statusMessage,
        directResponse: `No pude obtener la información deportiva: ${msg}`,
      }
    }
  },
}
