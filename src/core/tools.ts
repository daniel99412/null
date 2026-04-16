import { searchAndExtract } from '../tools/web-search.js'
import type { SearchContext } from '../tools/web-search.js'
import { fetchPageText } from '../tools/web-fetch.js'

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

  web_search: async (query: string): Promise<SearchContext> => {
    return searchAndExtract(query)
  },

  web_fetch: async (url: string): Promise<string> => {
    return fetchPageText(url)
  },
}
