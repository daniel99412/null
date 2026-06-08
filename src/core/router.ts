import { normalizeQuery } from '../utils/normalize.js'
import { debugLog } from '../utils/debug.js'
import { getSportsAliases } from '../memory/memory-store.js'
import { classifyIntent } from './intent-classifier.js'
import type { CLLMResult } from './intent-classifier.js'

export type RoutingDecision = 'webSearch' | 'getDateTime' | 'getWeather' | 'sportsQuery' | 'savePreference' | 'mexicoNewsDigest' | 'newsDigest' | 'none'

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

  // ── SPORTSQUERY ───────────────────────────────────────────────────────────
  { pattern: /\b(resultados?|marcador(es)?|scores?)\b/i, intent: 'sportsQuery', weight: 10, description: 'scores/results' },
  { pattern: /(?:^|\s)(últimos|ultimos)\b.*\b(partidos?|juegos?|encuentros?)\b/i, intent: 'sportsQuery', weight: 10, description: 'last matches' },
  { pattern: /(?:^|\s)(cómo|como|cuánto|cuanto)\b.*(quedó|quedo|terminó|termino|ganó|gano)(?:\s|$|[?,.])/i, intent: 'sportsQuery', weight: 10, description: 'how did it end/who won' },
  { pattern: /\b(tabla\s+de\s+posiciones|tabla\s+general|standings?|clasificaci[oó]n|posiciones)\b/i, intent: 'sportsQuery', weight: 10, description: 'standings' },
  { pattern: /(?:^|\s)(próximos|proximos)\b.*\b(partidos?|juegos?|encuentros?)\b/i, intent: 'sportsQuery', weight: 10, description: 'upcoming matches' },
  { pattern: /\b(calend(a|e)rio|fixture|jornada\s+\d+|jornada\s+siguiente|jornada\s+pasada|ultima\s+jornada|jornada\s+anterior)\b/i, intent: 'sportsQuery', weight: 10, description: 'matchday/fixture' },
  { pattern: /(?:^|\s)(última\s+jornada)(?:\s|$|[?,.])/i, intent: 'sportsQuery', weight: 10, description: 'last matchday' },
  { pattern: /\bjornada\b.*(liga\s*mx|ligamx|la\s+liga|laliga|premier|bundesliga|serie\s+a|champions|ligue)/i, intent: 'sportsQuery', weight: 10, description: 'jornada + league' },
  { pattern: /(liga\s*mx|ligamx|la\s+liga|laliga|premier|bundesliga|serie\s+a|champions|ligue).*\bjornada\b/i, intent: 'sportsQuery', weight: 10, description: 'league + jornada' },
  { pattern: /\bjornada\b.*(estuvo|fue|quedó|quedo|terminó|termino|salió|salio)/i, intent: 'sportsQuery', weight: 10, description: 'jornada result' },
  { pattern: /(?:como|cómo|qué tal|que tal)\b.*\bjornada\b/i, intent: 'sportsQuery', weight: 10, description: 'how was the jornada' },
  { pattern: /\b(liga\s*mx|ligamx|premier\s+league|bundesliga|serie\s+a|la\s+liga|laliga|ligue\s+1|champions\s+league)\b.*\b(hoy|ayer|semana|jornada|partido|resultado|marcador)\b/i, intent: 'sportsQuery', weight: 10, description: 'league + time keyword' },
  { pattern: /\b(hoy|ayer|semana|jornada|partido|resultado|marcador)\b.*\b(liga\s*mx|ligamx|premier|bundesliga|serie\s+a|la\s+liga|laliga|champions)\b/i, intent: 'sportsQuery', weight: 10, description: 'time keyword + league' },
  { pattern: /(?:^|\s)(juega|juegan|jugaron)(?:\s|$|[?,.])/i, intent: 'sportsQuery', weight: 8, description: 'plays/played' },
  { pattern: /(?:^|\s)(jugó|jugara|jugará)/i, intent: 'sportsQuery', weight: 8, description: 'played/will play' },
  { pattern: /\b(partido\s+de|juego\s+de|encuentro\s+de)\b.*\b(hoy|ayer|mañana|esta semana|semana pasada)\b/i, intent: 'sportsQuery', weight: 10, description: 'match of + time' },
  // "noticias de mi equipo / club / deporte" → webSearch (needs real articles)
  { pattern: /\bnoticias?\b.*\b(mi\s+equipo|mi\s+club|f[uú]tbol|futbol|deporte|liga|team|sport)\b/i, intent: 'webSearch', weight: 15, description: 'news about my team/sport' },
  { pattern: /\b(mi\s+equipo|mi\s+club)\b.*\bnoticias?\b/i, intent: 'webSearch', weight: 15, description: 'my team news' },
  // club business events (transfers, ownership, signings) → always webSearch
  { pattern: /\b(venta|compra|vende|compra|vendido|comprado|adquiri[oó]|adquisici[oó]n)\b.*\b(equipo|club|equipo|atlas|chivas|tigres|pumas|america|monterrey|cruz\s*azul|pachuca|toluca|santos|leon|guadalajara)\b/i, intent: 'webSearch', weight: 18, description: 'club sale/acquisition' },
  { pattern: /\b(equipo|club|atlas|chivas|tigres|pumas|america|monterrey|cruz\s*azul|pachuca|toluca|santos|leon|guadalajara)\b.*\b(venta|compra|vendido|comprado|adquiri[oó]|adquisici[oó]n|dueño|propietario|inversi[oó]n)\b/i, intent: 'webSearch', weight: 18, description: 'club ownership/acquisition' },
  { pattern: /\b(fichaje|fichajes|transfer(encia)?|contrat[oó]|renovaci[oó]n|refuerzo|refuerzos|alta|baja)\b/i, intent: 'webSearch', weight: 14, description: 'transfers/contracts' },
  { pattern: /\b(dueño|propietario|directivo|presidente|director\s+deportivo|inversionista)\b.*\b(equipo|club|f[uú]tbol|futbol)\b/i, intent: 'webSearch', weight: 14, description: 'club ownership/executive' },
  // "cómo va / cómo está mi equipo"
  { pattern: /\b(c[oó]mo\s+(va|est[aá]|le\s+fue|qued[oó]))\b.*\bmi\s+(equipo|club)\b/i, intent: 'sportsQuery', weight: 12, description: 'how is my team doing' },
  { pattern: /\bmi\s+(equipo|club)\b.*\b(c[oó]mo\s+(va|est[aá]|le\s+fue|qued[oó]))\b/i, intent: 'sportsQuery', weight: 12, description: 'my team how is it doing' },
  // "qué pasó con / qué hay de mi equipo"
  { pattern: /\b(qu[eé]\s+(pas[oó]|hay|fue|hizo|dijo))\b.*\bmi\s+(equipo|club)\b/i, intent: 'sportsQuery', weight: 12, description: 'what happened with my team' },

  // ── SAVEPREFERENCE — user stating personal sports preference ──────────────
  { pattern: /\bmi equipo(s)? (favorito|fav|preferido)(s)? (es|son|de f[uú]tbol (es|son))\b/i, intent: 'savePreference', weight: 20, description: 'my favorite team' },
  { pattern: /\bmi(s)? (club|equipos?|ligas?|deportes?)(s)? (favorito|preferido|fav)(s)? (es|son)\b/i, intent: 'savePreference', weight: 20, description: 'my favorite club/league/sport' },
  { pattern: /\b(soy del|soy de|le voy al?|le voy a(l)?) \b/i, intent: 'savePreference', weight: 15, description: 'I support team' },
  { pattern: /\b(soy|soy un) (aficionado|fan|seguidor) (de(l)?|al?)\b/i, intent: 'savePreference', weight: 15, description: 'I am a fan of' },
  { pattern: /\bsigo (al?|a|la|las|el|los)\b/i, intent: 'savePreference', weight: 15, description: 'I follow (sigo)' },
  { pattern: /\btambi[eé]n sigo\b/i, intent: 'savePreference', weight: 15, description: 'también sigo' },
  { pattern: /\bme gusta(n)? (el|los|la|las)\b/i, intent: 'savePreference', weight: 14, description: 'me gusta(n)' },
  { pattern: /\bmy (favorite|favourite) (team|club|sport|league) (is|are)\b/i, intent: 'savePreference', weight: 20, description: 'my favorite team (EN)' },
  { pattern: /\bI('m| am) a(n?)? .+ fan\b/i, intent: 'savePreference', weight: 15, description: 'I am a fan (EN)' },
  { pattern: /\bI (support|follow|root for)\b/i, intent: 'savePreference', weight: 12, description: 'I support/follow (EN)' },

  // ── NEWSDIGEST — topic-specific news queries ────────────────────────────
  { pattern: /\b(dame|d[aá]me)\b.*\b(las?\s+)?noticias?\b/i, intent: 'newsDigest', weight: 20, description: 'dame las noticias' },
  { pattern: /\b(me\s+)?(das?|puedes? darme?|puedes?\s+darme|me\s+das)\b.*\b(las?\s+)?noticias?\b/i, intent: 'newsDigest', weight: 20, description: 'me das las noticias' },
  { pattern: /\bqu[eé]\s+pas[oó]\s+(hoy|esta semana|ayer)\b/i, intent: 'newsDigest', weight: 20, description: 'que pasó hoy' },
  { pattern: /\b(que|qu[eé])\s+pas[oó]\s+(hoy|esta semana|ayer)\b/i, intent: 'newsDigest', weight: 20, description: 'que paso hoy' },
  { pattern: /\b(resumen|digest)\b.*\bnoticias?\b/i, intent: 'newsDigest', weight: 18, description: 'resumen de noticias' },
  { pattern: /\bnoticias?\b.*\b(resumen|digest)\b/i, intent: 'newsDigest', weight: 18, description: 'noticias resumen' },
  { pattern: /\b(últimas?|últimos?)\b.*\bnoticias?\b/i, intent: 'newsDigest', weight: 16, description: 'últimas noticias' },
  { pattern: /\bnoticias?\b.*\b(últimas?|recientes?|importantes?)\b/i, intent: 'newsDigest', weight: 16, description: 'noticias importantes' },
  { pattern: /\bnoticias?\b.*\b(de\s+)?(m[eé]xico|internacional|finanzas?|tecnolog[ií]a|ciencia|deportes?|salud)\b/i, intent: 'newsDigest', weight: 16, description: 'noticias de un topic' },
  { pattern: /\b(ponme|p[oó]nme)\b.*\bal\b.*\b(d[ií]a|noticias?)\b/i, intent: 'newsDigest', weight: 14, description: 'ponme al día' },
  { pattern: /\bqu[eé]\s+(se\s+)?(sabe|dice)\s+(hoy|del?\s+(d[ií]a|mundo))\b/i, intent: 'newsDigest', weight: 14, description: 'que se sabe hoy' },
  { pattern: /\b(noticias?|novedades?)\s+(de\s+)?(sobre\s+)?\w{3,}/i, intent: 'newsDigest', weight: 12, description: 'noticias de [algo] generico' },
  { pattern: /(?:^|\s)(qu[eé])\s+(pas[oó]|hay|hubo)\s+(en|de)\s+(tecnolog[ií]a|finanzas?|ciencia|salud|deportes?|internacional|econom[ií]a|negocios|pol[ií]tica|seguridad|educaci[oó]n|cultura)\b/i, intent: 'newsDigest', weight: 18, description: 'que paso en [topic]' },

  // ── WEBSEARCH — recency / news ────────────────────────────────────────────
  { pattern: /\b(20[2-9][4-9]|20[3-9]\d)\b/, intent: 'webSearch', weight: 10, description: 'year post-cutoff' },
  { pattern: /\b(hoy|today|ahorita|ahora|right now)\b.*\b(precio|price|clima|weather|dólar|dollar)\b/i, intent: 'webSearch', weight: 10, description: 'today + price/rate' },
  { pattern: /\b(últimas?|latest|reciente|recent|noticias?|news|breaking)\b/i, intent: 'webSearch', weight: 8, description: 'news/latest' },
  { pattern: /\b(precio|cotización|exchange rate)\b.*\b(dólar|euro|bitcoin|crypto)\b/i, intent: 'webSearch', weight: 10, description: 'price of currency/crypto' },
  // Recency adds minor score to webSearch
  { pattern: /(?:^|\s)(hoy|today|ahora|now|actual|current|últim[oa]s?|latest|reciente|recent|este año|this year|esta semana|this week|ayer|yesterday)(?:\s|$|[?,.])/i, intent: 'webSearch', weight: 3, description: 'recency indicator' },
]

// Dynamic signal: "noticias" + known sports alias (from DB) → webSearch weight 18
// News about a specific team needs real web articles, not ESPN scoreboard.
// Built lazily on first use — DB may not be initialized at module load time.
let _teamNewsSignal: Signal | null = null
function getTeamNewsSignal(): Signal {
  if (_teamNewsSignal) return _teamNewsSignal
  const aliases = getSportsAliases()
  if (aliases.length === 0) {
    _teamNewsSignal = {
      pattern: /$a/,
      intent: 'webSearch',
      weight: 0,
      description: 'empty sports aliases',
    }
    return _teamNewsSignal
  }
  const escaped = aliases.map(a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  _teamNewsSignal = {
    pattern: new RegExp(`(?:noticias?|news).*\\b(${escaped})\\b|\\b(${escaped})\\b.*(?:noticias?|news)`, 'i'),
    intent: 'webSearch',
    weight: 18,
    description: 'news about known sports alias (DB) → webSearch',
  }
  return _teamNewsSignal
}

function scoreQuery(query: string): Record<RoutingDecision, number> {
  const scores: Record<RoutingDecision, number> = {
    webSearch: 0,
    getDateTime: 0,
    getWeather: 0,
    sportsQuery: 0,
    savePreference: 0,
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

  // Dynamic team-news signal (built from DB aliases, lazy).
  // Only load aliases for news-like queries; most routing should not touch SQLite.
  if (/\b(noticias?|news)\b/i.test(query)) {
    try {
      const teamNewsSignal = getTeamNewsSignal()
      if (teamNewsSignal.pattern.test(query)) {
        scores[teamNewsSignal.intent] += teamNewsSignal.weight
        debugLog(`[router] signal match: "${teamNewsSignal.description}" → ${teamNewsSignal.intent} +${teamNewsSignal.weight}`)
      }
    } catch (err) {
      debugLog(`[router] skipped dynamic team-news aliases: ${err instanceof Error ? err.message : String(err)}`)
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

  if (category === 'sports') {
    // Scores/standings → ESPN; news/transfers/ownership → webSearch
    if (intent === 'scores' || intent === 'standings') return 'sportsQuery'
    return 'webSearch'
  }

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
