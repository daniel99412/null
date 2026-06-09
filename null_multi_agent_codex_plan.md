# null Multi-Agent Implementation Plan for Codex

## Goal

Refactor `null` from a stable single-agent TUI assistant into a **logical multi-agent architecture** without running multiple LLM models at the same time.

This is **not** a distributed multi-agent system yet. The first target is a clean in-process architecture where each agent is a specialized module with:

- its own `id`
- its own system prompt, if needed
- restricted tool access
- optional LLM usage
- optional deterministic handler
- shared LLM runtime/client pool
- compatibility with the current public `processQuery()` and `processQueryWithReAct()` behavior

The user runs this locally through Ollama on a Mac with limited shared memory, so the design must avoid loading 3-4 models concurrently.

---

## Current Architecture Summary

Current flow:

```txt
User
 → FastPath
 → routeQuery()
 → processQuery()
    → switch/if blocks for weather, sports, news, web, preferences, ReAct fallback
 → TUI App
```

Key current files:

```txt
src/core/agent.ts
src/core/router.ts
src/core/intent-classifier.ts
src/core/llm-client.ts
src/core/fast-path.ts
src/mcp/registry.ts
src/tui/App.tsx
src/tools/
src/memory/
```

Important observation:

`src/core/agent.ts` is currently doing too much:

- routing dispatch
- weather handling
- sports handling
- news digest handling
- web search/fetch context building
- preference saving
- memory extraction trigger
- ReAct loop
- tool calling
- fallback behavior

The multi-agent refactor should primarily split this file into clear agent modules.

---

## Architectural Target

```txt
User
 → FastPath
 → Orchestrator
 → AgentRegistry
    ├─ DateTimeAgent       deterministic
    ├─ WeatherAgent        deterministic + optional LLM answer
    ├─ SportsAgent         deterministic + optional commentary LLM
    ├─ NewsAgent           deterministic
    ├─ WebSearchAgent      deterministic search + LLM grounded answer
    ├─ PreferencesAgent    deterministic
    ├─ MemoryAgent         background extraction/retrieval
    └─ GeneralAgent        ReAct LLM fallback
 → AgentResponse
 → TUI
```

The key idea:

```txt
Agents are logical profiles/modules.
They do NOT each own a separate model by default.
They share the LLM runtime/client pool.
```

---

## Non-Goals for First Implementation

Do **not** implement these yet:

- MCP server per agent
- separate processes per agent
- remote agents
- memory partitioning by agent
- streaming multiple agents concurrently
- agents delegating to each other recursively
- fine-tuning
- complicated planning trees
- autonomous background loops beyond the existing memory extraction behavior

Those can come later after the in-process agent architecture is clean.

---

## Design Principles

1. **No breaking changes**
   - Keep `processQuery()` callable from the TUI.
   - Keep `processQueryWithReAct()` behavior available through `GeneralAgent`.
   - Do not force large changes in `src/tui/App.tsx` during phase 1.

2. **Shared LLM runtime**
   - All agents use the default model unless they explicitly request `modelOverride`.
   - LLM calls should be serialized by default with `maxConcurrentLLMCalls = 1`.
   - Tool calls can run concurrently when safe.

3. **Agents are not always LLMs**
   - Weather, preferences, date/time, news digest, and parts of sports can be deterministic.
   - Only use LLM where it adds value:
     - final answer composition
     - ReAct loop
     - summarization
     - commentary
     - ambiguous routing
     - code/doc reasoning

4. **Tool restriction by agent**
   - An agent should only see/use the tools it needs.
   - This improves reliability and avoids the model randomly calling unrelated tools.

5. **Fallback always exists**
   - If a specialized agent fails, fallback to `GeneralAgent`.
   - If a deterministic handler cannot answer, return `useReAct: true`.

6. **Observability first**
   - Log selected agent.
   - Log tool calls by agent.
   - Log duration per agent.
   - Keep `NULL_DEBUG=1`.

---

## Recommended File Structure

