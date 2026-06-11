import type { Agent } from '../agent.types.js'

export const generalAgent: Agent = {
  id: 'general',
  name: 'General Agent',
  description: 'Falls back to the ReAct loop for open-ended questions and tool use.',
  mode: 'react',
  tools: ['get_time', 'get_weather', 'get_location', 'web_search', 'web_fetch', 'news_digest', 'news_manage_topics', 'sports_context', 'search_docs', 'read_doc', 'index_docs'],

  async handle(query) {
    return {
      userContent: query.text,
      searchContext: null,
      statusMessage: null,
      useReAct: true,
    }
  },
}
