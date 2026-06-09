# Multi-Agent Architecture Plan

## Current State (Single Agent)

```
User → Router (heuristic + CLLM) → processQuery() → LLM + Tools
                                  → processQueryWithReAct() → LLM + MCP Tools
```

- **Router**: clasificador, decide qué *tool* ejecutar
- **processQuery**: orquestador monolítico con switch/case de decisiones
- **processQueryWithReAct**: ReAct loop con un solo LLM + tools planas
- **MCP Registry**: catálogo unificado de tools internas + servidores externos
- **Memory**: sistema plano, sin partición por agente
- **LLM Clients**: singleton `getDefaultClient()` + `getRouterClient()`

---

## Target State (Multi-Agent)

```
User → Orchestrator Agent ─┬─ Sports Agent (ESPN specialist)
                            ├─ News Agent (news digest / RSS)
                            ├─ Weather Agent (OpenWeather)
                            ├─ Code Agent (project docs / ReAct)
                            ├─ Web Search Agent (DuckDuckGo + fetch)
                            ├─ Memory Agent (read/write user profile)
                            ├─ Preferences Agent (save preferences)
                            └─ General Agent (conversation, knowledge)
```

Cada agente es un LLM autónomo con:
- System prompt especializado
- Herramientas propias (restringidas)
- Estado/memoria propio (opcional)
- Capacidad de delegar sub-tareas al Orchestrator u otros agentes

---

## Architecture Components

### 1. Orchestrator Agent (`src/core/orchestrator.ts`)
- **Nuevo**: reemplaza `router.ts` + `intent-classifier.ts` + `processQuery()`
- Rol: recibir la query del usuario, clasificarla, delegar al agente correcto
- Input: `{ query, history, userMemory }`
- Output: `{ agentId, query, context }` o respuesta directa
- Capacidad de **descomposición**: si la query es compleja (ej. "dime el clima y los resultados del atlas"), partirla en sub-queries y distribuirlas
- Modelo: pequeño/barato (`qwen2.5:3b`, igual que el CLLM actual)

### 2. Agent Interface (`src/core/agent.types.ts`)
- **Nuevo**: define el contrato que todos los agentes deben cumplir

```typescript
interface Agent {
  id: string
  name: string
  description: string
  systemPrompt: string
  tools: string[] // nombres de tools permitidas (desde MCP registry)
  handle(query: AgentQuery, context: AgentContext): Promise<AgentResponse>
}

interface AgentQuery {
  text: string
  originalQuery: string
  subQueries?: string[]
  memory?: string
  attachments?: string[]
}

interface AgentContext {
  history: ChatMessage[]
  userMemory: string | null
  conversationId: string
}

interface AgentResponse {
  content: string
  followUp?: boolean
  statusMessage?: string
  toolCalls?: ToolCall[]
}
```

### 3. Agent Registry (`src/core/agent-registry.ts`)
- **Nuevo**: reemplaza y extiende `MCPRegistry` a nivel agente
- Registra agentes disponibles
- Expone `/agents` para discovery
- Maneja ciclo de vida: init, health, shutdown

### 3b. LLM Client Pool (`src/core/llm-client.ts`)
- **Refactor**: en vez de singletons `getDefaultClient()` / `getRouterClient()`, usar un pool cachead por clave `(baseUrl, model)`
- Todos los agentes que usen el mismo modelo comparten el mismo cliente
- Si se añade un segundo modelo después, el pool lo soporta sin cambios