```txt
src/
├── core/
│   ├── agent.ts                  # Public compatibility layer; thin wrapper
│   ├── agent.types.ts            # Shared agent contracts
│   ├── agent-registry.ts         # Registers and resolves agents
│   ├── orchestrator.ts           # Uses routeQuery() and dispatches agents
│   ├── llm-client.ts             # Refactor to client pool + queue
│   ├── router.ts                 # Keep initially; reused by orchestrator
│   ├── intent-classifier.ts      # Keep initially
│   ├── fast-path.ts              # Keep
│   ├── agents/
│   │   ├── datetime.agent.ts
│   │   ├── weather.agent.ts
│   │   ├── sports.agent.ts
│   │   ├── news.agent.ts
│   │   ├── web-search.agent.ts
│   │   ├── preferences.agent.ts
│   │   ├── memory.agent.ts
│   │   └── general.agent.ts
│   └── react/
│       └── react-loop.ts         # Optional extraction from agent.ts
├── mcp/
│   └── registry.ts               # Add filtered tool schema support
└── tui/
    └── App.tsx                   # Minimal changes initially
```

---

## Agent Types

Create:

```txt
src/core/agent.types.ts
```

Recommended initial contract:

```ts
import type { ChatMessage } from './llm-client.js'
import type { ESPNScoreboard } from '../tools/espn.js'

export type AgentMode = 'deterministic' | 'llm' | 'react'

export interface Agent {
  id: string
  name: string
  description: string
  mode: AgentMode

  /**
   * Optional model override.
   * Most agents should NOT set this.
   * Default behavior uses the shared default LLM model.
   */
  modelOverride?: string

  /**
   * MCP/internal tool names allowed for this agent.
   * Empty array means no tool access.
   */
  tools: string[]

  /**
   * Optional system prompt for LLM/react agents.
   */
  systemPrompt?: string

  handle(query: AgentQuery, context: AgentContext): Promise<AgentResponse>
}

export interface AgentQuery {
  text: string
  originalText: string
  isExplicitSearch?: boolean
  subQueries?: string[]
  attachments?: string[]
}

export interface AgentContext {
  history: ChatMessage[]
  conversationId?: string
  userMemory?: string | null
  onStatus?: (msg: string) => void
  onToolCall?: (toolName: string) => void
}

export interface AgentResponse {
  userContent: string
  searchContext: string | null
  statusMessage: string | null

  /**
   * Existing compatibility flags used by TUI.
   */
  useReAct?: boolean
  directResponse?: string

  /**
   * Sports compatibility fields.
   */
  tableOutput?: string
  seasonPhase?: string
  scoreboard?: ESPNScoreboard
  newsIntent?: boolean
  teamNewsCount?: number

  /**
   * News digest compatibility fields.
   */
  digestArticles?: Array<{
    position: number
    title: string
    url: string
    source: string
    category: string
  }>

  /**
   * Debug/observability.
   */
  agentId?: string
  toolCalls?: Array<{ name: string; arguments?: Record<string, unknown> }>
  durationMs?: number
}
```

This intentionally mirrors the current `AgentResult` shape so the TUI does not need a major rewrite.

---

## Agent Registry

Create:

```txt
src/core/agent-registry.ts
```

Responsibilities:

- register all built-in agents
- get agent by ID
- list agents for `/agents`
- run an agent with timing/debug metadata
- fallback to `GeneralAgent` on failure if requested

Example:

