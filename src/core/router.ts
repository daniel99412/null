import { normalizeQuery } from '../utils/normalize.js'
import { debugLog } from '../utils/debug.js'
import { classifyIntent } from './intent-classifier.js'
import type { CLLMResult } from './intent-classifier.js'

export type RoutingDecision = 'webSearch' | 'getDateTime' | 'getWeather' | 'mexicoNewsDigest' | 'newsDigest' | 'none'

export interface RouterResult {
  decision: RoutingDecision
  confidence: number
  source: 'heuristic' | 'llm'
  cllm?: CLLMResult
}

// ─── Scoring system ───────────────────────────────────────────────────────────

interface Signal {
  pattern: RegExp
  intent: RoutingDecision
  weight: number
  description?: string
}

/**
 * Weighted signals for scoring queries.
 * Positive weight = favors that intent.
 * Multiple signals for the same intent accumulate.
 *
 * Threshold:
 *   score >= 8  → heuristic decision (confidence 1.0)
 *   score >= 5  → heuristic decision (confidence 0.85)
 *   score < 5   → fallback to LLM
 */
const SIGNALS: Signal[] = [
  // ── NONE — greetings / personal questions (must beat everything else) ─────
  { pattern: /^(hola|hi|hey|hello|buenas|qué tal|que tal|buenos días|buenas tardes|buenas noches)[\s!?.]*$/i, intent: 'none', weight: 20, description: 'pure greeting' },
  { pattern: /\b(hola|hi|hey|hello)\b/i, intent: 'none', weight: 6, description: 'greeting keyword' },
  { pattern: /\b(c[oó]mo\s+(est[aá]s?|andas?|te\s+va|te\s+encuentras?))\b/i, intent: 'none', weight: 12, description: 'how are you' },
  { pattern: /\b(qui[eé]n\s+eres|who\s+are\s+you|c[oó]mo\s+te\s+llamas|what('s|\s+is)\s+your\s+name)\b/i, intent: 'none', weight: 20, description: 'identity question' },
  { pattern: /\b(c[oó]mo\s+me\s+llamo|cu[aá]l\s+es\s+mi\s+nombre|sabes\s+mi\s+nombre|what('s|\s+is)\s+my\s+name)\b/i, intent: 'none', weight: 20, description: 'user name question' },
  { pattern: /\b(eres\s+(una?\s+)?(ia|ai|inteligencia|bot|asistente|assistant))\b/i, intent: 'none', weight: 14, description: 'are you an AI' },
  { pattern: /\b(gracias|thanks|thank\s+you|de\s+nada|you'?re\s+welcome)\b/i, intent: 'none', weight: 10, description: 'thanks/acknowledgement' },
  { pattern: /\b(joke|chiste|broma|riddle|acertijo|adivinanza)\b/i, intent: 'none', weight: 10, description: 'joke/riddle' },
  // ── NONE — programming / technical (very high weight to block search) ──────
  { pattern: /\b(function|class|clase|array|loop|recursion|recursiva|algoritmo|algorithm)\b/i, intent: 'none', weight: 12, description: 'programming keyword' },
  { pattern: /\b(hola mundo|hello world)\b/i, intent: 'none', weight: 12, description: 'hello world' },
  { pattern: /\b(code|syntax|compile|debug|variable|method)\b/i, intent: 'none', weight: 12, description: 'code keyword' },
  { pattern: /(?:^|\s)(código|compilar|método)(?:\s|$)/i, intent: 'none', weight: 12, description: 'código/compilar' },
  // ── NONE — science / math ─────────────────────────────────────────────────
  { pattern: /\b(teorema|theorem)\b/i, intent: 'none', weight: 10, description: 'teorema' },
  { pattern: /(?:^|\s)(ecuación|equation|fórmula|formula|derivada|integral)(?:\s|$)/i, intent: 'none', weight: 10, description: 'math' },
  { pattern: /\b(ley de newton|law of|gravedad|gravity)\b/i, intent: 'none', weight: 10, description: 'physics law' },
  { pattern: /(?:^|\s)(evolución|evolution|relatividad|relativity)(?:\s|$)/i, intent: 'none', weight: 10, description: 'science concept' },
  { pattern: /\b(capital de|capital of|continente|continent)\b/i, intent: 'none', weight: 8, description: 'geography' },
  { pattern: /(?:^|\s)(océano|ocean|montaña|mountain)(?:\s|$)/i, intent: 'none', weight: 8, description: 'geography' },
  { pattern: /(?:^|\s)(tabla periódica|periodic table|elemento químico|chemical element)(?:\s|$)/i, intent: 'none', weight: 10, description: 'chemistry' },
  { pattern: /(?:^|\s)(cuántos|how many|cuánto mide|how tall|cuánto pesa|how much does)(?:\s).*\b(planeta|planet|país|country|estado|state)\b/i, intent: 'none', weight: 8, description: 'factual geography/science' },
  // ── NONE — history / knowledge ────────────────────────────────────────────
  { pattern: /\b(guerra|war|batalla|battle|conquista|conquest|tratado|treaty|imperio|empire)\b/i, intent: 'none', weight: 6, description: 'history event' },
  { pattern: /(?:^|\s)(revolución|revolution|independencia|independence|reforma|reform)(?:\s|$)/i, intent: 'none', weight: 6, description: 'history movement' },
  { pattern: /\b(edad media|middle ages|renacimiento|renaissance|colonia|colonial)\b/i, intent: 'none', weight: 8, description: 'historical period' },
  { pattern: /(?:^|\s)(quién fue|who was|quién inventó|who invented|biografía|biography)(?:\s|$)/i, intent: 'none', weight: 6, description: 'biographical question' },
  { pattern: /\b(leyes de|laws of)\b/i, intent: 'none', weight: 6, description: 'established laws' },
  { pattern: /(?:^|\s)(constitución|constitution|doctrina|doctrine)(?:\s|$)/i, intent: 'none', weight: 6, description: 'doctrine/constitution' },
  { pattern: /(?:^|\s)(qué sabes|que sabes|qué fue|que fue|qué es|que es)(?:\s|$)/i, intent: 'none', weight: 4, description: 'knowledge question' },
  { pattern: /(?:^|\s)(cuéntame|cuentame|háblame|hablame|explícame|explicame|dime)\b.*\b(sobre|de|acerca)\b/i, intent: 'none', weight: 4, description: 'tell me about' },
  { pattern: /\b(explain|tell me about|what is|what was|what were)\b/i, intent: 'none', weight: 4, description: 'explain/what is' },

  // ── GETDATETIME ───────────────────────────────────────────────────────────
  { pattern: /\b(qué hora|what time|que hora)\b/i, intent: 'getDateTime', weight: 12, description: 'time query' },
  { pattern: /\b(qué día|what day|qué fecha|what date|en qué fecha)\b/i, intent: 'getDateTime', weight: 12, description: 'date query' },
  { pattern: /\b(today'?s date|what is today|what's today)\b/i, intent: 'getDateTime', weight: 12, description: "today's date" },

  // ── GETWEATHER ────────────────────────────────────────────────────────────
  { pattern: /\b(clima|weather|temperatura|temperature)\b/i, intent: 'getWeather', weight: 10, description: 'weather/temp keyword' },
  { pattern: /\b(calor|fr[íi]o|lluvia|rain|nublado|cloudy|pron[oó]stico|forecast)\b/i, intent: 'getWeather', weight: 8, description: 'weather condition' },
  { pattern: /(?:^|\s)(c[oó]mo\s+est[aá]\s+el\s+(clima|tiempo|d[íi]a))(?:\s|$|[?,.])/i, intent: 'getWeather', weight: 12, description: 'how is the weather' },
  { pattern: /(?:^|\s)(qu[eé]\s+temperatura)(?:\s|$|[?,.])/i, intent: 'getWeather', weight: 12, description: 'what temperature' },
  { pattern: /(?:^|\s)(va\s+a\s+llover|va\s+a\s+hacer\s+(calor|fr[íi]o))(?:\s|$|[?,.])/i, intent: 'getWeather', weight: 12, description: 'will it rain/be hot' },

  // ── NEWSDIGEST — topic-specific news queries ────────────────────────────
  { pattern: /\b(dame|d[aá]me)\b.*\b(las?\s+)?noticias?\b/i, intent: 'newsDigest', weight: 20, description: 'dame las noticias' },
  { pattern: /\b(me\s+)?(das?|puedes? darme?|puedes?\s+darme|me\s+das)\b.*\b(las?\s+)?noticias?\b/i, intent: 'newsDigest', weight: 20, description: 'me das las noticias' },
  { pattern: /\bqu[eé]\s+pas[oó]\s+(hoy|esta semana|ayer)\b/i, intent: 'newsDigest', weight: 20, description: 'que pasó hoy' },
  { pattern: /\b(que|qu[eé])\s+pas[oó]\s+(hoy|esta semana|ayer)\b/i, intent: 'newsDigest', weight: 20, description: 'que paso hoy' },
  { pattern: /\b(resumen|digest)\b.*\bnoticias?\b/i, intent: 'newsDigest', weight: 18, description: 'resumen de noticias' },
  { pattern: /\bnoticias?\b.*\b(resumen|digest)\b/i, intent: 'newsDigest', weight: 18, description: 'noticias resumen' },
  { pattern: /\b(últimas?|últimos?)\b.*\bnoticias?\b/i, intent: 'newsDigest', weight: 16, description: 'últimas noticias' },
  { pattern: /\bnoticias?\b.*\b(últimas?|recientes?|importantes?)\b/i, intent: 'newsDigest', weight: 16, description: 'noticias importantes' },
  { pattern: /\bnoticias?\b.*\b(de\s+)?(m[eé]xico|internacional|finanzas?|tecnolog[ií]a|ciencia|salud)\b/i, intent: 'newsDigest', weight: 16, description: 'noticias de un topic' },
  { pattern: /\b(ponme|p[oó]nme)\b.*\bal\b.*\b(d[ií]a|noticias?)\b/i, intent: 'newsDigest', weight: 14, description: 'ponme al día' },
  { pattern: /\bqu[eé]\s+(se\s+)?(sabe|dice)\s+(hoy|del?\s+(d[ií]a|mundo))\b/i, intent: 'newsDigest', weight: 14, description: 'que se sabe hoy' },
  { pattern: /\b(noticias?|novedades?)\s+(de\s+)?(sobre\s+)?\w{3,}/i, intent: 'newsDigest', weight: 12, description: 'noticias de [algo] generico' },
  { pattern: /(?:^|\s)(qu[eé])\s+(pas[oó]|hay|hubo)\s+(en|de)\s+(tecnolog[ií]a|finanzas?|ciencia|salud|internacional|econom[ií]a|negocios|pol[ií]tica|seguridad|educaci[oó]n|cultura)\b/i, intent: 'newsDigest', weight: 18, description: 'que paso en [topic]' },

  // ── WEBSEARCH — recency / news ────────────────────────────────────────────
  { pattern: /\b(20[2-9][4-9]|20[3-9]\d)\b/, intent: 'webSearch', weight: 10, description: 'year post-cutoff' },
  { pattern: /\b(hoy|today|ahorita|ahora|right now)\b.*\b(precio|price|clima|weather|dólar|dollar)\b/i, intent: 'webSearch', weight: 10, description: 'today + price/rate' },
  { pattern: /(últimas?|ultimas?|latest|recientes?|recent).*(noticias?|news)|(noticias?|news).*(últimas?|ultimas?|latest|recientes?|recent)/i, intent: 'webSearch', weight: 4, description: 'latest/recent news freshness' },
  { pattern: /\b(últimas?|latest|reciente|recent|noticias?|news|breaking)\b/i, intent: 'webSearch', weight: 8, description: 'news/latest' },
  { pattern: /\b(precio|cotización|exchange rate)\b.*\b(dólar|euro|bitcoin|crypto)\b/i, intent: 'webSearch', weight: 10, description: 'price of currency/crypto' },
  // Recency adds minor score to webSearch
  { pattern: /(?:^|\s)(hoy|today|ahora|now|actual|current|últim[oa]s?|latest|reciente|recent|este año|this year|esta semana|this week|ayer|yesterday)(?:\s|$|[?,.])/i, intent: 'webSearch', weight: 3, description: 'recency indicator' },
]

function scoreQuery(query: string): Record<RoutingDecision, number> {
  const scores: Record<RoutingDecision, number> = {
    webSearch: 0,
    getDateTime: 0,
    getWeather: 0,
    mexicoNewsDigest: 0,
    newsDigest: 0,
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

function topDecision(scores: Record<RoutingDecision, number>): {
  decision: RoutingDecision
  confidence: number
  scores: Record<RoutingDecision, number>
} {
  let best: RoutingDecision = 'none'
  let bestScore = 0

  for (const [intent, score] of Object.entries(scores) as [RoutingDecision, number][]) {
    if (score > bestScore) {
      bestScore = score
      best = intent
    }
  }

  const confidence = bestScore >= 8 ? 1.0 : bestScore >= 5 ? 0.85 : 0

  return { decision: best, confidence, scores }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function routeQuery(query: string): Promise<RouterResult> {
  const normalizedQuery = normalizeQuery(query)
  debugLog(`[router] query: "${normalizedQuery}"`)
  const scores = scoreQuery(normalizedQuery)
  const { decision, confidence, scores: debugScores } = topDecision(scores)

  // Log scores in debug mode
  if (process.env['NULL_DEBUG']) {
    process.stderr.write(`[null-debug] [router] scores: ${JSON.stringify(debugScores)}\n`)
    process.stderr.write(`[null-debug] [router] top decision: ${decision} (confidence: ${confidence})\n`)
  }

  // If score is high enough, use heuristic directly
  if (confidence > 0) {
    // For 'none' decisions with recency signals: don't force none if web is close
    if (decision === 'none' && scores.webSearch >= 3) {
      // Recency indicator present even with a "knowledge" match — search is safer
      debugLog(`[router] none+recency → overriding to webSearch`)
      return { decision: 'webSearch', confidence: 0.7, source: 'heuristic' }
    }
    debugLog(`[router] heuristic result: ${decision}`)
    return { decision, confidence, source: 'heuristic' }
  }

  // Low-confidence score: fall back to CLLM (intent-classifier)
  debugLog(`[router] low confidence — falling back to CLLM`)
  const cllm = await classifyIntent(normalizedQuery)
  debugLog(`[router] CLLM result: ${JSON.stringify(cllm)}`)

  const cllmDecision = mapCLLMToDecision(cllm)
  // Only override none→webSearch when CLLM is confident it's news/current-events.
  // For conversation/factual/ambiguous queries, keep none — ReAct will search if needed.
  const finalDecision: RoutingDecision =
    cllmDecision === 'webSearch' && cllm.confidence < 0.6 ? 'none' : cllmDecision

  if (finalDecision !== cllmDecision) {
    debugLog(`[router] CLLM low-confidence webSearch → none (confidence: ${cllm.confidence})`)
  }
  debugLog(`[router] CLLM mapped decision: ${finalDecision} (confidence: ${cllm.confidence})`)
  return { decision: finalDecision, confidence: cllm.confidence, source: 'llm', cllm }
}

// ─── CLLM → RoutingDecision mapper ────────────────────────────────────────────

function mapCLLMToDecision(cllm: CLLMResult): RoutingDecision {
  // Use the first (primary) intent to determine routing
  const primary = cllm.intents[0]
  if (!primary) return 'webSearch'

  const { category, intent } = primary

  if (category === 'general_news') {
    if (intent === 'factual' || intent === 'conversation') return 'none'
    return 'webSearch'
  }

  if (category === 'science') {
    // Factual science/math/history/programming → no search needed
    if (intent === 'factual' || intent === 'conversation') return 'none'
    // "news" about science/tech → search
    return 'webSearch'
  }

  return 'webSearch'
}
