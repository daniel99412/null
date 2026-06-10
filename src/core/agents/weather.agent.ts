import type { Agent } from '../agent.types.js'
import { getWeatherContextForQuery, extractCityFromQuery } from '../weather-context.js'
import { debugLog } from '../../utils/debug.js'

export const weatherAgent: Agent = {
  id: 'weather',
  name: 'Weather Agent',
  description: 'Fetches current weather for a city or the detected location.',
  mode: 'deterministic',
  tools: ['get_weather', 'get_location'],

  async handle(query, context) {
    context.onStatus?.('Obteniendo clima...')

    try {
      const city = extractCityFromQuery(query.text)
      debugLog(`[agent:weather] city extracted: ${city ?? '(none, using IP location)'}`)
      const weatherContext = await getWeatherContextForQuery(query.text)

      return {
        userContent: `${weatherContext}\n\nUser question: ${query.text}`,
        searchContext: null,
        statusMessage: 'Obteniendo clima...',
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      return {
        userContent: `Weather lookup failed: ${errMsg}. Kindly tell the user what happened. Reply in the same language the user used.`,
        searchContext: null,
        statusMessage: 'Obteniendo clima...',
      }
    }
  },
}