```ts
import type { Agent, AgentContext, AgentQuery, AgentResponse } from './agent.types.js'
import { debugLog } from '../utils/debug.js'

export class AgentRegistry {
  private agents = new Map<string, Agent>()

  register(agent: Agent): void {
    this.agents.set(agent.id, agent)
  }

  get(agentId: string): Agent {
    const agent = this.agents.get(agentId)
    if (!agent) throw new Error(`Unknown agent: ${agentId}`)
    return agent
  }

  list(): Array<{ id: string; name: string; description: string; mode: string; tools: string[] }> {
    return [...this.agents.values()].map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      mode: a.mode,
      tools: a.tools,
    }))
  }

  async run(agentId: string, query: AgentQuery, context: AgentContext): Promise<AgentResponse> {
    const agent = this.get(agentId)
    const started = Date.now()

    debugLog(`[agent:${agent.id}] start: "${query.text}"`)

    try {
      const response = await agent.handle(query, context)
      const durationMs = Date.now() - started

      debugLog(`[agent:${agent.id}] done in ${durationMs}ms`)

      return {
        ...response,
        agentId: agent.id,
        durationMs,
      }
    } catch (err) {
      const durationMs = Date.now() - started
      debugLog(`[agent:${agent.id}] failed after ${durationMs}ms: ${err}`)

      throw err
    }
  }
}

let registry: AgentRegistry | null = null

export function getAgentRegistry(): AgentRegistry {
  if (!registry) {
    registry = new AgentRegistry()
  }

  return registry
}
```

Add a registration function:

```ts
export function registerBuiltinAgents(): void {
  const registry = getAgentRegistry()

  registry.register(dateTimeAgent)
  registry.register(weatherAgent)
  registry.register(sportsAgent)
  registry.register(newsAgent)
  registry.register(webSearchAgent)
  registry.register(preferencesAgent)
  registry.register(memoryAgent)
  registry.register(generalAgent)
}
```

Call this during app initialization.

---

## Orchestrator

Create:

```txt
src/core/orchestrator.ts
```

The orchestrator should initially reuse the existing router.

Do not replace `router.ts` yet.

Example mapping:

```ts
import { routeQuery } from './router.js'
import { getAgentRegistry } from './agent-registry.js'
import type { AgentContext, AgentQuery, AgentResponse } from './agent.types.js'
import { isFastPathConversation } from './fast-path.js'

function mapDecisionToAgent(decision: string): string {
  switch (decision) {
    case 'getDateTime':
      return 'datetime'
    case 'getWeather':
      return 'weather'
    case 'sportsQuery':
      return 'sports'
    case 'webSearch':
      return 'web-search'
    case 'mexicoNewsDigest':
    case 'newsDigest':
      return 'news'
    case 'savePreference':
      return 'preferences'
    case 'none':
    default:
      return 'general'
  }
}

export async function orchestrateQuery(
  text: string,
  context: AgentContext,
  options?: { isExplicitSearch?: boolean },
): Promise<AgentResponse> {
  const registry = getAgentRegistry()

  if (!options?.isExplicitSearch && isFastPathConversation(text)) {
    return {
      userContent: text,
      searchContext: null,
      statusMessage: null,
      useReAct: false,
      agentId: 'fast-path',
    }
  }

  if (options?.isExplicitSearch) {
    return registry.run(
      'web-search',
      {
        text: text.replace(/^\/search\s+/i, '').trim(),
        originalText: text,
        isExplicitSearch: true,
      },
      context,
    )
  }

  const routerResult = await routeQuery(text)
  const agentId = mapDecisionToAgent(routerResult.decision)

  return registry.run(
    agentId,
    {
      text,
      originalText: text,
      isExplicitSearch: false,
    },
    context,
  )
}
```

---

## Public Compatibility Layer

Keep:

```txt
src/core/agent.ts
```

But make it thinner.

Current TUI calls:

```ts
processQuery(resolvedTxt, isExplicitSearch, onStatus)
processQueryWithReAct(...)
```

Keep those exports.

Recommended compatibility wrapper:

```ts
import { orchestrateQuery } from './orchestrator.js'
import type { AgentResponse } from './agent.types.js'
import type { ChatMessage } from './llm-client.js'
import { runReActLoop } from './react/react-loop.js'

export type AgentResult = AgentResponse

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

export const processQueryWithReAct = runReActLoop
```

If `history` is needed by agents later, add an overload or extend TUI call carefully.

---

## Agents

### DateTimeAgent

File:

```txt
src/core/agents/datetime.agent.ts
```

Mode: deterministic  
Tools: none  
LLM: no

Move existing date/time logic here.

