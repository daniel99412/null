import { normalizeQuery } from '../utils/normalize.js'
import { debugLog } from '../utils/debug.js'

export type RoutingDecision = 'getDateTime' | 'none'

export interface RouterResult {
  decision: RoutingDecision
  confidence: number
  source: 'heuristic'
}

// ─── Scoring system ───────────────────────────────────────────────────────────

interface Signal {
  pattern: RegExp
  intent: RoutingDecision
  weight: number
  description?: string
}

const SIGNALS: Signal[] = [
  // ── GETDATETIME ───────────────────────────────────────────────────────────
  { pattern: /\b(qué hora|what time|que hora)\b/i, intent: 'getDateTime', weight: 12, description: 'time query' },
  { pattern: /\b(qué día|what day|qué fecha|what date|en qué fecha)\b/i, intent: 'getDateTime', weight: 12, description: 'date query' },
  { pattern: /\b(today'?s date|what is today|what's today)\b/i, intent: 'getDateTime', weight: 12, description: "today's date" },
]

function scoreQuery(query: string): Record<RoutingDecision, number> {
  const scores: Record<RoutingDecision, number> = {
    getDateTime: 0,
    none: 0,
  }

  for (const signal of SIGNALS) {
    if (signal.pattern.test(query)) {
      scores[signal.intent] += signal.weight
      debugLog(`[router] signal match: "${signal.description}" → ${signal.intent} +${signal.weight}`)
    }
  }

  return scores
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function routeQuery(query: string): Promise<RouterResult> {
  const normalizedQuery = normalizeQuery(query)
  debugLog(`[router] query: "${normalizedQuery}"`)
  const scores = scoreQuery(normalizedQuery)

  if (scores.getDateTime >= 5) {
    debugLog(`[router] heuristic result: getDateTime`)
    return { decision: 'getDateTime', confidence: 1.0, source: 'heuristic' }
  }

  return { decision: 'none', confidence: 1.0, source: 'heuristic' }
}
