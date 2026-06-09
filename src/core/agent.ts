import { buildGeneralMemoryContext } from '../memory/memory-retrieval.js'
import { getClientForQuery, getModelForQuery, runQueuedLLMCall, type ChatMessage } from './llm-client.js'
import { getRegistry } from '../mcp/registry.js'
import type { OllamaToolFormat } from '../mcp/types.js'
import { loadConfig, DEFAULT_MODEL, DEFAULT_OLLAMA_URL } from '../config/index.js'
import { orchestrateQuery } from './orchestrator.js'
import type { AgentResponse } from './agent.types.js'
import { debugLog } from '../utils/debug.js'

export { debugLog }
export type AgentResult = AgentResponse
export type { FetchedArticle, SearchPipelineResult } from './search-pipeline.js'
export { buildArticleContext, performSearch } from './search-pipeline.js'
export { buildWeatherContext, extractCityFromQuery } from './weather-context.js'

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Process a user query through the routing + tool pipeline.
 * Returns userContent (to send to LLM), optional searchContext (system message),
 * and optional statusMessage (for TUI display while loading).
 *
 * Pure logic — no React state is touched here.
 * onStatus callback is called immediately when a loading status is known,
 * before the async work begins (allows TUI to show status mid-processing).
 */
export async function processQuery(
  query: string,
  isExplicitSearch?: boolean,
  onStatus?: (msg: string) => void,
): Promise<AgentResult> {
  return orchestrateQuery(
    query,
    {
      history: [],
      onStatus,
    },
    { isExplicitSearch },
  )
}

// ─── ReAct loop ───────────────────────────────────────────────────────────────

const REACT_SYSTEM_PROMPT = `You are Null, a knowledgeable AI assistant running in a terminal.
You have access to tools that you can call to help answer the user.
When you need information, call the appropriate tool.
When you have enough information to answer the user, respond directly.
Answer in the same language the user writes in.
NEVER say you cannot access the internet — use the available tools to get current information.
For questions about project documentation or code, use search_docs to find relevant information.
When the user asks about a specific file by name (like "dummy.pdf", "debug.log", "index.ts"), use read_doc to read it.
The file is on the user's local machine — you can read it with read_doc.
Use index_docs if the doc index is empty.`

export interface ReActResult {
  /** Final answer text from LLM */
  answer: string
  /** Number of tool iterations performed */
  iterations: number
}

/**
 * ReAct loop: Reasoning + Acting.
 * Gives the LLM access to tools through structured JSON output.
 * Loops up to maxIterations times; each iteration the LLM either calls a
 * tool (JSON) or produces a final answer (plain text).
 *
 * @param query - User query
 * @param history - Prior conversation messages (role/content pairs)
 * @param onStatus - Optional callback fired with status text each iteration
 * @param onToolCall - Optional callback fired when a tool is about to execute
 * @param maxIterations - Max tool-call iterations (default: 3)
 */
// ─── MCP tool-enabled Ollama call ─────────────────────────────────────────

interface ReactCallResult {
  content: string
  toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>
}

/**
 * Non-streaming Ollama call with the `tools` parameter.
 * Returns structured content + optional tool calls from the LLM.
 */
async function reactCall(
  messages: { role: string; content: string }[],
  tools: OllamaToolFormat[],
  temperature?: number,
  modelOverride?: string,
): Promise<ReactCallResult> {
  const config = loadConfig()
  const baseUrl = config.ollamaUrl ?? DEFAULT_OLLAMA_URL
  const model = modelOverride ?? config.model ?? DEFAULT_MODEL

  const body: Record<string, unknown> = {
    model,
    stream: false,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
    tools,
    think: false,
    options: temperature !== undefined ? { temperature } : undefined,
  }

  const res = await runQueuedLLMCall(() => fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))

  if (!res.ok) {
    throw new Error(`Ollama request failed: ${res.status}`)
  }

  const data = await res.json() as {
    message?: {
      content?: string
      tool_calls?: Array<{
        function: { name: string; arguments: string }
      }>
    }
  }

  const content = data.message?.content ?? ''

  if (data.message?.tool_calls && data.message.tool_calls.length > 0) {
    return {
      content,
      toolCalls: data.message.tool_calls.map(tc => ({
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      })),
    }
  }

  // Fallback: try to parse tool calls from plain text JSON
  const parsed = tryParseToolCallJson(content)
  if (parsed && parsed.length > 0) {
    debugLog(`[agent] parsed tool call from plain text: ${parsed[0].name}`)
    return { content, toolCalls: parsed }
  }

  return { content }
}