```ts
export const dateTimeAgent: Agent = {
  id: 'datetime',
  name: 'Date & Time Agent',
  description: 'Answers current local date and time queries.',
  mode: 'deterministic',
  tools: [],

  async handle(query) {
    const now = new Date()

    const time = now.toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
    })

    const date = now.toLocaleDateString('es-MX', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })

    return {
      userContent: `Current time: ${time}, date: ${date}. User asked: "${query.text}". Answer naturally.`,
      searchContext: null,
      statusMessage: null,
    }
  },
}
```

---

### WeatherAgent

File:

```txt
src/core/agents/weather.agent.ts
```

Mode: deterministic  
Tools: `get_weather`, `get_location` or direct weather functions  
LLM: optional final composition

Move from `agent.ts`:

- `extractCityFromQuery`
- `buildWeatherContext`
- call to `getWeatherByCity`
- call to `getCurrentWeather`

Recommended response should remain compatible:

```ts
return {
  userContent: `${ctx}\n\nPregunta del usuario: ${query.text}`,
  searchContext: null,
  statusMessage: 'Obteniendo clima...',
}
```

If weather fails:

```ts
return {
  userContent: `No se pudo obtener el clima: ${errMsg}. Informa al usuario de forma amable.`,
  searchContext: null,
  statusMessage: 'Obteniendo clima...',
}
```

---

### SportsAgent

File:

```txt
src/core/agents/sports.agent.ts
```

Mode: deterministic + optional commentary  
Tools: `sports_query`, optionally `web_search` fallback  
LLM: optional commentary handled by TUI for now

Move sports block from `processQuery`.

Responsibilities:

- call `buildSportsContext(query.text)`
- inject `buildSportsMemoryContext()`
- supplement thin ESPN news with web search
- retry with sports memory when league/team is missing
- fallback to web search if ESPN cannot resolve
- return existing fields:
  - `tableOutput`
  - `seasonPhase`
  - `scoreboard`
  - `newsIntent`
  - `teamNewsCount`

Do not move TUI commentary streaming yet unless necessary.

---

### NewsAgent

File:

```txt
src/core/agents/news.agent.ts
```

Mode: deterministic  
Tools: `news_digest`, `news_manage_topics`, optional `web_search`  
LLM: no, initially

Move from `agent.ts`:

- `extractNewsTopic`
- `buildTopicNewsDigest`
- `buildAllTopicsDigest`

Return direct response:

```ts
return {
  userContent: query.text,
  searchContext: null,
  statusMessage: `Obteniendo noticias...`,
  directResponse: digest.formatted,
  digestArticles: digest.articles,
}
```

---

### WebSearchAgent

File:

```txt
src/core/agents/web-search.agent.ts
```

Mode: deterministic search + LLM answer downstream  
Tools: `web_search`, `web_fetch`  
LLM: no inside agent initially

Move from `agent.ts`:

- `hasUsefulContent`
- `fetchArticlesAdaptive`
- `buildArticleContext`
- `performSearch`

Return:

```ts
return {
  userContent: query.originalText,
  searchContext: result?.contextMessage ?? null,
  statusMessage: 'Searching the web...',
}
```

For explicit search:

```ts
return {
  userContent: result ? query.text : query.originalText,
  searchContext: result?.contextMessage ?? null,
  statusMessage: 'Searching the web...',
}
```

---

### PreferencesAgent

File:

```txt
src/core/agents/preferences.agent.ts
```

Mode: deterministic  
Tools: none or memory preference functions  
LLM: no

Move:

- `extractPreferencesFromQuery`
- `addPreference`
- `buildPreferenceSavedMessage`

Return `directResponse` when successful.

If it cannot extract a concrete preference, return `useReAct: true`.

---

### MemoryAgent

File:

```txt
src/core/agents/memory.agent.ts
```

Mode: deterministic / background  
Tools: DB read/write  
LLM: optional memory extractor only when gate passes

Do not overbuild yet.

Current behavior:

