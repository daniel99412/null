# Null CLI — Enhancement Plan
> Basado en el análisis de `src/tui/App.tsx` y la arquitectura definida en `AGENTS.md`

---

## Problema Principal

En `sendToLLM()` dentro de `App.tsx`, el flujo actual hace **siempre** una búsqueda web sin importar el tipo de query:

```ts
// Always search the web first — show status while searching
const searchContent = await buildSearchPrompt(searchQuery, txt)
```

Esto significa que preguntas como _"haz un hola mundo en Java"_ o _"¿qué es una función recursiva?"_ están haciendo una llamada a DuckDuckGo innecesariamente, añadiendo latencia y ruido al contexto del LLM.

Además, la detección de fecha/hora está hardcodeada con regex directamente en el componente React, lo cual es frágil y no escala.

---

## Enhancement 1 — Crear el Router como módulo independiente

**Archivo a crear:** `src/core/router.ts`

### Qué debe hacer
- Recibir el query del usuario
- Correr heurísticas primero (sin llamar al LLM)
- Si las heurísticas no clasifican con certeza, llamar al LLM router con un system prompt específico
- Retornar una decisión: `'webSearch' | 'getDateTime' | 'none'`

### Estructura sugerida

```ts
export type RoutingDecision = 'webSearch' | 'getDateTime' | 'none'

export interface RouterResult {
  decision: RoutingDecision
  confidence: number
  source: 'heuristic' | 'llm'
}

export async function routeQuery(query: string): Promise<RouterResult>
```

### Heurísticas a implementar (corren ANTES del LLM)

```ts
// Fuerza NONE — nunca buscar esto
const FORCE_NONE_PATTERNS = [
  /\b(how to|cómo|example|ejemplo|tutorial)\b/i,
  /\b(java|python|javascript|typescript|rust|go|c\+\+|c#|php|ruby|swift|kotlin)\b/i,
  /\b(function|clase|class|array|loop|recursion|recursiva|algoritmo|algorithm)\b/i,
  /\b(hola mundo|hello world)\b/i,
  /\b(qué es|what is|define|explain|explica)\b/i,
]

// Fuerza WEBSEARCH — siempre buscar esto
const FORCE_SEARCH_PATTERNS = [
  /\b(20[2-9][4-9]|20[3-9]\d)\b/,          // años después del cutoff (2024+)
  /\b(hoy|today|ahorita|ahora|right now)\b.*\b(precio|price|clima|weather|dólar|dollar)\b/i,
  /\b(últimas?|latest|reciente|recent|noticias?|news|breaking)\b/i,
  /\b(precio|cotización|exchange rate)\b.*\b(dólar|euro|bitcoin|crypto)\b/i,
]

// Fuerza GETDATETIME
const FORCE_DATETIME_PATTERNS = [
  /\b(qué hora|what time|que hora)\b/i,
  /\b(qué día|what day|qué fecha|what date|en qué fecha)\b/i,
]
```

### System prompt del LLM router

```ts
const ROUTER_SYSTEM_PROMPT = `You are a strict tool router.
Your job is to classify the user query into exactly one of three options.

Available tools:
- webSearch: use ONLY when the query requires information from after September 2023, real-time data (prices, weather, scores), or unknown entities.
- getDateTime: use ONLY when the user explicitly asks for the current date or time.
- none: use for general knowledge, programming, history, science, math, reasoning, jokes, and conversation.

Rules:
- Historical facts, science, math, geography → always "none"
- Jokes, wordplay, riddles, conversational messages → always "none"  
- Reasoning verifiable internally (anagrams, palindromes, math) → always "none"
- Programming questions, code generation, tutorials → always "none"
- Your knowledge cutoff is September 2023. Anything after that → "webSearch"
- Only use "webSearch" if you are confident the information changes frequently or postdates your knowledge

Respond ONLY with valid JSON. No text before or after.
{ "tool": "webSearch" | "getDateTime" | "none", "confidence": number }`.trim()
```

---

## Enhancement 2 — Refactorizar `sendToLLM` en `App.tsx`

**Archivo a modificar:** `src/tui/App.tsx`

### Cambio principal

Reemplazar el bloque actual que siempre busca:

```ts
// ACTUAL — siempre busca, siempre muestra "Searching..."
updateMessages(...)  // muestra 🔍
const searchContent = await buildSearchPrompt(searchQuery, txt)
if (searchContent !== txt) {
  userContent = searchContent
}
updateMessages(...)  // limpia el status
```

Por un flujo basado en la decisión del router:

```ts
// NUEVO — solo actúa según la decisión del router
const { decision, source } = await routeQuery(txt)

if (decision === 'getDateTime') {
  const t = tools.get_time()
  userContent = `Current time: ${t.time}, date: ${t.date}. User asked: "${txt}". Answer naturally.`

} else if (decision === 'webSearch') {
  updateMessages((m) => {
    const copy = [...m]
    const last = copy[copy.length - 1]
    if (last?.role === 'assistant') last.content = '🔍 Searching the web...'
    return copy
  })

  const searchContent = await buildSearchPrompt(searchQuery, txt)
  if (searchContent !== txt) userContent = searchContent

  updateMessages((m) => {
    const copy = [...m]
    const last = copy[copy.length - 1]
    if (last?.role === 'assistant') last.content = ''
    return copy
  })

} else {
  // none — directo al LLM, sin tools
  userContent = txt
}
```

