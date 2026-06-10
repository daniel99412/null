import { getRouterClient } from '../core/llm-client.js'
import { upsertMemories, upsertMemory, type MemoryType, type UpsertMemoryOptions } from './memory-store.js'
import { debugLog } from '../utils/debug.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExtractedMemory {
  type: MemoryType
  value: string
  confidence: number
  raw: string
}

export function extractDeterministicMemoriesFromMessage(message: string): ExtractedMemory[] {
  const results: ExtractedMemory[] = []
  const namePatterns = [
    /\bme\s+llamo\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+){0,3})/i,
    /\bmi\s+nombre\s+es\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+(?:\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+){0,3})/i,
  ]

  for (const pattern of namePatterns) {
    const match = message.match(pattern)
    if (!match) continue

    const value = match[1].trim().replace(/[.!?,;:]+$/, '')
    const memory: ExtractedMemory = {
      type: 'alias_self',
      value,
      confidence: 1,
      raw: match[0],
    }
    upsertMemory({
      type: memory.type,
      value: memory.value,
      rawValue: memory.raw,
      confidence: memory.confidence,
      source: 'explicit',
    })
    results.push(memory)
    break
  }

  return results
}

// ── Prompt ────────────────────────────────────────────────────────────────────
//
// Short, constrained prompt for qwen2.5:3b.
// We do NOT give it the full conversation — just the single message.
// The model must return a JSON array only, no prose.

const EXTRACTOR_SYSTEM = `You are a personal information extractor.
Extract personal facts about the user from the message.
Return ONLY a JSON array. No explanation, no markdown, no extra text.

Each item must have:
  "type": one of: occupation, tech_stack, goal, project, behavior, dislike, location, alias_self
  "value": canonical lowercase English noun phrase (max 4 words)
  "confidence": 0.0–1.0
  "raw": the original phrase from the message

Rules:
- Only extract facts explicitly stated about the USER (first person)
- Do NOT extract general knowledge, questions, or opinions about others
- Do NOT invent facts not present in the message
- If nothing to extract, return []
- Normalize values: "TypeScript" → "typescript", "Node.js" → "nodejs"

Examples:
User: "soy dev de backend, uso TypeScript y Docker"
Response: [{"type":"occupation","value":"backend developer","confidence":0.9,"raw":"soy dev de backend"},{"type":"tech_stack","value":"typescript","confidence":0.95,"raw":"TypeScript"},{"type":"tech_stack","value":"docker","confidence":0.95,"raw":"Docker"}]

User: "quiero aprender Rust este año"
Response: [{"type":"goal","value":"learn rust","confidence":0.85,"raw":"quiero aprender Rust este año"}]

User: "¿cómo funciona React?"
Response: []`

// ── Parser ────────────────────────────────────────────────────────────────────

const VALID_TYPES = new Set<string>([
  'occupation', 'tech_stack', 'goal', 'project',
  'behavior', 'dislike', 'location', 'alias_self',
])

function parseExtractorResponse(raw: string): ExtractedMemory[] {
  // Strip markdown code fences if present
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

  // Find the JSON array
  const start = cleaned.indexOf('[')
  const end = cleaned.lastIndexOf(']')
  if (start === -1 || end === -1) return []

  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1)) as unknown[]
    if (!Array.isArray(parsed)) return []

    const results: ExtractedMemory[] = []
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue
      const obj = item as Record<string, unknown>

      const type = obj['type']
      const value = obj['value']
      const confidence = obj['confidence']
      const raw = obj['raw']

      if (
        typeof type !== 'string' || !VALID_TYPES.has(type) ||
        typeof value !== 'string' || value.trim().length === 0 ||
        typeof confidence !== 'number' || confidence < 0 || confidence > 1 ||
        typeof raw !== 'string'
      ) {
        continue
      }

      results.push({
        type: type as MemoryType,
        value: value.toLowerCase().trim(),
        confidence,
        raw,
      })
    }

    return results
  } catch {
    return []
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Extract personal memories from a user message using the small LLM.
 * Returns extracted items (may be empty). Never throws — errors are swallowed.
 *
 * @param message   The user's raw message
 * @param hints     Optional category hints from the memory gate (e.g. ['occupation','tech_stack'])
 * @param sessionId Optional session id for event logging
 */
export async function extractMemoriesFromMessage(
  message: string,
  hints: string[] = [],
  sessionId?: string,
): Promise<ExtractedMemory[]> {
  try {
    const client = getRouterClient() // qwen2.5:3b
    debugLog(`[memory-extractor] extracting from: "${message.slice(0, 60)}" hints=[${hints.join(',')}]`)

    const hintNote = hints.length > 0
      ? `\n\nFocus especially on: ${hints.join(', ')}.`
      : ''

    const response = await client.complete([
      { role: 'system', content: EXTRACTOR_SYSTEM },
      { role: 'user', content: message + hintNote },
    ])

    debugLog(`[memory-extractor] LLM raw: ${response.trim().slice(0, 100)}`)
    const extracted = parseExtractorResponse(response)

    // Filter out low-confidence items
    const confident = extracted.filter((e) => e.confidence >= 0.6)

    if (confident.length === 0) {
      debugLog(`[memory-extractor] no confident extractions`)
      return []
    }

    debugLog(`[memory-extractor] extracted ${confident.length} memories: ${confident.map(e => `${e.type}=${e.value}`).join(', ')}`)

    // Persist to DB
    const toUpsert: UpsertMemoryOptions[] = confident.map((e) => ({
      type: e.type,
      value: e.value,
      rawValue: e.raw,
      confidence: e.confidence,
      source: 'extracted' as const,
      sessionId,
    }))

    upsertMemories(toUpsert)

    return confident
  } catch (err) {
    debugLog(`[memory-extractor] error: ${err instanceof Error ? err.message : String(err)}`)
    // Extractor failure must never crash the main flow
    return []
  }
}