```typescript
const clientPool = new Map<string, LLMClient>()

function getClient(model?: string): LLMClient {
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

### 4. Agent Router (`src/core/agent-router.ts`)
- **Nuevo**: Ruteo de segundo nivel
- Distribuye sub-queries a múltiples agentes
- Recolecta y mergea respuestas
- Resuelve dependencias entre agentes

### 5. Memory Partitioning (`src/memory/`)
- Cada agente tiene **namespace** propio en SQLite (tabla `agent_memories` con columna `agent_id`)
- Memory Agent dedicado: lee/escribe memoria de usuario + memoria de agentes
- Memoria compartida (preferencias de usuario) disponible para todos
- Memoria privada (estado interno del agente) aislada

### 6. MCP Server Mode (`src/mcp/agent-server.ts`)
- Cada agente puede ejecutarse como **MCP server independiente** (stdio)
- Permite que agentes corran en procesos separados o incluso en otras máquinas
- Compatible con el protocolo MCP estándar

### 7. TUI Layer (`src/tui/`)
- Indicador visual de qué agente está respondiendo
- Soporte para respuestas paralelas / concurrentes
- Logging por agente en debug mode

---

## Migration Phases

### Phase 1 — Agent Interface & Registry (semana 1-2)
- [ ] Crear `src/core/agent.types.ts` con interfaces `Agent`, `AgentQuery`, `AgentResponse`
- [ ] Crear `AgentRegistry` class (singleton, similar a `MCPRegistry`)
- [ ] Refactor `MCPRegistry.executeTool()` para que los agentes usen tools vía registry
- [ ] Tests: unit tests de AgentRegistry, integración con MCPRegistry
- **Riesgo**: bajo — código nuevo, no toca flujo existente
- **Verificación**: `npx tsc --noEmit`

### Phase 2 — First Agent: GeneralAgent (semana 2-3)
- [ ] Crear `src/core/agents/general.agent.ts`
  - System prompt = `DEFAULT_SYSTEM_PROMPT` actual (`ollama.ts`)
  - Tools = todas las tools actuales
  - Handler = `processQueryWithReAct()` actual
- [ ] Crear `src/core/agents/orchestrator.agent.ts`
  - System prompt = clasificador + descomposición
  - Handler similar a `routeQuery()` + dispatch
- [ ] Integrar en `agent.ts`: `processQuery()` delega a Orchestrator → GeneralAgent
- [ ] No cambiar comportamiento externo — solo encapsular
- **Riesgo**: medio — tocar `agent.ts`, pero manteniendo API pública igual
- **Verificación**: `pnpm build`, probar flujos normal, sports, weather, web search

### Phase 3 — Specialized Agents (semana 3-5)
- [ ] **Sports Agent** (`src/core/agents/sports.agent.ts`)
  - Handler: `buildSportsContext()` actual
  - Tools: solo `sports_query`
  - Model: `qwen2.5-coder:7b` (el default)
- [ ] **News Agent** (`src/core/agents/news.agent.ts`)
  - Handler: `buildTopicNewsDigest()` / `buildAllTopicsDigest()` actual
  - Tools: `news_digest`, `news_manage_topics`, `web_search`
- [ ] **Weather Agent** (`src/core/agents/weather.agent.ts`)
  - Handler: `getCurrentWeather()` / `getWeatherByCity()` actual
  - Tools: `get_weather`, `get_location`
- [ ] **Web Search Agent** (`src/core/agents/web-search.agent.ts`)
  - Handler: `performSearch()` actual
  - Tools: `web_search`, `web_fetch`
- [ ] **Code Agent** (`src/core/agents/code.agent.ts`)
  - Handler: ReAct loop con tools de proyecto
  - Tools: `search_docs`, `read_doc`, `index_docs`
- [ ] **Memory Agent** (`src/core/agents/memory.agent.ts`)
  - Handler: `extractMemoriesFromMessage()`, `retrieveMemories()`
  - Tools: solo lectura/escritura de DB
  - Se ejecuta en background (fire-and-forget como ahora)
- **Riesgo**: medio-alto — cada agente necesita su propio testing
- **Verificación**: probar cada agente individualmente con queries representativas

### Phase 4 — Agent Router con descomposición (semana 5-6)
- [ ] Crear `AgentRouter` — toma query, la parte en sub-queries, las distribuye
- [ ] Implementar merge strategies: `concatenate`, `summarize`, `pickBest`
- [ ] Implementar resolución de dependencias (ej. sports depende de preferences primero)
- [ ] Soporte para queries mixtas: "qué temperatura hace en Chicago y quién ganó la Champions?"
  - → Orchestrator parte en `[weather: Chicago, sports: Champions scores]`
  - → Ambos agentes ejecutan en paralelo
  - → Router mergea respuestas con estrategia `concatenate`
- **Riesgo**: alto — lógica nueva de scheduling y merge
- **Verificación**: tests de integración con queries compuestas

### Phase 5 — MCP Agent Server (semana 6-7)
- [ ] Crear `src/mcp/agent-server.ts`
  - Exporta un agente como servidor MCP stdio
  - Usa `StdioServerTransport` del SDK MCP
- [ ] Config: `opencode.json` / `~/.null-cli/config.json` soporta `agents` como MCP servers
- [ ] Ejemplo: Sports Agent como proceso aparte
- **Riesgo**: medio — depende de madurez del SDK MCP
- **Verificación**: conectar agente como MCP server externo y probar

### Phase 6 — Memory & State por agente (semana 7-8)
- [ ] Migrar esquema SQLite: tabla `agent_memories(agent_id, key, value, ...)`
- [ ] Memory Agent lee/escribe en namespace correcto
- [ ] Memoria compartida (user preferences) vs privada (agente state)
- [ ] Cache de respuestas por agente (TTL configurable)
- **Riesgo**: medio — migración de DB, compatibilidad hacia atrás
- **Verificación**: `pnpm build`, datos anteriores deben ser accesibles

### Phase 7 — TUI Multi-Agent (semana 8-9)
- [ ] Indicador visual: `[Sports]` / `[News]` / `[Code]` en mensajes
- [ ] Stream concurrente cuando múltiples agentes responden
- [ ] Manejo de errores por agente (si un agente falla, los otros continúan)
- [ ] `/agents` comando para listar/inspeccionar agentes activos
- **Riesgo**: bajo-medio — cambios UI, no toca lógica core
- **Verificación**: inspección visual + tests de componentes

### Phase 8 — Observabilidad & Debugging (semana 9)
- [ ] Logging estructurado por agente (`[agent:sports] ...`, `[agent:orchestrator] ...`)
- [ ] `NULL_DEBUG=1` muestra dispatch tree de agentes
- [ ] Métricas: tiempo por agente, tools usadas, errores
- [ ] Health check endpoint por agente
- **Riesgo**: bajo
- **Verificación**: `NULL_DEBUG=1 pnpm start 2>debug.log`

---

## Estructura final de archivos

```
src/
├── index.ts
├── core/
│   ├── orchestrator.ts          # Nuevo: agente orquestador central
│   ├── agent.types.ts           # Nuevo: interfaces Agent, AgentQuery, AgentResponse
│   ├── agent-registry.ts        # Nuevo: registro y ciclo de vida de agentes
│   ├── agent-router.ts          # Nuevo: ruteo, descomposición, merge
│   ├── agents/
│   │   ├── general.agent.ts     # Nuevo: agente conversacional (ReAct)
│   │   ├── sports.agent.ts      # Nuevo: ESPN specialist
│   │   ├── news.agent.ts        # Nuevo: news digest
│   │   ├── weather.agent.ts     # Nuevo: OpenWeather
│   │   ├── web-search.agent.ts  # Nuevo: DDG search + fetch
│   │   ├── code.agent.ts        # Nuevo: project docs + ReAct
│   │   ├── memory.agent.ts      # Nuevo: memoria de usuario
│   │   └── preferences.agent.ts # Nuevo: preferencias
│   ├── agent.ts                 # Refactor: delgado, delega a orchestrator
│   ├── router.ts                # Se elimina (reemplazado por orchestrator)
│   ├── intent-classifier.ts     # Se elimina o refactoriza dentro de orchestrator
│   ├── llm-client.ts            # Refactor: pool cachead por (baseUrl, model) — un solo client compartido
│   ├── ollama.ts                # Refactor: posible eliminación (todo pasa por llm-client pool)
│   ├── fast-path.ts             # Se mantiene (optimización pre-orchestrator)
│   └── tool-definitions.ts      # Se mantiene (cada agente referencia subsets)
├── mcp/
│   ├── registry.ts              # Refactor: integración con AgentRegistry
│   ├── agent-server.ts          # Nuevo: exporta agente como MCP server
│   ├── null-tools.ts            # Se mantiene
│   ├── init.ts                  # Refactor: inicia agentes MCP externos
│   └── types.ts                 # Se mantiene
├── memory/
│   ├── database.ts              # Refactor: soporte agent_id en agent_memories
│   ├── memory-store.ts          # Refactor: filter por agent_id
│   └── ...                      # Resto se mantiene
├── tools/                       # Se mantiene sin cambios
└── tui/
    ├── App.tsx                  # Refactor: indicador de agente activo
    └── components/              # Refactor: stream concurrente
