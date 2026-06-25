import type { Agent } from '../agent.types.js'
import { extractNewsTopic } from '../news-topic.js'
import { buildNewsIntro } from '../news-intro.js'

export const newsAgent: Agent = {
  id: 'news',
  name: 'News Agent',
  description: 'Builds configured news digests and topic-specific digests.',
  mode: 'deterministic',
  tools: ['news_digest', 'news_manage_topics'],

  async handle(query, context) {
    const topicName = extractNewsTopic(query.text)

    try {
      const { buildTopicNewsDigest, buildAllTopicsDigest } = await import('../../tools/mexico-news.js')

      const buildResponse = async (digest: { articles: Array<{ title: string; url: string; source: string; category: string }> }, topicLabel: string) => {
        const count = digest.articles.length
        const intro = await buildNewsIntro(query.text, count)
        const maxInline = 8
        const shown = digest.articles.slice(0, maxInline)
        const headlines = shown.map((a, i) => `  ${i + 1}. ${a.title}`).join('\n')
        const hint = count > maxInline
          ? `\n\nMostrando ${maxInline} de ${count}. Usa ctrl+x ↓ para ver todas.`
          : `\n\nUsa ctrl+x ↓ para abrir y leer cada nota.`

        return `${intro}\n\n${headlines}${hint}`
      }

      if (topicName) {
        const statusMessage = `Obteniendo noticias de ${topicName}...`
        context.onStatus?.(statusMessage)
        const digest = await buildTopicNewsDigest(topicName, query.text)
        const directResponse = await buildResponse(digest, topicName)

        return {
          userContent: query.text,
          searchContext: null,
          statusMessage,
          directResponse,
          digestArticles: digest.articles,
        }
      }

      const statusMessage = 'Obteniendo noticias de todos los temas...'
      context.onStatus?.(statusMessage)
      const digest = await buildAllTopicsDigest()
      const directResponse = await buildResponse(digest, 'todas las fuentes')

      return {
        userContent: query.text,
        searchContext: null,
        statusMessage,
        directResponse,
        digestArticles: digest.articles,
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        userContent: query.text,
        searchContext: null,
        statusMessage: 'Obteniendo noticias...',
        directResponse: `No se pudo obtener el digest de noticias: ${msg}`,
      }
    }
  },
}
