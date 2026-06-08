import { searchAndExtract } from '../tools/web-search.js'
import type { SearchContext } from '../tools/web-search.js'
import { fetchPageText } from '../tools/web-fetch.js'
import { getLocation, type GeoLocation } from '../tools/gps.js'
import { getCurrentWeather, getWeatherByCity, type WeatherData } from '../tools/weather.js'
import { buildSportsContext } from '../tools/espn.js'
import { getNewsTopics, upsertNewsTopic, deleteNewsTopic } from '../memory/database.js'
import { upsertMemory, deleteMemory } from '../memory/memory-store.js'
import { searchDocsHybrid, buildDocContext } from '../docs/retriever.js'
import { indexDir } from '../docs/indexer.js'
import { buildDocumentContextMessage, resolveDocumentParts } from './document-context.js'

export interface ToolDefinition {
  name: string
  description: string
  aliases?: string[]
  showInSlashMenu?: boolean
  slashArgHint?: string | null
  inputSchema: {
    type: 'object'
    properties?: Record<string, unknown>
    required?: string[]
  }
  handler: (args: Record<string, unknown>) => Promise<unknown>
}

const getTimeHandler = async () => {
  const now = new Date()
  return {
    iso: now.toISOString(),
    time: now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
    date: now.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }),
    day: now.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }),
  }
}

