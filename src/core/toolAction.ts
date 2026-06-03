export type RoutingDecision = 'webSearch' | 'getDateTime' | 'getWeather' | 'sportsQuery' | 'none'

export type ToolAction =
  | { action: 'get_time' }
  | { action: 'get_location' }
  | { action: 'get_weather'; city?: string }
  | { action: 'web_search'; query: string }
  | { action: 'web_fetch'; url: string }
  | { action: 'sports_query'; query: string }
  | { action: 'news_manage_topics'; sub_action: 'list' | 'add' | 'remove'; name: string; keywords?: string[] }
  | { action: 'news_digest'; topic?: string }