```ts
if (decision !== 'savePreference') {
  const gateResult = checkMemoryGate(query)
  if (gateResult.shouldExtract) {
    extractMemoriesFromMessage(query, gateResult.hints).catch(() => {/* silent */})
  }
}
```

Move this into a function:

```ts
export function maybeExtractMemoryInBackground(text: string, skip = false): void {
  if (skip) return

  const gateResult = checkMemoryGate(text)
  if (gateResult.shouldExtract) {
    extractMemoriesFromMessage(text, gateResult.hints).catch(() => {})
  }
}
```

Call this from orchestrator after routing decision, before running the selected agent.

---

### GeneralAgent

File:

```txt
src/core/agents/general.agent.ts
```

Mode: ReAct  
Tools: all tools initially, later filtered  
LLM: yes

Wrap the current `processQueryWithReAct()` implementation.

For now, `GeneralAgent.handle()` can simply return:

```ts
return {
  userContent: query.text,
  searchContext: null,
  statusMessage: null,
  useReAct: true,
}
```

Then later move the ReAct loop into `GeneralAgent`.

---

## LLM Client Pool and Queue

Current `llm-client.ts` has:

- `getDefaultClient()`
- `getRouterClient()`
- `getCommentaryClient()`

Refactor toward:

```ts
const clientPool = new Map<string, LLMClient>()

export function getClient(model?: string): LLMClient {
  const config = loadConfig()
  const baseUrl = config.ollamaUrl ?? DEFAULT_OLLAMA_URL
  const resolvedModel = model ?? config.model ?? DEFAULT_MODEL
  const key = `${baseUrl}::${resolvedModel}`

  if (!clientPool.has(key)) {
    clientPool.set(key, createOllamaClient({ baseUrl, model: resolvedModel }))
  }

  return clientPool.get(key)!
}
```

Keep compatibility:

```ts
export function getDefaultClient(): LLMClient {
  return getClient()
}

export function getRouterClient(): LLMClient {
  const config = loadConfig()
  return getClient(config.routerModel ?? ROUTER_MODEL)
}

export function getCommentaryClient(): LLMClient {
  return getRouterClient()
}
```

Add optional LLM queue:

```ts
class AsyncQueue {
  private running = 0
  private queue: Array<() => void> = []

  constructor(private readonly concurrency: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= this.concurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve))
    }

    this.running++

    try {
      return await task()
    } finally {
      this.running--
      this.queue.shift()?.()
    }
  }
}
```

Default:

```ts
const llmQueue = new AsyncQueue(1)
```

Use queue around Ollama calls:

```ts
return llmQueue.run(async () => {
  // existing fetch to Ollama
})
```

Reason:

```txt
Even if agents share one model, parallel LLM calls can overload local memory/CPU.
Default maxConcurrentLLMCalls should be 1.
Tool calls can still run concurrently.
```

---

## Recommended Model Config

Current candidate:

```txt
qwen3.5:4b-q4_K_M
```

Recommended use:

```txt
defaultModel = qwen3.5:4b-q4_K_M
routerModel = qwen3.5:4b-q4_K_M
commentaryModel = qwen3.5:4b-q4_K_M
codeModel = optional qwen2.5-coder:7b if needed
```

Do not hardcode model names in agents.

Use config:

```json
{
  "model": "qwen3.5:4b-q4_K_M",
  "routerModel": "qwen3.5:4b-q4_K_M",
  "maxConcurrentLLMCalls": 1,
  "agents": {
    "code": {
      "modelOverride": "qwen2.5-coder:7b"
    }
  }
}
```

The `modelOverride` should be optional and ignored when missing.

---

## Recommended Sampling Parameters

Avoid using this as default:

```json
{
  "presence_penalty": 1.5,
  "temperature": 1,
  "top_k": 20,
  "top_p": 0.95
}
```

Those settings are too creative for a local tool-using assistant. They can cause unnecessary variation, weaker tool discipline, and worse coding consistency.

Recommended presets:

### Default assistant

```json
{
  "presence_penalty": 0.2,
  "temperature": 0.4,
  "top_k": 40,
  "top_p": 0.9
}
```

