// Memory Gate — fast heuristic check (no LLM, ~0ms)
//
// Determines whether a user message is likely to contain personal information
// worth extracting. Conservative by design: false negatives are OK (we miss
// some memories), false positives are costly (trigger LLM extractor on noise).
//
// The gate is intentionally separate from the router's savePreference signals.
// The router handles explicit "save this preference" intents (sports teams, leagues).
// The gate handles broader personal info that should be stored silently.

// ── Signals ───────────────────────────────────────────────────────────────────

// Each signal maps to a MemoryType category so the extractor knows what to focus on.
export type GateSignal = {
  pattern: RegExp
  hint: string   // hint passed to extractor to narrow focus
}

const GATE_SIGNALS: GateSignal[] = [
  // Occupation / role
  { pattern: /\b(soy|trabajo como|work as|i('m| am) a(n?)?)\b.{0,30}\b(dev|developer|engineer|ingeniero|programador|architect|arquitecto|devops|qa|tester|diseñador|designer|freelance|consultant|consultor)\b/i, hint: 'occupation' },
  { pattern: /\b(mi (trabajo|puesto|rol|cargo|profesion)|my (job|role|position|title))\b/i, hint: 'occupation' },

  // Tech stack
  { pattern: /\b(uso|use|work with|trabajo con|my stack|mi stack|usamos|we use)\b.{0,40}\b(javascript|typescript|python|react|vue|angular|node|java|kotlin|swift|rust|go|php|ruby|c\+\+|c#|\.net|docker|kubernetes|aws|gcp|azure|postgres|mysql|mongo|redis|graphql|next\.?js|nuxt|django|laravel|rails|spring|express)\b/i, hint: 'tech_stack' },

  // Goals
  { pattern: /\b(quiero (aprender|estudiar|dominar|mejorar)|want to (learn|master|improve|study)|estoy aprendiendo|i('m| am) learning|me gustaria aprender)\b/i, hint: 'goal' },

  // Projects
  { pattern: /\b(estoy (trabajando|construyendo|desarrollando)|i('m| am) (working on|building|developing)|mi (proyecto|app|aplicacion|sistema|plataforma)|my (project|app|application|system|platform))\b/i, hint: 'project' },

  // Behavior preferences
  { pattern: /\b(prefiero (respuestas|que me|que seas)|prefer (short|long|detailed|concise|brief)|no me (gustan|gusta) (las respuestas|los textos)|i (prefer|like) (short|long|detailed|concise)\b)/i, hint: 'behavior' },

  // Name
  { pattern: /\b(me llamo|mi nombre es|my name is|i('m| am) called|llamame|call me)\b/i, hint: 'alias_self' },

  // Location
  { pattern: /\b(vivo en|live in|i('m| am) (from|based in)|soy de|estoy en|ubicado en|based in)\b/i, hint: 'location' },

  // Dislikes
  { pattern: /\b(odio|detesto|no (me gusta|soporto)|hate|can't stand|dislike)\b.{0,30}\b(framework|library|libreria|lenguaje|language|tool|herramienta)\b/i, hint: 'dislike' },
]

// Messages shorter than this are almost never informational about the user
const MIN_LENGTH = 12

// Messages longer than this are likely complex queries, not personal statements
const MAX_LENGTH = 500

// ── Public API ────────────────────────────────────────────────────────────────

export interface GateResult {
  shouldExtract: boolean
  hints: string[]   // which categories to focus on
}

/**
 * Quickly determines if a message likely contains personal info worth extracting.
 * Returns false for short queries, questions, commands, and noise.
 */
export function checkMemoryGate(message: string): GateResult {
  const trimmed = message.trim()

  // Fast rejections
  if (trimmed.length < MIN_LENGTH || trimmed.length > MAX_LENGTH) {
    return { shouldExtract: false, hints: [] }
  }

  // Skip pure questions (likely info-seeking, not info-giving)
  const isQuestion = /^\s*(que|qué|como|cómo|cuando|cuándo|donde|dónde|quien|quién|cual|cuál|cuanto|cuánto|what|how|when|where|who|which|why|can you|could you|do you|is there|are there)\b/i.test(trimmed)
    || trimmed.endsWith('?')
  if (isQuestion) {
    return { shouldExtract: false, hints: [] }
  }

  // Skip slash commands
  if (trimmed.startsWith('/')) {
    return { shouldExtract: false, hints: [] }
  }

  // Match against signals
  const hints = new Set<string>()
  for (const signal of GATE_SIGNALS) {
    if (signal.pattern.test(trimmed)) {
      hints.add(signal.hint)
    }
  }

  if (hints.size === 0) {
    return { shouldExtract: false, hints: [] }
  }

  return { shouldExtract: true, hints: Array.from(hints) }
}
