import { tools } from './tools.js'
import { routeQuery } from './router.js'
import { checkMemoryGate } from '../memory/memory-gate.js'
import { extractDeterministicMemoriesFromMessage, extractMemoriesFromMessage } from '../memory/memory-extractor.js'
import { buildGeneralMemoryContext } from '../memory/memory-retrieval.js'
import { getDefaultClient } from './llm-client.js'
import type { ToolAction } from './toolAction.js'
import { executeAction } from './execute.js'
import { hasDocumentRefs } from './document-context.js'
import { isFastPathConversation } from './fast-path.js'
import { formatToolPrompt, getToolDefinition, toolNames } from './tool-registry.js'
import { buildPromptMessages } from './prompt-builder.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentResult {
  userContent: string
  searchContext: string | null
  statusMessage: string | null
  /** true when router returned 'none' — caller may run ReAct loop */
  useReAct?: boolean
  /** When set, display this text directly without streaming through LLM */
  directResponse?: string
}

import { debugLog } from '../utils/debug.js'

export { debugLog }

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function processQuery(
  query: string,
  isExplicitSearch?: boolean,
  onStatus?: (msg: string) => void,
  sessionId?: string,
): Promise<AgentResult> {
  if (isExplicitSearch) {
    return {
      userContent: query,
      searchContext: null,
      statusMessage: null,
    }
  }

  extractDeterministicMemoriesFromMessage(query, sessionId)

  if (isFastPathConversation(query)) {
    debugLog(`Fast path conversation: "${query}"`)
    return {
      userContent: query,
      searchContext: null,
      statusMessage: null,
      useReAct: false,
    }
  }

  if (hasDocumentRefs(query)) {
    debugLog(`Local document context present — skipping router for: "${query}"`)
    return {
      userContent: query,
      searchContext: null,
      statusMessage: null,
      useReAct: false,
    }
  }

  const routerResult = await routeQuery(query)
  const { decision } = routerResult
  debugLog(`Router decision: ${decision} (source: ${routerResult.source}, confidence: ${routerResult.confidence})`)

  // ── Background memory extraction ──────────────────────────────────────────
  const gateResult = checkMemoryGate(query)
  if (gateResult.shouldExtract) {
    extractMemoriesFromMessage(query, gateResult.hints, sessionId).catch(() => {/* silent */})
  }

  if (decision === 'getDateTime') {
    const t = tools.get_time()
    return {
      userContent: `Current time: ${t.time}, date: ${t.date}. User asked: "${query}". Answer naturally.`,
      searchContext: null,
      statusMessage: null,
    }
  }

  // decision === 'none' — answer directly from LLM knowledge (or via ReAct)
  return {
    userContent: query,
    searchContext: null,
    statusMessage: null,
    useReAct: false,
  }
}

// ─── ReAct loop ───────────────────────────────────────────────────────────────

const REACT_SYSTEM_PROMPT = `You are Null, a knowledgeable AI assistant running in a terminal.
You have access to the following tools. When you need to use a tool, respond ONLY with a JSON block (no other text):

\`\`\`json
{"action": "<tool_name>", ...params}
\`\`\`

Available tools:
${formatToolPrompt()}

When you have enough information to answer, respond normally (no JSON).
Answer in the same language the user writes in.`

export function parseMaybeToolCall(text: string): ToolAction | null {
  // Try ```json ... ``` block first
  const blockMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/)
  if (blockMatch) {
    try {
      const parsed: unknown = JSON.parse(blockMatch[1])
      if (isToolAction(parsed)) return parsed
    } catch {
      // not valid JSON
    }
  }

  // Try any JSON object containing "action" key anywhere in the text
  const jsonMatch = text.match(/\{[^{}]*"action"\s*:\s*"[^"]+?"[^{}]*\}/)
  if (jsonMatch) {
    try {
      const parsed: unknown = JSON.parse(jsonMatch[0])
      if (isToolAction(parsed)) return parsed
    } catch {
      // not valid JSON
    }
  }

  // Try bare JSON object covering most of the response
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) {
    const end = trimmed.lastIndexOf('}')
    if (end !== -1) {
      try {
        const parsed: unknown = JSON.parse(trimmed.slice(0, end + 1))
        if (isToolAction(parsed)) return parsed
      } catch {
        // not valid JSON
      }
    }
  }

  return null
}

function isToolAction(value: unknown): value is ToolAction {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return typeof obj['action'] === 'string' && toolNames().includes(obj['action'] as ToolAction['action'])
}