### Eliminar el bloque de regex hardcodeado

El bloque actual de detección de fecha/hora con regex en `App.tsx` debe eliminarse completamente:

```ts
// ELIMINAR ESTE BLOQUE — pasa a ser responsabilidad del router
const asksTime = /\bhora\b|.../.test(txt)
const asksDate = /\bfecha\b|.../.test(txt)
if (asksTime && asksDate) { ... }
else if (asksDate) { ... }
else if (asksTime) { ... }
```

Esa lógica ahora vive en `src/core/router.ts` con las heurísticas.

---

## Enhancement 3 — Cache de búsquedas en SQLite

**Archivo a crear:** `src/memory/search-cache.ts`

### Qué debe hacer
- Guardar resultados de búsquedas web con TTL
- Antes de llamar a DuckDuckGo, verificar si hay un resultado fresco en cache
- Limpiar entradas expiradas periódicamente

### Schema SQL

```sql
CREATE TABLE IF NOT EXISTS search_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query_key TEXT NOT NULL UNIQUE,   -- query normalizado (lowercase, trim)
  result TEXT NOT NULL,              -- JSON serializado del SearchContext
  created_at INTEGER NOT NULL,       -- unix timestamp
  ttl_seconds INTEGER NOT NULL DEFAULT 300
);
```

### API sugerida

```ts
export function getCachedSearch(query: string): SearchContext | null
export function setCachedSearch(query: string, result: SearchContext, ttlSeconds?: number): void
export function cleanExpiredCache(): void
```

### Integración en `buildSearchPrompt`

```ts
async function buildSearchPrompt(query: string, originalTxt: string): Promise<string> {
  // 1. Check cache first
  const cached = getCachedSearch(query)
  if (cached) return buildPromptFromContext(cached, query, originalTxt)

  // 2. Fetch from DuckDuckGo
  const searchCtx = await tools.web_search(query)

  // 3. Cache the result (5 min TTL por default)
  setCachedSearch(query, searchCtx, 300)

  return buildPromptFromContext(searchCtx, query, originalTxt)
}
```

---

## Enhancement 4 — Normalización de query

**Archivo a crear:** `src/utils/normalize.ts`

Antes de pasarle el query al router o al cache, normalizarlo consistentemente:

```ts
export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')              // colapsa espacios
    .replace(/[¿¡]/g, '')             // quita signos de apertura españoles
    .replace(/[.,;:!?]$/g, '')        // quita puntuación final
}
```

Esto garantiza que `"¿Qué hora es?"`, `"que hora es"` y `"QUE HORA ES  "` lleguen al mismo cache key y heurística.

---

## Flujo final esperado

```
User input
    │
    ▼
normalizeQuery()
    │
    ▼
routeQuery()
    ├─ heurísticas (sync, sin LLM)
    │       ├─ match → RouterResult { source: 'heuristic' }
    │       └─ no match → llm router call
    │                         └─ RouterResult { source: 'llm' }
    │
    ▼
decision: 'none' | 'webSearch' | 'getDateTime'
    │
    ├─ none        → userContent = txt → streamChat()
    ├─ getDateTime → inject time/date  → streamChat()
    └─ webSearch   → checkCache()
                         ├─ hit  → buildPrompt(cached)  → streamChat()
                         └─ miss → DDG fetch → cache → buildPrompt() → streamChat()
```

---

## Orden de implementación recomendado

1. `src/utils/normalize.ts` — 10 min, sin dependencias
2. `src/core/router.ts` — el core del cambio, requiere probar el system prompt
3. `src/memory/search-cache.ts` — requiere que `database.ts` ya esté inicializado
4. Refactor `App.tsx` `sendToLLM()` — integra todo lo anterior

---

## Lo que NO tocar por ahora

- `buildSearchPrompt()` — solo agregar el cache lookup, no reescribir
- `src/tools/web-search.ts` — está bien como está
- El sistema de memoria/sessions — no tiene deuda técnica relevante
- TUI components — no tienen nada que ver con este flujo

---

## Notas adicionales

- El router LLM usa el **mismo modelo** (`qwen2.5-coder:7b`) pero con un system prompt diferente. No es una segunda instancia de Ollama — es solo una llamada distinta al mismo endpoint.
- La llamada al router debe ser **non-streaming** (`stream: false`) porque solo necesitas el JSON de decisión, no texto progresivo.
- Si el router LLM retorna un JSON malformado, el fallback debe ser `'none'` — es mejor no buscar que buscar de más en caso de error.
- Agrega logging en dev mode para ver qué decisión tomó el router y si vino de heurística o LLM. Eso te va a salvar la vida al debuggear.
