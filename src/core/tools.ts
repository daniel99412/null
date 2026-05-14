import { searchAndExtract } from '../tools/web-search.js'
import type { SearchContext } from '../tools/web-search.js'
import { fetchPageText } from '../tools/web-fetch.js'
import { getLocation, type GeoLocation } from '../tools/gps.js'
import { getCurrentWeather, type WeatherData } from '../tools/weather.js'
// Ensures execute.ts stays in sync with the tools registry (compile-time validation)
import type {} from './execute.js'

export const tools = {
  get_time: () => {
    const now = new Date()

    return {
      iso: now.toISOString(),
      time: now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
      date: now.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      day: now.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }),
    }
  },

  get_location: async (): Promise<GeoLocation> => {
    return getLocation()
  },

  get_weather: async (): Promise<WeatherData> => {
    return getCurrentWeather()
  },

  web_search: async (query: string): Promise<SearchContext> => {
    return searchAndExtract(query)
  },

  web_fetch: async (url: string): Promise<string> => {
    return fetchPageText(url)
  },
}
