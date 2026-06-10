/**
 * CLLM — Clasificador LLM
 *
 * Classifies a user query into one or more semantic intents using the
 * small router model (qwen2.5:3b). Only invoked when the heuristic scorer
 * in router.ts does not have enough confidence to act directly.
 *
 * Returns an array of ClassifiedIntent to handle mixed queries
 * (e.g. "news + factual background" → two intents executed in parallel).
 *
 * Cache: in-memory, keyed by sha1(last 4 messages + query), TTL 5 min.
 */

import { createHash } from 'crypto'
import { getRouterClient } from './llm-client.js'
import { debugLog } from '../utils/debug.js'

// ─── Public types ─────────────────────────────────────────────────────────────

export type IntentCategory = 'general_news' | 'science'
export type GeneralIntent = 'news' | 'factual' | 'conversation'
export type IntentAction = GeneralIntent

export interface ClassifiedIntent {
  category: IntentCategory
  intent: IntentAction
  /**
   * Semantic anchor extracted by the CLLM — topic, person, place, etc.
   * Used to build precise search queries.
   */
  anchor?: string
}

export interface CLLMResult {
  intents: ClassifiedIntent[]
  confidence: number
  /** True if result was served from in-memory cache */
  cached: boolean
  /** Elapsed ms for the LLM call (0 if cached) */
  elapsedMs: number
}

// ─── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry {
  result: CLLMResult
  expiresAt: number
}

const _cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

function cacheKey(history: { role: string; content: string }[], query: string): string {
  // Use the last 4 messages (2 pairs) + current query as the key
  const relevant = history.slice(-4).map((m) => `${m.role}:${m.content}`).join('|')
  return createHash('sha1').update(`${relevant}||${query}`).digest('hex')
}

function getCached(key: string): CLLMResult | null {
  const entry = _cache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    _cache.delete(key)
    return null
  }
  return { ...entry.result, cached: true, elapsedMs: 0 }
}

function setCache(key: string, result: CLLMResult): void {
  _cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS })
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

const CLASSIFIER_SYSTEM_PROMPT = `You are a strict intent classifier. Analyze the user query (and prior conversation context if present) and classify it.

Categories:
- general_news: news about politics, economy, business, culture, society, current events
- science: science, technology, medicine, programming, math, history, geography, general knowledge

Intents (within each category):
- news: recent news or current events
- factual: established facts, explanations, definitions — things that do not change frequently
- conversation: greetings, opinions, jokes, casual chat

Rules:
- If the topic is clearly current events = "general_news"
- For mixed queries, return multiple intents
- Extract the semantic anchor: main topic of the query
- Maximum 2 intents per response

Respond ONLY with valid JSON. No text before or after.
{
  "intents": [
    { "category": "general_news|science", "intent": "news|factual|conversation", "anchor": "string or null" }
  ],
  "confidence": 0.0-1.0
}`.trim()

// ─── Classifier ───────────────────────────────────────────────────────────────

/**
 * Classify a query using the small router model.
 *
 * @param query     Current user message (normalized)
 * @param history   Prior conversation messages (role/content). Last 4 are used for context.
 */
export async function classifyIntent(
  query: string,
  history: { role: string; content: string }[] = [],
): Promise<CLLMResult> {
  const key = cacheKey(history, query)

  const cached = getCached(key)
  if (cached) {
    debugLog(`[cllm] cache hit (key=${key.slice(0, 8)})`)
    return cached
  }

  const client = getRouterClient()

  // Build context: last 4 messages + current query
  const contextMessages: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
    { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT },
    ...history.slice(-4).map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: query },
  ]

  const t0 = Date.now()
  let raw = ''
  try {
    raw = await client.complete(contextMessages)
    debugLog(`[cllm] raw response: ${raw.trim()}`)
  } catch (err) {
    debugLog(`[cllm] LLM call failed: ${err instanceof Error ? err.message : String(err)}`)
    return fallback()
  }
  const elapsedMs = Date.now() - t0
  debugLog(`[cllm] elapsed: ${elapsedMs}ms`)

  const result = parse(raw, elapsedMs)
  setCache(key, result)
  return result
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface RawCLLMResponse {
  intents?: { category?: string; intent?: string; anchor?: string | null }[]
  confidence?: number
}

const VALID_CATEGORIES = new Set<string>(['general_news', 'science'])
const VALID_INTENTS = new Set<string>(['news', 'factual', 'conversation'])

function parse(raw: string, elapsedMs: number): CLLMResult {
  try {
    // Strip markdown code fences if present
    const cleaned = raw.replace(/```(?:json)?/g, '').replace(/```/g, '').trim()
    const parsed = JSON.parse(cleaned) as RawCLLMResponse

    const intents: ClassifiedIntent[] = (parsed.intents ?? [])
      .filter((i) => VALID_CATEGORIES.has(i.category ?? '') && VALID_INTENTS.has(i.intent ?? ''))
      .slice(0, 2)
      .map((i) => ({
        category: i.category as IntentCategory,
        intent: i.intent as IntentAction,
        anchor: i.anchor ?? undefined,
      }))

    if (intents.length === 0) {
      debugLog('[cllm] no valid intents parsed — using fallback')
      return fallback(elapsedMs)
    }

    const confidence = typeof parsed.confidence === 'number'
      ? Math.min(1, Math.max(0, parsed.confidence))
      : 0.7

    return { intents, confidence, cached: false, elapsedMs }
  } catch (err) {
    debugLog(`[cllm] parse error: ${err instanceof Error ? err.message : String(err)}`)
    return fallback(elapsedMs)
  }
}

/** Safe fallback when the CLLM fails or returns garbage */
function fallback(elapsedMs = 0): CLLMResult {
  return {
    intents: [{ category: 'general_news', intent: 'news' }],
    confidence: 0,
    cached: false,
    elapsedMs,
  }
}
