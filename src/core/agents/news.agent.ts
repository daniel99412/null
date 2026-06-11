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

      if (topicName) {
        const statusMessage = `Obteniendo noticias de ${topicName}...`
        context.onStatus?.(statusMessage)
        const digest = await buildTopicNewsDigest(topicName, query.text)
        const directResponse = await buildNewsIntro(query.text, digest.articles.length)

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
      const directResponse = await buildNewsIntro(query.text, digest.articles.length)

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