/**
 * Fallback parser for LLM responses that embed raw JSON tool calls
 * (e.g. {"name":"read_doc","arguments":{...}}) in conversational text.
 * Scans for JSON object boundaries by tracking brace depth.
 */
function tryParseToolCallJson(text: string): Array<{ name: string; arguments: Record<string, unknown> }> | null {
  const results: Array<{ name: string; arguments: Record<string, unknown> }> = []

  // Scan through text, try to extract JSON objects
  let i = 0
  while (i < text.length) {
    const braceStart = text.indexOf('{', i)
    if (braceStart === -1) break

    // Track brace depth to find the matching closing brace
    let depth = 0
    let j = braceStart
    for (; j < text.length; j++) {
      if (text[j] === '{') depth++
      else if (text[j] === '}') {
        depth--
        if (depth === 0) break
      }
    }
    if (depth !== 0) { i = braceStart + 1; continue }

    const candidate = text.slice(braceStart, j + 1)
    try {
      const obj = JSON.parse(candidate)
      if (obj && typeof obj === 'object' && obj.name && obj.arguments) {
        results.push({ name: obj.name, arguments: obj.arguments as Record<string, unknown> })
      }
    } catch {
      // Not valid JSON, try next position
    }
    i = braceStart + 1
  }

  return results.length > 0 ? results : null
}

/**
 * Detect whether a query is primarily Spanish or English.
 * Returns a language label suitable for injecting into prompts.
 */
function detectQueryLanguage(text: string): string {
  const spanishSignals = /\b(que|qué|cómo|como|cuándo|cuando|dónde|donde|quién|quien|es|son|está|están|tiene|tienen|hoy|mañana|puedes|puedo|dame|dime|sabes|lloverá|llovera|clima|tiempo|gracias|por favor|porfa)\b/i
  return spanishSignals.test(text) ? 'Spanish' : 'English'
}

/**
 * Returns true if the LLM response signals that it lacks specific knowledge
 * and would benefit from a web search.
 */
