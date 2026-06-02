import { tools } from './tools.js'
import type { ToolAction } from './toolAction.js'

export async function executeAction(action: ToolAction): Promise<unknown> {
  switch (action.action) {
    case 'get_time':
      return tools.get_time()

    case 'get_location':
      return tools.get_location()

    case 'get_weather':
      if (action.city) {
        // city-specific weather not yet in tools registry — return basic weather
        return tools.get_weather()
      }
      return tools.get_weather()

    case 'web_search':
      return tools.web_search(action.query)

    case 'web_fetch':
      return tools.web_fetch(action.url)

    case 'sports_query':
      // sports tool dispatched via ESPN directly in agent — return stub
      return { query: action.query }
  }
}
