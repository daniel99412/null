import type { Agent } from '../agent.types.js'
import { checkMemoryGate } from '../../memory/memory-gate.js'
import { extractMemoriesFromMessage } from '../../memory/memory-extractor.js'

export const memoryAgent: Agent = {
  id: 'memory',
  name: 'Memory Agent',
  description: 'Runs non-blocking memory extraction when a query contains durable user facts.',
  mode: 'deterministic',
  tools: [],

  async handle(query) {
    const gateResult = checkMemoryGate(query.text)
    if (gateResult.shouldExtract) {
      extractMemoriesFromMessage(query.text, gateResult.hints).catch(() => {/* silent */})
    }

    return {
      userContent: query.text,
      searchContext: null,
      statusMessage: null,
    }
  },
}