```

---

## Principios de diseño

1. **Cada agente es autónomo**: tiene su system prompt y tools restringidas. Todos comparten el mismo LLM client vía pool cachead. No comparten estado entre sí.
2. **Orchestrator minimista**: solo clasifica y delega. No ejecuta tools ni genera contenido.
3. **Fallback siempre**: si un agente especializado falla, GeneralAgent toma el control.
4. **Paralelismo seguro**: queries independientes se ejecutan en paralelo; queries con dependencias son secuenciales.
5. **Observabilidad first**: cada agente reporta tiempo, tools usadas, errores.
6. **MCP nativo**: cualquier agente puede ser un MCP server externo.
7. **Migración sin breaking changes**: la API pública de `processQuery()` y `processQueryWithReAct()` se mantiene igual durante toda la migración.

---

## Diagrama de flujo final

```
                    ┌──────────────────────────────────┐
                    │           User Query              │
                    └────────────┬─────────────────────┘
                                 │
                    ┌────────────▼─────────────────────┐
                    │      FastPath (pre-filter)        │
                    │  (greetings, thanks, pure chat)   │
                    └────────────┬─────────────────────┘
                                 │ (non-fastpath)
                    ┌────────────▼─────────────────────┐
                    │      Orchestrator Agent           │
                    │   - classify intent               │
                    │   - decompose if complex          │
                    │   - route to specialist/ies       │
                    └────┬──────────┬──────────┬───────┘
                         │          │          │
              ┌──────────▼┐  ┌──────▼──────┐ ┌▼──────────┐
              │ Sports    │  │ Weather    │ │ Web       │
              │ Agent     │  │ Agent      │ │ Search    │
              │ (ESPN)    │  │ (OWM)      │ │ Agent     │
              └───────────┘  └────────────┘ └───────────┘
                         │          │          │
              ┌──────────▼┐  ┌──────▼──────┐ ┌▼──────────┐
              │ News      │  │ Memory     │ │ Code      │
              │ Agent     │  │ Agent      │ │ Agent     │
              │ (digest)  │  │ (BG+FG)    │ │ (ReAct)   │
              └───────────┘  └────────────┘ └───────────┘
                         │          │          │
                         └──────────┴──────────┘
                                    │
                    ┌───────────────▼────────────────┐
                    │      Agent Router                │
                    │   - merge responses              │
                    │   - resolve conflicts            │
                    │   - produce final answer         │
                    └───────────────┬─────────────────┘
                                    │
                    ┌───────────────▼─────────────────┐
                    │           TUI Output              │
                    │   "[Sports] ..."                  │
                    │   "[Weather] ..."                 │
                    └──────────────────────────────────┘
