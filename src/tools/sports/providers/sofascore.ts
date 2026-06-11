import type { DateRange, EntityType, SportsFixtures, SportsNewsItem, SportsProvider, SportsScoreboard, SportsStandings } from '../types.js'

export const sofascoreProvider: SportsProvider = {
  id: 'sofascore',
  capabilities: {
    scoreboard: false,
    standings: false,
    fixtures: false,
    news: false,
  },

  async getScoreboard(_leagueId: string, _range: DateRange): Promise<SportsScoreboard> {
    throw new Error('SofaScore provider is not enabled yet')
  },

  async getStandings(_leagueId: string): Promise<SportsStandings> {
    throw new Error('SofaScore provider is not enabled yet')
  },

  async getFixtures(_leagueId: string, _range: DateRange): Promise<SportsFixtures> {
    throw new Error('SofaScore provider is not enabled yet')
  },

  async getNews(_entityId: string, _entityType: EntityType): Promise<SportsNewsItem[]> {
    throw new Error('SofaScore provider is not enabled yet')
  },
}
