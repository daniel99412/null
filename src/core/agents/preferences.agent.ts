import type { Agent } from '../agent.types.js'
import {
  addPreference,
  buildPreferenceSavedMessage,
  extractPreferencesFromQuery,
} from '../../memory/preferences.js'
import { debugLog } from '../../utils/debug.js'

export const preferencesAgent: Agent = {
  id: 'preferences',
  name: 'Preferences Agent',
  description: 'Stores durable user preferences.',
  mode: 'deterministic',
  tools: [],

  async handle(query) {
    const extracted = extractPreferencesFromQuery(query.text)

    if (extracted.length === 0) {
      return {
        userContent: query.text,
        searchContext: null,
        statusMessage: null,
        useReAct: true,
      }
    }

    for (const preference of extracted) {
      addPreference(preference.category, preference.value, preference.label)
      debugLog(`[agent:preferences] saved ${preference.category}=${preference.value}`)
    }

    return {
      userContent: query.text,
      searchContext: null,
      statusMessage: null,
      directResponse: buildPreferenceSavedMessage(extracted),
    }
  },
}