### ReAct / tool calling

```json
{
  "presence_penalty": 0,
  "temperature": 0.2,
  "top_k": 30,
  "top_p": 0.85
}
```

### Router / classifier

```json
{
  "presence_penalty": 0,
  "temperature": 0,
  "top_k": 20,
  "top_p": 0.8
}
```

### CodeAgent

```json
{
  "presence_penalty": 0,
  "temperature": 0.15,
  "top_k": 30,
  "top_p": 0.8
}
```

### Casual conversation

```json
{
  "presence_penalty": 0.4,
  "temperature": 0.7,
  "top_k": 40,
  "top_p": 0.9
}
```

### Sports commentary / short summaries

```json
{
  "presence_penalty": 0.2,
  "temperature": 0.5,
  "top_k": 40,
  "top_p": 0.9
}
```

Implement options as optional fields in `LLMClient`:

```ts
export interface LLMOptions {
  temperature?: number
  top_p?: number
  top_k?: number
  presence_penalty?: number
}

export interface LLMClient {
  streamChat(
    messages: ChatMessage[],
    onToken: (token: string) => void,
    options?: LLMOptions,
  ): Promise<string>

  complete(
    messages: ChatMessage[],
    options?: LLMOptions,
  ): Promise<string>
}
```

Ollama body:

```ts
options: {
  temperature,
  top_p,
  top_k,
  presence_penalty,
}
```

Only include defined values.

---

## Fine-Tuning Recommendation

Do **not** fine-tune yet.

Before fine-tuning, do these:

1. Better system prompts per agent
2. Tool restrictions per agent
3. Sampling params per mode
4. Small eval set with real null prompts
5. Regression tests for routing and agent output shape
6. Measure latency and failure cases

Fine-tuning is premature until prompt/tool/config tuning is exhausted.

For this project, a better use of time is:

```txt
prompt tuning + tool schemas + agent restrictions + evals
```

not fine-tuning.

---

## Suggested Config Shape

Extend current config with:

```ts
export interface NullConfig {
  ollamaUrl?: string
  model?: string
  routerModel?: string
  commentaryModel?: string
  maxConcurrentLLMCalls?: number

  sampling?: {
    default?: LLMOptions
    router?: LLMOptions
    react?: LLMOptions
    code?: LLMOptions
    casual?: LLMOptions
    commentary?: LLMOptions
  }

  agents?: Record<string, {
    enabled?: boolean
    modelOverride?: string
    samplingPreset?: 'default' | 'router' | 'react' | 'code' | 'casual' | 'commentary'
  }>
}
```

Example config:

```json
{
  "ollamaUrl": "http://localhost:11434",
  "model": "qwen3.5:4b-q4_K_M",
  "routerModel": "qwen3.5:4b-q4_K_M",
  "commentaryModel": "qwen3.5:4b-q4_K_M",
  "maxConcurrentLLMCalls": 1,
  "sampling": {
    "default": {
      "presence_penalty": 0.2,
      "temperature": 0.4,
      "top_k": 40,
      "top_p": 0.9
    },
    "router": {
      "presence_penalty": 0,
      "temperature": 0,
      "top_k": 20,
      "top_p": 0.8
    },
    "react": {
      "presence_penalty": 0,
      "temperature": 0.2,
      "top_k": 30,
      "top_p": 0.85
    },
    "code": {
      "presence_penalty": 0,
      "temperature": 0.15,
      "top_k": 30,
      "top_p": 0.8
    },
    "casual": {
      "presence_penalty": 0.4,
      "temperature": 0.7,
      "top_k": 40,
      "top_p": 0.9
    },
    "commentary": {
      "presence_penalty": 0.2,
      "temperature": 0.5,
      "top_k": 40,
      "top_p": 0.9
    }
  },
  "agents": {
    "general": {
      "enabled": true,
      "samplingPreset": "react"
    },
    "weather": {
      "enabled": true
    },
    "sports": {
      "enabled": true,
      "samplingPreset": "commentary"
    },
    "news": {
      "enabled": true
    },
    "web-search": {
      "enabled": true,
      "samplingPreset": "react"
    },
    "code": {
      "enabled": true,
      "modelOverride": "qwen2.5-coder:7b",
      "samplingPreset": "code"
    }
  }
}
```

