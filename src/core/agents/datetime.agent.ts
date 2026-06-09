import type { Agent } from '../agent.types.js'

export const dateTimeAgent: Agent = {
  id: 'datetime',
  name: 'Date & Time Agent',
  description: 'Answers current local date and time queries.',
  mode: 'deterministic',
  tools: [],

  async handle(query) {
    const now = new Date()
    const time = now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
    const date = now.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' })

    return {
      userContent: `Current time: ${time}, date: ${date}. User asked: "${query.text}". Answer naturally.`,
      searchContext: null,
      statusMessage: null,
    }
  },
}
