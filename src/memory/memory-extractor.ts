import { getRouterClient } from '../core/llm-client.js'
import { upsertMemories, normalizeValue, type MemoryType, type UpsertMemoryOptions } from './memory-store.js'
import { debugLog } from '../utils/debug.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExtractedMemory {
  type: MemoryType
  value: string
  confidence: number
  raw: string
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

const TECH_KEYWORDS = [
  'typescript',
  'javascript',
  'python',
  'react',
  'vue',
  'angular',
  'node',
  'nodejs',
  'java',
  'kotlin',
  'swift',
  'rust',
  'go',
  'php',
  'ruby',
  'docker',
  'kubernetes',
  'aws',
  'gcp',
  'azure',
  'postgres',
  'mysql',
  'mongodb',
  'redis',
  'graphql',
  'nextjs',
]

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

// ── Deterministic extractor ──────────────────────────────────────────────────

/**
 * Fast deterministic extraction for high-confidence facts.
 * This runs before routing/fast-path so simple personal statements do not depend
 * on the small LLM extractor finishing successfully in the background.
 */
export function extractDeterministicMemoriesFromMessage(
  message: string,
  sessionId?: string,
): ExtractedMemory[] {
  const extracted: ExtractedMemory[] = []
  const text = message.trim()
  if (!text || text.startsWith('/')) return []

  const push = (item: ExtractedMemory): void => {
    if (extracted.some((m) => m.type === item.type && normalizeValue(m.value) === normalizeValue(item.value))) return
    extracted.push(item)
  }

  const nameMatch = text.match(/\b(?:me llamo|mi nombre es|ll[aá]mame|my name is|call me)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ.'-]*(?:\s+[A-Za-zÁÉÍÓÚÜÑáéíóúüñ][A-Za-zÁÉÍÓÚÜÑáéíóúüñ.'-]*){0,2})/i)
  if (nameMatch) {
    const value = cleanCapture(nameMatch[1])
    if (value) {
      push({ type: 'alias_self', value, confidence: 0.98, raw: nameMatch[0] })
    }
  }

  const locationMatch = text.match(/\b(?:vivo en|estoy en|ubicado en|live in|based in|i(?:'m| am) from)\s+([^,.!?]{2,60})/i)
  if (locationMatch) {
    const value = cleanCapture(locationMatch[1])
    if (value) {
      push({ type: 'location', value, confidence: 0.85, raw: locationMatch[0] })
    }
  }

  const occupationMatch = text.match(/\b(?:soy|trabajo como|work as|i(?:'m| am) a(?:n)?)\s+([^,.!?]{2,50}?\b(?:dev|developer|engineer|ingeniero|programador|architect|arquitecto|devops|qa|tester|designer|diseñador|freelance|consultant|consultor)\b[^,.!?]{0,20})/i)
  if (occupationMatch) {
    const value = cleanCapture(occupationMatch[1])
    if (value) {
      push({ type: 'occupation', value, confidence: 0.9, raw: occupationMatch[0] })
    }
  }

  const behaviorMatch = text.match(/\b(?:prefiero|prefer)\s+(?:respuestas?\s+)?(cortas?|short|breves?|brief|largas?|long|detalladas?|detailed|concisas?|concise)\b/i)
  if (behaviorMatch) {
    push({ type: 'behavior', value: `prefers ${normalizeValue(behaviorMatch[1])} answers`, confidence: 0.85, raw: behaviorMatch[0] })
  }

  const techIntro = /\b(?:uso|use|work with|trabajo con|mi stack|my stack|usamos|we use)\b/i.test(text)
  if (techIntro) {
    const normalized = normalizeTechText(text)
    for (const tech of TECH_KEYWORDS) {
      const re = new RegExp(`\\b${escapeRegex(tech)}\\b`, 'i')
      if (re.test(normalized)) {
        push({ type: 'tech_stack', value: tech, confidence: 0.9, raw: tech })
      }
    }
  }

  if (extracted.length === 0) return []

  upsertMemories(extracted.map((item) => ({
    type: item.type,
    value: item.value,
    rawValue: item.raw,
    confidence: item.confidence,
    source: 'explicit',
    sessionId,
  })))

  debugLog(`[memory-extractor] deterministic: ${extracted.map((m) => `${m.type}=${m.value}`).join(', ')}`)
  return extracted
}

function cleanCapture(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[),.;:!?]+$/u, '')
}

function normalizeTechText(value: string): string {
  return normalizeValue(value)
    .replace(/\bnode\.?js\b/g, 'nodejs')
    .replace(/\bnext\.?js\b/g, 'nextjs')
    .replace(/\bmongo\b/g, 'mongodb')
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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
