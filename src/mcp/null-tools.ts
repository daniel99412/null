/**
 * Internal Null tool definitions with JSON schemas.
 * These are used by the MCP registry and can be converted to Ollama's tools format.
 */

import type { MCPToolDefinition } from './types.js'
import { tools } from '../core/tools.js'

export const nullToolDefinitions: MCPToolDefinition[] = [
  {
    name: 'get_time',
    description: 'Get current time and date. Returns ISO timestamp, localized time, date, and day string.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    handler: async () => tools.get_time(),
  },

  {
    name: 'get_location',
    description: 'Get current geographic location via IP geolocation. Returns latitude, longitude, city, region, country, and timezone.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    handler: async () => tools.get_location(),
  },

  {
    name: 'get_weather',
    description: 'Get current weather using IP location or a specified city. Returns temperature, humidity, wind speed, and description.',
    inputSchema: {
      type: 'object',
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
        const { getWeatherByCity } = await import('../tools/weather.js')
        return getWeatherByCity(args.city)
      }
      return tools.get_weather()
    },
  },

  {
    name: 'web_search',
    description: 'Search the web for current information. Use for recent events, news, sports transfers, prices, or any query that needs up-to-date data.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query',
        },
      },
      required: ['query'],
    },
    handler: async (args) => tools.web_search(args.query as string),
  },

  {
    name: 'web_fetch',
    description: 'Fetch and extract readable text content from a URL. Use to get full article text or page content.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL to fetch',
        },
      },
      required: ['url'],
    },
    handler: async (args) => tools.web_fetch(args.url as string),
  },

  {
    name: 'news_digest',
    description: 'Get a formatted news digest for a configured topic (tecnología, finanzas, méxico, ciencia, internacional, or custom user topics). Returns article summaries with sources and bias analysis.',
    inputSchema: {
      type: 'object',
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
    inputSchema: {
      type: 'object',
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
      return tools.news_manage_topics(subAction, name, keywords)
    },
  },
]
