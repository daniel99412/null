import { detectSportsIntent } from './intent.js'
import { withProviderFallback } from './router.js'
import type { SportsQueryResult } from './types.js'
import { formatFixturesContext, formatFixturesTable } from './formatters/fixtures.js'
import { formatNewsCards, formatNewsContext } from './formatters/news.js'
import { formatScoreboardContext, formatScoreboardTable } from './formatters/scoreboard.js'
import { formatStandingsContext, formatStandingsTable } from './formatters/standings.js'

export { detectDateIntent, detectDateRange, detectLeague, detectSportsCapability, detectSportsIntent, hasExplicitDateRange } from './intent.js'
export type {
  DateRange,
  EntityType,
  SportProvider,
  SportsCapability,
  SportsFixtures,
  SportsGame,
  SportsNewsItem,
  SportsProvider,
  SportsQueryResult,
  SportsScoreboard,
  SportsStandings,
} from './types.js'

export async function buildSportsContext(query: string): Promise<SportsQueryResult> {
  const intent = detectSportsIntent(query)

  switch (intent.intent) {
    case 'standings': {
      const { provider, result } = await withProviderFallback('standings', (sportsProvider) =>
        sportsProvider.getStandings(intent.leagueId),
      )
      return {
        intent: 'standings',
        leagueId: intent.leagueId,
        teamId: intent.teamId,
        provider,
        standings: result,
        tableOutput: formatStandingsTable(result),
        llmContext: formatStandingsContext(result),
      }
    }
    case 'fixtures': {
      const { provider, result } = await withProviderFallback('fixtures', (sportsProvider) =>
        sportsProvider.getFixtures(intent.leagueId, intent.dateRange),
      )
      return {
        intent: 'fixtures',
        leagueId: intent.leagueId,
        teamId: intent.teamId,
        provider,
        fixtures: result,
        tableOutput: formatFixturesTable(result),
        llmContext: formatFixturesContext(result),
      }
    }
    case 'news': {
      const { provider, result } = await withProviderFallback('news', (sportsProvider) =>
        sportsProvider.getNews(intent.entityId, intent.entityType),
      )
      return {
        intent: 'news',
        leagueId: intent.leagueId,
        teamId: intent.teamId,
        provider,
        news: result,
        tableOutput: formatNewsCards(result),
        llmContext: formatNewsContext(result),
      }
    }
    case 'scoreboard':
    default: {
      const { provider, result } = await withProviderFallback('scoreboard', (sportsProvider) =>
        sportsProvider.getScoreboard(intent.leagueId, intent.dateRange),
      )
      return {
        intent: 'scoreboard',
        leagueId: intent.leagueId,
        teamId: intent.teamId,
        provider,
        scoreboard: result,
        tableOutput: formatScoreboardTable(result),
        llmContext: formatScoreboardContext(result),
        seasonPhase: result.seasonPhase,
      }
    }
  }
}
