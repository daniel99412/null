import { searchAndExtract } from '../tools/web-search.js'
import type { SearchContext } from '../tools/web-search.js'
import { fetchPageText } from '../tools/web-fetch.js'
import { getLocation, type GeoLocation } from '../tools/gps.js'
import { getCurrentWeather, type WeatherData } from '../tools/weather.js'
import { getNewsTopics, upsertNewsTopic, deleteNewsTopic } from '../memory/database.js'
import { upsertMemory, deleteMemory } from '../memory/memory-store.js'
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

  news_manage_topics: async (sub_action: string, name: string, keywords?: string[]) => {
    switch (sub_action) {
      case 'list': {
        const topics = getNewsTopics()
        if (topics.length === 0) return 'No hay topics configurados.'
        return topics.map(t => `- ${t.name}`).join('\n')
      }
      case 'add': {
        upsertNewsTopic(name, keywords ?? [name])
        upsertMemory({ type: 'preference', value: `sigue noticias de ${name.toLowerCase()}`, rawValue: name, source: 'explicit' })
        return `Topic "${name}" agregado con keywords: ${(keywords ?? [name]).join(', ')}`
      }
      case 'remove': {
        deleteNewsTopic(name)
        deleteMemory('preference', `sigue noticias de ${name.toLowerCase()}`)
        return `Topic "${name}" eliminado.`
      }
      default:
        return `Acción desconocida: ${sub_action}. Usa: list, add, remove.`
    }
  },

  news_digest: async (topic?: string) => {
    const { buildTopicNewsDigest, buildAllTopicsDigest } = await import('../tools/mexico-news.js')
    const digest = topic
      ? await buildTopicNewsDigest(topic)
      : await buildAllTopicsDigest()
    return digest.formatted
  },
}