---

## MCP Registry Changes

Current `MCPRegistry` exposes all tools through:

```ts
getOllamaTools()
executeTool(name, args)
```

Add filtered access:

```ts
getOllamaToolsFor(allowedToolNames: string[]): OllamaToolFormat[] {
  const allowed = new Set(allowedToolNames)
  return this.getOllamaTools().filter((tool) => allowed.has(tool.function.name))
}
```

Later, support external tool prefixes:

```ts
allowedToolNames = ['web_search', 'web_fetch', 'github__search']
```

The GeneralAgent can initially use all tools:

```ts
registry.getOllamaTools()
```

Specialized agents should use:

```ts
registry.getOllamaToolsFor(agent.tools)
```

---

## TUI Changes

Keep TUI changes minimal at first.

Current `App.tsx` already handles:

- direct response
- ReAct fallback
- sports table + commentary
- search context injection
- streamChat response

Do not rewrite this in phase 1.

Add later:

### `/agents`

Show:

```txt
Available agents:
  datetime       Date & Time Agent        deterministic
  weather        Weather Agent            deterministic
  sports         Sports Agent             deterministic
  news           News Agent               deterministic
  web-search     Web Search Agent         deterministic
  preferences    Preferences Agent        deterministic
  general        General Agent            react
```

### Debug output

When `NULL_DEBUG=1`:

```txt
[orchestrator] decision=getWeather source=heuristic confidence=1
[agent:weather] start
[agent:weather] tool=get_weather city=Guadalajara
[agent:weather] done in 432ms
```

### Optional visual label

Later, messages can show:

```txt
[Weather] ...
[Sports] ...
[General] ...
```

But do not block phase 1 on UI polish.

---

## Migration Phases

### Phase 1 — Agent contracts and registry

Tasks:

- create `src/core/agent.types.ts`
- create `src/core/agent-registry.ts`
- register built-in agents
- no behavior change
- keep `processQuery()` compatible

Acceptance:

```txt
pnpm build
npx tsc --noEmit
existing tests pass
TUI still answers normal prompts
```

Commit:

```txt
feat(agents): add agent contract and registry
```

---

### Phase 2 — Extract deterministic agents

Tasks:

- create `datetime.agent.ts`
- create `weather.agent.ts`
- create `preferences.agent.ts`
- move existing logic out of `agent.ts`
- add orchestrator mapping from router decision to agent

Acceptance:

```txt
"qué hora es" works
"clima en Guadalajara" works
"mi equipo favorito es Atlas" saves preference
no TUI behavior regression
```

Commit:

```txt
feat(agents): extract datetime weather and preferences agents
```

---

### Phase 3 — Extract sports, news, and web search agents

Tasks:

- create `sports.agent.ts`
- create `news.agent.ts`
- create `web-search.agent.ts`
- move helper functions from `agent.ts`
- preserve sports table output
- preserve digest article selection

Acceptance:

```txt
Liga MX results still render table
news digest still returns directResponse
/search still works
web search still injects grounded context
```

Commit:

```txt
feat(agents): extract sports news and web search agents
```

---

### Phase 4 — GeneralAgent and ReAct extraction

Tasks:

- create `general.agent.ts`
- optionally move ReAct loop into `src/core/react/react-loop.ts`
- keep exported `processQueryWithReAct()` for compatibility
- allow GeneralAgent to use all MCP tools initially

Acceptance:

```txt
general questions still answer
doc/file ReAct tools still work
web_search fallback from uncertain LLM still works
```

Commit:

```txt
feat(agents): add general react agent
```

---

### Phase 5 — LLM client pool and sampling presets

Tasks:

- replace singleton-only logic with `getClient(model?)`
- keep `getDefaultClient()`, `getRouterClient()`, `getCommentaryClient()`
- add `LLMOptions`
- support:
  - temperature
  - top_p
  - top_k
  - presence_penalty
