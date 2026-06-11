import type { Agent, AgentContext, AgentQuery, AgentResponse } from './agent.types.js'
import { debugLog } from '../utils/debug.js'
import { dateTimeAgent } from './agents/datetime.agent.js'
import { generalAgent } from './agents/general.agent.js'
import { memoryAgent } from './agents/memory.agent.js'
import { newsAgent } from './agents/news.agent.js'
import { sportsAgent } from './agents/sports.agent.js'
import { weatherAgent } from './agents/weather.agent.js'
import { webSearchAgent } from './agents/web-search.agent.js'

export class AgentRegistry {
  private agents = new Map<string, Agent>()

  register(agent: Agent): void {
    this.agents.set(agent.id, agent)
  }

  get(agentId: string): Agent {
    const agent = this.agents.get(agentId)
    if (!agent) throw new Error(`Unknown agent: ${agentId}`)
    return agent
  }

  list(): Array<{ id: string; name: string; description: string; mode: string; tools: string[] }> {
    return [...this.agents.values()].map((agent) => ({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      mode: agent.mode,
      tools: agent.tools,
    }))
  }

  async run(agentId: string, query: AgentQuery, context: AgentContext): Promise<AgentResponse> {
    const agent = this.get(agentId)
    const started = Date.now()

    debugLog(`[agent:${agent.id}] start: "${query.text}"`)

    try {
      const response = await agent.handle(query, context)
      const durationMs = Date.now() - started

      debugLog(`[agent:${agent.id}] done in ${durationMs}ms`)

      return {
        ...response,
        agentId: agent.id,
        durationMs,
      }
    } catch (err) {
      const durationMs = Date.now() - started
      debugLog(`[agent:${agent.id}] failed after ${durationMs}ms: ${err instanceof Error ? err.message : String(err)}`)
      throw err
    }
  }
}

let registry: AgentRegistry | null = null
let builtinsRegistered = false

export function getAgentRegistry(): AgentRegistry {
  if (!registry) {
    registry = new AgentRegistry()
    builtinsRegistered = false
  }

  registerBuiltinAgents()
  return registry
}

export function registerBuiltinAgents(): void {
  if (!registry) {
    registry = new AgentRegistry()
  }

  if (builtinsRegistered) return

  registry.register(dateTimeAgent)
  registry.register(weatherAgent)
  registry.register(newsAgent)
  registry.register(sportsAgent)
  registry.register(webSearchAgent)
  registry.register(memoryAgent)
  registry.register(generalAgent)
  builtinsRegistered = true
}

export function resetAgentRegistry(): void {
  registry = null
  builtinsRegistered = false
}
