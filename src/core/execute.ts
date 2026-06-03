import { tools } from './tools.js'
import type { ToolAction } from './toolAction.js'

export async function executeAction(action: ToolAction): Promise<unknown> {
  switch (action.action) {
    case 'get_time':
      return tools.get_time()

    case 'get_location':
      return tools.get_location()

    case 'get_weather':
      return tools.get_weather()

    case 'web_search':
      return tools.web_search(action.query)

    case 'web_fetch':
      return tools.web_fetch(action.url)

    case 'sports_query':
      // sports tool dispatched via ESPN directly in agent — return stub
      return { query: action.query }

    case 'news_manage_topics':
      return tools.news_manage_topics(action.sub_action, action.name, action.keywords)

    case 'news_digest':
      return tools.news_digest(action.topic)
  }
}