- add max concurrent LLM queue with default 1
- add config sampling presets

Acceptance:

```txt
default chat uses default sampling
router uses router sampling
ReAct uses react sampling
sports commentary uses commentary sampling
local Ollama does not get concurrent overloaded calls
```

Commit:

```txt
feat(llm): add client pool queue and sampling presets
```

---

### Phase 6 — Tool filtering per agent

Tasks:

- add `getOllamaToolsFor(allowedToolNames)`
- update ReAct/agent calls to pass restricted tools where appropriate
- GeneralAgent can keep all tools initially

Acceptance:

```txt
WeatherAgent cannot call unrelated tools
WebSearchAgent only sees web_search/web_fetch
CodeAgent only sees docs/code tools if implemented
GeneralAgent still has full fallback access
```

Commit:

```txt
feat(agents): restrict tools per agent
```

---

### Phase 7 — Agent command and debug UX

Tasks:

- add `/agents` command
- display registered agents
- add debug logs:
  - selected agent
  - duration
  - tool calls
  - fallback events

Acceptance:

```txt
/agents lists active agents
NULL_DEBUG=1 shows dispatch logs
normal UI remains clean
```

Commit:

```txt
feat(tui): add agents command and debug dispatch logs
```

---

## Later / Future Work

Only after the above is stable:

### Query decomposition

Example:

```txt
"qué temperatura hace en Chicago y cómo quedó el Atlas"
```

Should become:

```txt
[
  { agent: "weather", query: "temperatura en Chicago" },
  { agent: "sports", query: "cómo quedó el Atlas" }
]
```

Then merge:

```txt
Clima:
...

Atlas:
...
```

Do this after agents are already extracted.

### Agent memory partitioning

Add only if needed:

```txt
agent_memories(agent_id, key, value, created_at, updated_at)
```

Not needed in phase 1.

### MCP server per agent

Move to future. It is useful, but too much too early.

### CodeAgent

Add only if project docs/code workflows are used frequently.

Possible tools:

```txt
search_docs
read_doc
index_docs
```

Sampling:

```json
{
  "presence_penalty": 0,
  "temperature": 0.15,
  "top_k": 30,
  "top_p": 0.8
}
```

---

## Testing Plan

Create or update tests:

```txt
tests/agent-registry.test.ts
tests/orchestrator.test.ts
tests/weather-agent.test.ts
tests/preferences-agent.test.ts
tests/web-search-agent.test.ts
tests/sports-agent.test.ts
tests/news-agent.test.ts
tests/llm-client.test.ts
```

Minimum routing regression cases:

```txt
"hola" → fast-path/general no tool
"qué hora es" → datetime
"qué día es hoy" → datetime
"clima en Guadalajara" → weather
"va a llover en Monterrey" → weather
"cómo quedó el Atlas" → sports
"tabla general liga mx" → sports
"noticias de mi equipo" → web-search or sports-news depending current router behavior
"/search qwen3.5 ollama" → web-search explicit
"mi equipo favorito es Atlas" → preferences
"qué sabes de TypeScript" → general
```

Acceptance criteria:

```txt
pnpm build
npx tsc --noEmit
pnpm test
manual TUI smoke test
```

---

## Success Criteria

The refactor is successful when:

1. `src/core/agent.ts` is small and mostly compatibility glue.
2. Each specialized domain lives in its own agent file.
3. The TUI behavior is unchanged for existing flows.
4. All LLM calls go through a shared client pool.
5. Local inference is protected by `maxConcurrentLLMCalls = 1`.
6. Sampling options can be tuned per mode.
7. Tools can be filtered per agent.
8. `/agents` can list active agents.
9. The architecture supports future query decomposition without rewriting everything again.

---

## Implementation Warning

Do not attempt the entire future architecture in one commit.

The correct path is:

```txt
extract → preserve behavior → add observability → then extend
```

Avoid turning this into a distributed agent framework before the local in-process architecture is clean.