export interface ReActResult {
  answer: string
  iterations: number
}

function detectQueryLanguage(text: string): string {
  const spanishSignals = /\b(que|qué|cómo|como|cuándo|cuando|dónde|donde|quién|quien|es|son|está|están|tiene|tienen|hoy|mañana|puedes|puedo|dame|dime|sabes|gracias|por favor|porfa)\b/i
  return spanishSignals.test(text) ? 'Spanish' : 'English'
}

function looksUncertain(text: string): boolean {
  const signals = [
    /\bneed more (specific|detail|info)/i,
    /\bcould you (please )?(specify|clarify|tell me more)/i,
    /\bI('m| am) not (sure|certain|aware)/i,
    /\bI don'?t have (specific|detailed|current|recent|enough)/i,
    /\bI (don'?t|cannot|can'?t) (find|confirm|verify|access)/i,
    /\bno (specific|detailed) information/i,
    /\bplease (provide|give me|share) more/i,
    /\bI('m| am) (unfamiliar|not familiar)/i,
    /\bmy knowledge (is limited|doesn'?t include|may not)/i,
  ]
  return signals.some((re) => re.test(text))
}

export async function processQueryWithReAct(
  query: string,
  history: { role: string; content: string }[] = [],
  onStatus?: (msg: string) => void,
  onToolCall?: (toolName: string) => void,
  maxIterations = 3,
): Promise<ReActResult> {
  const client = getDefaultClient()
  const lang = detectQueryLanguage(query)
  const langInstruction = `IMPORTANT: Respond in ${lang}. The user wrote in ${lang} — always reply in ${lang} regardless of the language of the source material.`

  debugLog(`ReAct history length: ${history.length} messages`)
  history.forEach((m, i) => debugLog(`  [${i}] ${m.role}: ${m.content.slice(0, 60)}`))

  const memCtx = buildGeneralMemoryContext(query)
  if (memCtx) debugLog(`[agent] injected memory context:\n${memCtx}`)

  const messages = buildPromptMessages({
    query,
    history: history.map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    })),
    memoryContext: memCtx,
    systemPrompt: REACT_SYSTEM_PROMPT,
  })

  let hasExternalData = false

  for (let i = 0; i < maxIterations; i++) {
    debugLog(`ReAct iteration ${i + 1}/${maxIterations}`)

    const iterOptions = hasExternalData ? { temperature: 0.3 } : undefined

    let fullResponse = ''
    await client.streamChat(messages, (tok) => {
      fullResponse += tok
    }, iterOptions)

    debugLog(`ReAct LLM response: ${fullResponse.slice(0, 120)}...`)

    const toolCall = parseMaybeToolCall(fullResponse)

    if (!toolCall) {
      if (i === 0 && looksUncertain(fullResponse)) {
        debugLog('ReAct: LLM uncertain on first pass — no web search available, returning as-is')
      }
      debugLog(`ReAct final answer after ${i + 1} iteration(s)`)
      return { answer: fullResponse, iterations: i + 1 }
    }

    // LLM wants to use a tool
    const toolName = toolCall.action
    debugLog(`ReAct tool call: ${toolName}`)
    onToolCall?.(toolName)

    onStatus?.(getToolDefinition(toolName).statusLabel)

    let observation: string
    try {
      const result = await executeAction(toolCall)
      observation = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
      debugLog(`ReAct tool result (${toolName}): ${observation.slice(0, 200)}`)
    } catch (err) {
      observation = `Error executing ${toolName}: ${err instanceof Error ? err.message : String(err)}`
      debugLog(`ReAct tool error: ${observation}`)
    }

    messages.push({ role: 'assistant', content: fullResponse })
    messages.push({
      role: 'system',
      content: `[Tool observation: ${toolName}]\n${observation}\n\nUse this tool observation to answer the user's original question.\n${langInstruction}`,
    })
    hasExternalData = true
  }

  debugLog('ReAct: max iterations reached, requesting final answer')
  onStatus?.('Composing answer...')
  messages.push({
    role: 'user',
    content: `Please provide your final answer now based on the information collected so far.\n${langInstruction}`,
  })

  let finalAnswer = ''
  await client.streamChat(messages, (tok) => {
    finalAnswer += tok
  }, hasExternalData ? { temperature: 0.3 } : undefined)

  return { answer: finalAnswer, iterations: maxIterations }
}
