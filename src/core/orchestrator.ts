import type { RoutingDecision } from './router.js'
import { routeQuery } from './router.js'
import type { AgentContext, AgentQuery, AgentResponse } from './agent.types.js'
import { getAgentRegistry } from './agent-registry.js'
import { isFastPathConversation } from './fast-path.js'
import { debugLog } from '../utils/debug.js'

function mapDecisionToAgent(decision: RoutingDecision): string {
  switch (decision) {
    case 'getDateTime':
      return 'datetime'
    case 'getWeather':
      return 'weather'
    case 'sportsQuery':
      return 'sports'
    case 'webSearch':
      return 'web-search'
    case 'mexicoNewsDigest':
    case 'newsDigest':
      return 'news'
    case 'savePreference':
      return 'preferences'
    case 'none':
    default:
      return 'general'
  }
}

async function runWithFallback(
  agentId: string,
  query: AgentQuery,
  context: AgentContext,
): Promise<AgentResponse> {
  const registry = getAgentRegistry()

  try {
    return await registry.run(agentId, query, context)
  } catch (err) {
    if (agentId === 'general') throw err

    debugLog(`[orchestrator] ${agentId} failed — falling back to general: ${err instanceof Error ? err.message : String(err)}`)
    return registry.run('general', query, context)
  }
}

export async function orchestrateQuery(
  text: string,
  context: AgentContext,
  options?: { isExplicitSearch?: boolean },
): Promise<AgentResponse> {
  const query: AgentQuery = {
    text,
    originalText: text,
    isExplicitSearch: options?.isExplicitSearch ?? false,
  }

  if (!options?.isExplicitSearch && isFastPathConversation(text)) {
    return {
      userContent: text,
      searchContext: null,
      statusMessage: null,
      useReAct: false,
      agentId: 'fast-path',
    }
  }

  if (options?.isExplicitSearch) {
    return runWithFallback('web-search', {
      ...query,
      text: text.replace(/^\/search\s+/i, '').trim(),
      isExplicitSearch: true,
    }, context)
  }

  const routerResult = await routeQuery(text)
  const agentId = mapDecisionToAgent(routerResult.decision)
  debugLog(`Router decision: ${routerResult.decision} (source: ${routerResult.source}, confidence: ${routerResult.confidence})`)
  debugLog(`[orchestrator] selected agent: ${agentId}`)

  if (routerResult.decision !== 'savePreference') {
    getAgentRegistry().run('memory', query, context).catch(() => {/* silent */})
  }

  return runWithFallback(agentId, query, context)
}
