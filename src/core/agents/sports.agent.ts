import type { Agent, DigestMatch } from '../agent.types.js'
import { buildNewsIntro } from '../news-intro.js'
import { getDb } from '../../memory/database.js'

function getEspnLeaguePath(leagueId: string): string | null {
  try {
    const db = getDb()
    const row = db.prepare(`
      SELECT l.sport, ep.external_id
      FROM leagues l
      JOIN entity_providers ep ON ep.entity_type = 'league' AND ep.entity_id = l.id
      WHERE l.id = ? AND ep.provider = 'espn'
    `).get(leagueId) as { sport: string; external_id: string } | undefined
    if (!row) return null
    return `${row.sport}/${row.external_id}`
  } catch {
    return null
  }
}

export const sportsAgent: Agent = {
  id: 'sports',
  name: 'Sports Agent',
  description: 'Gets live sports scores, standings, fixtures, and sports news.',
  mode: 'deterministic',
  tools: ['sports_context'],

  async handle(query, context) {
    const statusMessage = 'Obteniendo información deportiva...'
    context.onStatus?.(statusMessage)

    try {
      const { buildSportsContext } = await import('../../tools/sports/index.js')
      const result = await buildSportsContext(query.text)

      const buildDigestMatches = (): DigestMatch[] | undefined => {
        if (result.intent !== 'scoreboard' || !result.scoreboard?.games) return undefined
        if (result.provider !== 'espn') return undefined
        const leaguePath = getEspnLeaguePath(result.leagueId)
        if (!leaguePath) return undefined
        return result.scoreboard.games.map((game, index) => ({
          position: index + 1,
          homeTeam: game.home.team,
          awayTeam: game.away.team,
          homeScore: game.home.score || '0',
          awayScore: game.away.score || '0',
          status: game.status,
          statusDetail: game.statusDetail,
          date: game.date,
          venue: game.venue,
          eventId: game.id,
          leaguePath,
        }))
      }

      if (result.intent === 'news') {
        const count = result.news?.length ?? 0
        const intro = await buildNewsIntro(query.text, count)
        const maxInline = 8
        const shown = (result.news ?? []).slice(0, maxInline)
        const headlines = shown.map((a, i) => `  ${i + 1}. ${a.headline}`).join('\n')
        const hint = count > maxInline
          ? `\n\nMostrando ${maxInline} de ${count}. Usa ctrl+x ↓ para ver todas.`
          : `\n\nUsa ctrl+x ↓ para abrir y leer.`
        const directResponse = `${intro}\n\n${headlines}${hint}`

        return {
          userContent: query.text,
          searchContext: null,
          statusMessage,
          directResponse,
          digestArticles: result.news
            ?.map((item, index) => ({
              position: index + 1,
              title: item.headline,
              url: item.url ?? '',
              source: item.source,
              category: 'Deportes',
            }))
            .filter((item) => item.url.length > 0),
        }
      }

      return {
        userContent: query.text,
        searchContext: result.llmContext,
        statusMessage,
        directResponse: [
          result.tableOutput,
          '',
          `_Fuente: ${result.provider}_`,
        ].join('\n'),
        digestArticles: result.news
          ?.map((item, index) => ({
            position: index + 1,
            title: item.headline,
            url: item.url ?? '',
            source: item.source,
            category: 'Deportes',
          }))
          .filter((item) => item.url.length > 0),
        digestMatches: buildDigestMatches(),
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return {
        userContent: query.text,
        searchContext: null,
        statusMessage,
        directResponse: `No pude obtener la información deportiva: ${msg}`,
      }
    }
  },
}