export const toolDefinitions = [
  {
    name: 'get_time',
    description: 'Get current time and date. Returns ISO timestamp, localized time, date, and day string.',
    aliases: ['time', 'hora'],
    showInSlashMenu: true,
    slashArgHint: null,
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
    handler: getTimeHandler,
  },

  {
    name: 'get_location',
    description: 'Get current geographic location via IP geolocation. Returns latitude, longitude, city, region, country, and timezone.',
    showInSlashMenu: false,
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
    handler: async () => getLocation(),
  },

  {
    name: 'get_weather',
    description: 'Get current weather using IP location or a specified city. Returns temperature, humidity, wind speed, and description.',
    aliases: ['weather', 'clima', 'temperatura'],
    showInSlashMenu: true,
    slashArgHint: '<city>',
    inputSchema: {
      type: 'object' as const,
      properties: {
        city: {
          type: 'string',
          description: 'City name (optional — uses IP location if omitted)',
        },
      },
      required: [],
    },
    handler: async (args) => {
      if (args.city && typeof args.city === 'string') {
        return getWeatherByCity(args.city)
      }
      return getCurrentWeather()
    },
  },

  {
    name: 'web_search',
    description: 'Search the web for current information. Use for recent events, news, sports transfers, prices, or any query that needs up-to-date data.',
    showInSlashMenu: false,
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
      },
      required: ['query'],
    },
    handler: async (args) => searchAndExtract(args.query as string),
  },

  {
    name: 'web_fetch',
    description: 'Fetch and extract readable text content from a URL. Use to get full article text or page content.',
    showInSlashMenu: false,
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'URL to fetch',
        },
      },
      required: ['url'],
    },
    handler: async (args) => fetchPageText(args.url as string),
  },

  {
    name: 'sports_query',
    description: 'Get sports scores, standings, fixtures, and news for leagues and teams. Supports soccer, football, basketball, baseball, hockey, and more.',
    aliases: ['sports', 'deportes', 'futbol', 'fútbol'],
    showInSlashMenu: true,
    slashArgHint: '<query>',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Sports query — team name, league, or what you want to know (scores, standings, news)',
        },
      },
      required: ['query'],
    },
    handler: async (args) => {
      const result = await buildSportsContext(args.query as string)
      if (!result) return 'No se encontraron resultados deportivos para esa consulta.'
      return result.llmContext
    },
  },

  {
    name: 'news_digest',
    description: 'Get a formatted news digest for a configured topic (tecnología, finanzas, méxico, ciencia, internacional, or custom user topics). Returns article summaries with sources and bias analysis.',
    aliases: ['news', 'noticias'],
    showInSlashMenu: true,
    slashArgHint: '<topic>',
    inputSchema: {
      type: 'object' as const,
      properties: {
        topic: {
          type: 'string',
          description: 'Topic name. Examples: "México", "Tecnología", "Finanzas", "Ciencia", "Internacional"',
        },
      },
      required: [],
    },
    handler: async (args) => {
      const { buildTopicNewsDigest, buildAllTopicsDigest } = await import('../tools/mexico-news.js')
      const topic = args.topic as string | undefined
      const digest = topic
        ? await buildTopicNewsDigest(topic)
        : await buildAllTopicsDigest()
      return digest.formatted
    },
  },

  {
    name: 'news_manage_topics',
    description: 'Manage news topics. Add a topic with keywords, remove a topic, or list all configured topics. Use when the user wants to configure their news preferences.',
    showInSlashMenu: false,
    inputSchema: {
      type: 'object' as const,
      properties: {
        sub_action: {
          type: 'string',
          description: 'Action to perform: "list" shows all topics, "add" creates a new topic, "remove" deletes a topic',
          enum: ['list', 'add', 'remove'],
        },
        name: {
          type: 'string',
          description: 'Topic name (required for add/remove)',
        },
        keywords: {
          type: 'array',
          description: 'Keywords for filtering news (only for add action)',
          items: { type: 'string' },
        },
      },
      required: ['sub_action'],
    },
    handler: async (args) => {
      const subAction = args.sub_action as string
      const name = (args.name as string) ?? ''
      const keywords = args.keywords as string[] | undefined
      switch (subAction) {
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
          return `Acción desconocida: ${subAction}. Usa: list, add, remove.`
      }
    },
  },

  {
    name: 'search_docs',
    description: 'Search indexed project documentation for relevant information. Use when the user asks about documentation, code, configurations, or any project files.',
    showInSlashMenu: false,
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query — what you want to find in the project docs',
        },
      },
      required: ['query'],
    },
    handler: async (args) => {
      const query = args.query as string
      if (!query) return 'No query provided.'
      const results = await searchDocsHybrid(query)
      if (results.length === 0) return 'No matching documentation found.'
      return buildDocContext(results)
    },
  },

  {
    name: 'read_doc',
    description: 'Read a specific file from the project. Use when the user references a file with @filename or asks about a specific file.',
    showInSlashMenu: false,
    inputSchema: {
      type: 'object' as const,
      properties: {
        filepath: {
          type: 'string',
          description: 'Path to the file, relative to project root',
        },
      },
      required: ['filepath'],
    },
    handler: async (args) => {
      const filepath = args.filepath as string
      if (!filepath) return 'No file path provided.'
      const parts = await resolveDocumentParts(`@${filepath}`)
      if (parts.length === 0) return 'No file path provided.'
      return buildDocumentContextMessage(parts)
    },
  },

  {
    name: 'index_docs',
    description: 'Index project documentation for search. Scans the project directory for documents and builds a searchable index. Run this once after opening a new project.',
    showInSlashMenu: false,
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
    handler: async () => {
      const result = await indexDir()
      return `Indexed ${result.files} files (${result.chunks} chunks).`
    },
  },
] as const satisfies readonly ToolDefinition[]

export type ToolName = (typeof toolDefinitions)[number]['name']

export type ToolAction = {
  [K in ToolName]: { action: K } & Record<string, unknown>
}[ToolName]

export interface SlashCommand {
  alias: string
  toolName: string
  description: string
  argHint: string | null
}

export function getSlashCommands(): SlashCommand[] {
  const result: SlashCommand[] = []
  for (const def of toolDefinitions) {
    if (!def.showInSlashMenu) continue
    const aliases = def.aliases?.length ? def.aliases : [def.name]
    for (const alias of aliases) {
      result.push({
        alias,
        toolName: def.name,
        description: def.description.split('.')[0],
        argHint: def.slashArgHint ?? null,
      })
    }
  }
  return result
}

export function toOllamaFormat(def: (typeof toolDefinitions)[number]): {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
} {
  return {
    type: 'function',
    function: {
      name: def.name,
      description: def.description,
      parameters: def.inputSchema as unknown as Record<string, unknown>,
    },
  }
}