function looksUncertain(text: string): boolean {
  const signals = [
    /\bneed more (specific|detail|info)/i,
    /\bcould you (please )?(specify|clarify|tell me more)/i,
    /\bI('m| am) not (sure|certain|aware)/i,
    /\bI don'?t have (specific|detailed|current|recent|enough)/i,
    /\bI (don'?t|cannot|can'?t) (find|confirm|verify|access)/i,
    /\bno (specific|detailed) information/i,
    /\bappears to be\b.*\bbut I (need|don'?t have)/i,
    /\bplease (provide|give me|share) more/i,
    /\bwhich (episode|aspect|part|season)/i,
    /\bcould you (elaborate|describe|explain)/i,
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
  const client = getClientForQuery(query)
  const registry = getRegistry()
  const lang = detectQueryLanguage(query)
  const langInstruction = `IMPORTANT: Respond in ${lang}. The user wrote in ${lang} — always reply in ${lang} regardless of the language of the source material.`

  debugLog(`ReAct history length: ${history.length} messages`)
  history.forEach((m, i) => debugLog(`  [${i}] ${m.role}: ${m.content.slice(0, 60)}`))

  // Get tool schemas from MCP registry for the Ollama tools parameter
  const ollamaTools = registry.getOllamaTools()
  debugLog(`[agent] ReAct using ${ollamaTools.length} tools from registry`)

  // Inject memory context into system prompt if available
  const memCtx = buildGeneralMemoryContext(query)
  const systemPrompt = memCtx
    ? `${REACT_SYSTEM_PROMPT}\n\n${memCtx}`
    : REACT_SYSTEM_PROMPT
  if (memCtx) debugLog(`[agent] injected memory context:\n${memCtx}`)

  // Build message list: system + prior history + current user query
  const messages: { role: string; content: string }[] = [
    { role: 'system', content: systemPrompt },
    ...history.map((m) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: query },
  ]

  let hasExternalData = false

  for (let i = 0; i < maxIterations; i++) {
    debugLog(`ReAct iteration ${i + 1}/${maxIterations}`)

    // Use lower temperature when grounding on external tool data
    const temperature = hasExternalData ? 0.3 : undefined

    const response = await reactCall(messages, ollamaTools, temperature, getModelForQuery(query))
    const fullContent = response.content
    const toolCalls = response.toolCalls

    debugLog(`ReAct LLM response: ${fullContent.slice(0, 100)}...${toolCalls ? ` (${toolCalls.length} tool calls)` : ' (text)'}`)

    if (!toolCalls || toolCalls.length === 0) {
      // LLM produced a text response — check for uncertainty on first pass
      if (i === 0 && looksUncertain(fullContent)) {
        debugLog('ReAct: LLM uncertain on first pass — forcing web_search')
        onStatus?.('Searching the web...')
        onToolCall?.('web_search')
        let searchObservation: string
        try {
          const searchResult = await registry.executeTool('web_search', { query })
          searchObservation = typeof searchResult === 'string'
            ? searchResult
            : JSON.stringify(searchResult, null, 2)
        } catch (err) {
          searchObservation = `Search failed: ${err instanceof Error ? err.message : String(err)}`
        }
        messages.push({ role: 'assistant', content: fullContent })
        messages.push({
          role: 'user',
          content: `[Web search results for "${query}"]\n${searchObservation}\n\nNow answer the user's original question using the above data. Be specific and detailed.\n${langInstruction}`,
        })
        hasExternalData = true
        continue
      }
      // Final answer
      debugLog(`ReAct final answer after ${i + 1} iteration(s)`)
      return { answer: fullContent, iterations: i + 1 }
    }

    // LLM wants to use one or more tools
    for (const tc of toolCalls) {
      const toolName = tc.name
      debugLog(`ReAct tool call: ${toolName}`)
      onToolCall?.(toolName)

      const statusLabels: Record<string, string> = {
        get_time: 'Getting time...',
        get_weather: 'Getting weather...',
        web_search: 'Searching the web...',
        web_fetch: 'Fetching page...',
        get_location: 'Getting location...',
        news_digest: 'Fetching news...',
        news_manage_topics: 'Managing topics...',
        search_docs: 'Searching project docs...',
        read_doc: 'Reading file...',
        index_docs: 'Indexing project docs...',
      }
      onStatus?.(statusLabels[toolName] ?? `Running ${toolName}...`)

      let observation: string
      try {
        const result = await registry.executeTool(toolName, tc.arguments)
        observation = typeof result === 'string'
          ? result
          : JSON.stringify(result, null, 2)
        debugLog(`ReAct tool result (${toolName}): ${observation.slice(0, 200)}`)
      } catch (err) {
        observation = `Error executing ${toolName}: ${err instanceof Error ? err.message : String(err)}`
        debugLog(`ReAct tool error: ${observation}`)
      }

      // Add the assistant's response + the tool result to the message thread
      messages.push({ role: 'assistant', content: fullContent || `[Calling tool: ${toolName}]` })
      messages.push({
        role: 'user',
        content: `[Tool result for ${toolName}]\n${observation}\n\nNow answer the user's original question using the above data.\n${langInstruction}`,
      })
      hasExternalData = true
    }
  }

  // Exhausted iterations — ask LLM to produce a final answer with whatever it has
  debugLog('ReAct: max iterations reached, requesting final answer')
  onStatus?.('Composing answer...')
  messages.push({
    role: 'user',
    content: `Please provide your final answer now based on the information collected so far.\n${langInstruction}`,
  })

  let finalAnswer = ''
  await client.streamChat(messages as ChatMessage[], (tok: string) => {
    finalAnswer += tok
  }, hasExternalData ? { temperature: 0.3 } : undefined)

  return { answer: finalAnswer, iterations: maxIterations }
}
