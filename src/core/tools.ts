import { searchWeb } from '../tools/web-search.js'

export const tools = {
  web_search: async (query: string, limit?: number) => ({
    query,
    extract: null,
    results: await searchWeb(query, limit ?? 5),
  }),
}