```

---

## Evaluación de riesgos

| Riesgo | Impacto | Mitigación |
|--------|---------|------------|
| Mayor latencia por overhead de orquestación | Bajo | Orchestrator usa system prompt ligero + cache; agentes paralelos donde sea posible; mismo modelo compartido |
| Complejidad en debugging | Alto | Logging estructurado + `NULL_DEBUG=1` + health checks |
| Consistencia de memoria entre agentes | Medio | Memory Agent como única fuente de verdad; writes síncronos |
| Fallo de un agente arrastra todo | Bajo | Cada agente es independiente; orchestrator maneja fallos gracefulmente |
| Migración de datos existentes | Bajo | DB schema compatible hacia atrás (columna `agent_id` nullable = "legacy") |
| Mayor uso de memoria/CPU | Medio | Agentes se cargan lazy; modelos compartidos via Ollama cache |



---

## Commits / Hitos

| Fase | Mensaje de commit | Dependencias |
|------|-------------------|--------------|
| 1 | `feat(agents): add Agent interface and registry` | — |
| 2 | `feat(agents): GeneralAgent + OrchestratorAgent` | Fase 1 |
| 3 | `feat(agents): Sports, News, Weather, WebSearch, Code, Memory agents` | Fase 2 |
| 4 | `feat(agents): AgentRouter with decomposition and merge` | Fase 3 |
| 5 | `feat(mcp): export agents as MCP servers` | Fase 4 |
| 6 | `feat(memory): per-agent memory partitioning` | Fase 5 |
| 7 | `feat(tui): multi-agent UI indicators` | Fase 6 |
| 8 | `feat(debug): per-agent observability` | Fase 7 |
