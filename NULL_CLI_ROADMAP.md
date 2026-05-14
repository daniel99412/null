# null CLI — Roadmap de Desarrollo
> Prioridades ordenadas por impacto real. Cada paso incluye el prompt exacto para darle a un agente de IA (Claude, Codex, etc.) con todo el contexto necesario.

---

## Contexto del proyecto

**null CLI** es un asistente de terminal tipo Jarvis: local-first, powered by Ollama, con TUI en Ink/React. Stack: TypeScript ESM, Node.js 18+, better-sqlite3, Commander, Ink 7.

**Estructura actual relevante:**
```
src/
  cli/index.ts        — entry point CLI
  core/
    ollama.ts         — streaming chat con Ollama
    router.ts         — clasifica intents (heurísticas + LLM fallback)
    tools.ts          — registro de tools
    execute.ts        — ORPHAN, no se usa
    toolAction.ts     — ORPHAN, desactualizado
  tools/
    web-search.ts     — DDG scraping
    web-fetch.ts      — extrae texto de páginas
    espn.ts           — ESPN API para deportes
    gps.ts            — IP geolocation
    weather.ts        — OpenWeather API
  memory/
    database.ts       — SQLite init
    sessions.ts       — CRUD de sesiones y mensajes
    cleanup.ts        — summarización y archivado
    search-cache.ts   — cache de búsquedas con TTL
  tui/
    App.tsx           — componente principal (TUI + pipeline LLM, ~650 líneas)
    components/       — Header, Footer, Input, MessageList, CommandPalette, etc.
    hooks/            — useCursor, useLoading, useScroll
    context/          — ThemeContext
  config/index.ts     — config JSON en ~/.null-cli/
  utils/
    markdown.ts       — render markdown para terminal
    normalize.ts      — normaliza queries
```

**Problemas conocidos documentados:**
- `execute.ts` y `toolAction.ts` son orphans, no se usan
- Modelo hardcodeado en 4 archivos distintos
- `App.tsx` mezcla UI + todo el pipeline del LLM (650+ líneas)
- No hay abstracción sobre Ollama (migrar a cloud requeriría tocar múltiples archivos)
- Router usa `qwen2.5-coder:7b` para clasificar — modelo subóptimo para NL en español
- `fetchArticles` hace 5 fetches paralelos que pueden ser lentos

---

## FASE 1 — Deuda técnica crítica
> Sin resolver esto, escalar va a doler. Son cambios pequeños pero desbloquean todo.

---

### 1.1 — Centralizar configuración del modelo

**Por qué primero:** El modelo está hardcodeado en 4 archivos. Un cambio = 4 toques. Antes de tocar cualquier otra cosa.

**Prompt:**
```
Eres un senior TypeScript developer trabajando en el proyecto null CLI.

CONTEXTO:
El modelo de Ollama está hardcodeado como 'qwen2.5-coder:7b' en 4 archivos distintos:
- src/core/ollama.ts (línea con `model: 'qwen2.5-coder:7b'`)
- src/core/router.ts (constante MODEL)
- src/memory/cleanup.ts (en el body de generateSummary)
- src/tui/App.tsx (constante MODEL)

TAREA:
1. En src/config/index.ts, añade a la interfaz NullConfig:
   - `model?: string` (opcional, con default)
   Añade también fuera de la interfaz:
   - `export const DEFAULT_MODEL = 'qwen2.5-coder:7b'`
   - `export const ROUTER_MODEL = 'qwen2.5:3b'` (modelo más pequeño y rápido para clasificación)

2. En cada uno de los 4 archivos mencionados, reemplaza el string hardcodeado:
   - ollama.ts y cleanup.ts → importar y usar DEFAULT_MODEL
   - router.ts → importar y usar ROUTER_MODEL
   - App.tsx → importar y usar DEFAULT_MODEL (para el display en Header)

3. En src/cli/index.ts, añade soporte para el comando:
   `null config set model <nombre-del-modelo>`
   Similar a como ya funciona `accent-color` y `weather-key`.

RESTRICCIONES:
- No cambies la lógica de ningún archivo, solo la referencia al modelo
- Mantén el estilo ESM (import/export named, no default exports)
- No semicolons, single quotes, 2-space indentation (estilo del proyecto)
- Verifica con `npx tsc --noEmit` al final
```

---

### 1.2 — Limpiar archivos orphan y sincronizar tipos

**Por qué:** `execute.ts` y `toolAction.ts` están desactualizados y generan confusión. Limpiarlos antes de añadir más tools.

**Prompt:**
```
Eres un senior TypeScript developer trabajando en el proyecto null CLI.

CONTEXTO:
Hay dos archivos que son orphans — no se importan en ningún otro archivo del proyecto:
- src/core/execute.ts: tiene `any` tipado y solo maneja 3 actions (get_time, get_location, get_weather)
- src/core/toolAction.ts: tipo desactualizado con solo esas 3 mismas actions

La realidad actual del proyecto es que el routing y ejecución de tools ocurre directamente
en src/tui/App.tsx a través de src/core/router.ts y src/core/tools.ts.

TAREA:
1. Actualiza src/core/toolAction.ts para que refleje TODAS las decisions actuales del router:
   ```typescript
   export type RoutingDecision = 'webSearch' | 'getDateTime' | 'getWeather' | 'sportsQuery' | 'none'
   
   export type ToolAction =
     | { action: 'get_time' }
     | { action: 'get_location' }
     | { action: 'get_weather'; city?: string }
     | { action: 'web_search'; query: string }
     | { action: 'web_fetch'; url: string }
     | { action: 'sports_query'; query: string }
   ```

2. Reescribe src/core/execute.ts para que sea un ejecutor real que maneje TODOS los ToolAction:
   - Importa tools de '../core/tools.js'
   - Tipado estricto, sin `any`
   - Maneja cada action con el tipo correcto
   - Exporta `executeAction(action: ToolAction): Promise<unknown>`

3. Añade un import de executeAction en src/core/tools.ts (aunque no lo uses aún,
   para que el TS compiler valide que todo está conectado)

RESTRICCIONES:
- No modifiques App.tsx ni router.ts
- Sin `any` types — strict mode
- Verifica con `npx tsc --noEmit`
```

---

## FASE 2 — Refactor arquitectural
> El cambio más importante. Desbloquea agregar features sin que App.tsx se convierta en un monstruo.

---

### 2.1 — Extraer el pipeline del LLM de App.tsx a src/core/agent.ts

**Por qué:** `App.tsx` tiene 650+ líneas mezclando UI con lógica de negocio. `sendToLLM` sola tiene 120+ líneas. Imposible de testear, difícil de escalar.

**Prompt:**
```
Eres un senior TypeScript developer trabajando en el proyecto null CLI.

CONTEXTO:
src/tui/App.tsx tiene ~650 líneas mezclando lógica de UI con el pipeline completo del LLM.
Las funciones de lógica pura que viven en App.tsx y deben moverse son:
- extractCityFromQuery(query: string): string | null
- fetchArticles(results, maxArticles): Promise<FetchedArticle[]>
- buildArticleContext(articles, query, wikiExtract?): string
- performSearch(query, originalTxt): Promise<SearchPipelineResult | null>
- buildWeatherContext(weather: WeatherData): string
- performSportsQuery(query: string): Promise<string | null>
- debugLog(msg: string): void

Y el bloque principal de decisión dentro de sendToLLM que hace el switch sobre routerResult.decision.

TAREA:
Crea src/core/agent.ts con lo siguiente:

1. Mueve (no copies) todas las funciones listadas arriba a este archivo con sus tipos.

2. Crea y exporta la función principal:
   ```typescript
   export interface AgentResult {
     userContent: string        // el mensaje final que va al LLM
     searchContext: string | null  // contexto inyectado como system message
     statusMessage: string | null  // mensaje de status para mostrar en TUI ("🔍 Buscando...", etc.)
   }
   
   export async function processQuery(
     query: string,
     isExplicitSearch?: boolean,
   ): Promise<AgentResult>
   ```

3. La función processQuery debe:
   - Detectar si es /search explícito
   - Llamar routeQuery para el resto
   - Ejecutar el pipeline correcto según la decision
   - Retornar AgentResult sin tocar ningún estado de React

4. En App.tsx, reemplaza todo el bloque de lógica dentro de sendToLLM por:
   ```typescript
   const agentResult = await processQuery(txt, isExplicitSearch)
   // usa agentResult.userContent, agentResult.searchContext, agentResult.statusMessage
   ```
   El manejo de estado de React (updateMessages con status, etc.) sí queda en App.tsx.

RESTRICCIONES:
- No cambies la interfaz pública de ningún otro módulo
- Los imports en App.tsx deben quedar limpios
- Mantén debugLog en agent.ts (es lógica de negocio, no UI)
- Sin `any`, strict mode
- Verifica con `npx tsc --noEmit` y `npm test`
```

---

### 2.2 — Crear abstracción LLMClient sobre Ollama

**Por qué:** Cuando quieras probar con OpenAI o Claude API (o si Anthropic lanza soporte OpenAI-compatible), actualmente tendrías que tocar 3 archivos. Con esta abstracción, 0.

**Prompt:**
```
Eres un senior TypeScript developer trabajando en el proyecto null CLI.

CONTEXTO:
El proyecto hace fetch directo a 'http://localhost:11434/api/chat' en 3 archivos:
- src/core/ollama.ts (streaming)
- src/core/router.ts (non-streaming para clasificación)
- src/memory/cleanup.ts (non-streaming para summarización)

Ollama es compatible con la API de OpenAI en /v1/chat/completions cuando se configura así.

TAREA:
1. Crea src/core/llm-client.ts con:
   ```typescript
   export interface ChatMessage {
     role: 'system' | 'user' | 'assistant'
     content: string
   }
   
   export interface LLMClient {
     // Streaming — para respuestas del usuario
     streamChat(
       messages: ChatMessage[],
       onToken: (token: string) => void,
     ): Promise<string>
     
     // Non-streaming — para router y summarización
     complete(messages: ChatMessage[]): Promise<string>
   }
   
   export function createOllamaClient(options: {
     baseUrl: string
     model: string
   }): LLMClient
   ```

2. Implementa createOllamaClient usando el endpoint actual de Ollama (/api/chat).
   Mueve la lógica de streaming de ollama.ts a este cliente.

3. Actualiza src/core/ollama.ts para que use createOllamaClient internamente
   en lugar de fetch directo. Mantén la API pública (streamChat) intacta para
   no romper los imports actuales de App.tsx.

4. Actualiza src/core/router.ts para usar el LLMClient en su función chat() interna.

5. Actualiza src/memory/cleanup.ts para usar LLMClient en generateSummary().

6. El cliente se instancia una vez y se reutiliza — crea una función
   `getDefaultClient(): LLMClient` que cargue config y retorne el cliente singleton.

RESTRICCIONES:
- No cambies la API pública de streamChat en ollama.ts (App.tsx lo importa)
- Sin `any`, strict mode
- El baseUrl debe venir de config, no hardcodeado
- Verifica con `npx tsc --noEmit`
```

---

## FASE 3 — Nuevas features core
> Aquí es donde el proyecto se convierte en Jarvis real.

---

### 3.1 — Google Calendar integration

**Por qué:** Es el feature que más diferencia un chatbot de un asistente real. "Agéndame una junta" → evento creado.

**Prompt:**
```
Eres un senior TypeScript developer trabajando en el proyecto null CLI.

CONTEXTO:
null CLI es un asistente de terminal que usa Ollama localmente. Ya tiene tools para
web search, weather, y sports. El siguiente feature es Google Calendar.

El proyecto tiene en src/core/router.ts un sistema de routing basado en heurísticas.
El router actual maneja: webSearch, getDateTime, getWeather, sportsQuery, none.

TAREA - Parte 1: Calendar Tool
Crea src/tools/calendar.ts con:

1. OAuth2 setup con Google Calendar API:
   - Client ID y Secret se guardan en ~/.null-cli/config.json
   - Token se guarda en ~/.null-cli/google-token.json
   - Flujo: si no hay token → abrir browser para auth → guardar token
   - Usa la librería googleapis (añádela como dependency)

2. Exporta estas funciones:
   ```typescript
   export async function createEvent(params: {
     title: string
     startTime: Date
     endTime: Date
     description?: string
     calendarId?: string  // default: 'primary'
   }): Promise<{ id: string; link: string; summary: string }>
   
   export async function listUpcomingEvents(options?: {
     maxResults?: number  // default: 5
     calendarId?: string  // default: 'primary'
   }): Promise<CalendarEvent[]>
   
   export async function isAuthenticated(): Promise<boolean>
   export async function authenticate(): Promise<void>
   ```

TAREA - Parte 2: Router patterns
En src/core/router.ts, añade ANTES de FORCE_SEARCH_PATTERNS:

```typescript
const FORCE_CALENDAR_PATTERNS = [
  /\b(agenda|agend[aé]|crea|añade|programa|schedule)\b.*\b(evento|reunión|junta|meeting|cita|recordatorio|reminder)\b/i,
  /\b(qué tengo|what do i have|mis eventos|my events|calendario|calendar)\b/i,
  /\b(cuándo es|when is)\b.*\b(reunión|junta|meeting|cita)\b/i,
]
```

Y añade 'calendarQuery' al tipo RoutingDecision.

TAREA - Parte 3: Agent handler
En src/core/agent.ts, añade el handler para calendarQuery:
- Parsea la intención del usuario usando el LLM (¿crear evento, listar eventos, buscar?)
- Si crear: extrae título, fecha/hora, descripción con el LLM
- Llama a la tool correspondiente
- Retorna el resultado como contexto para que el LLM responda naturalmente

TAREA - Parte 4: Registro
En src/core/tools.ts, añade:
```typescript
calendar_create: createEvent,
calendar_list: listUpcomingEvents,
```

RESTRICCIONES:
- El archivo de credenciales NUNCA se commitea (ya está en .gitignore: .env, *.json excepto package.json)
- Añade 'google-token.json' al .gitignore
- Si no está autenticado, el agente debe responder amablemente pidiendo que corra `null config auth google`
- Sin `any`, strict mode
- Verifica con `npx tsc --noEmit`
```

---

### 3.2 — Sistema de Reminders

**Por qué:** Complemento natural del calendario. "Recuérdame mañana a las 9 que tengo que llamar a X."

**Prompt:**
```
Eres un senior TypeScript developer trabajando en el proyecto null CLI.

CONTEXTO:
null CLI tiene SQLite en ~/.null-cli/null.db con tablas sessions, messages, session_summaries, search_cache.

TAREA - Parte 1: Schema
En src/memory/database.ts, añade esta tabla al CREATE TABLE IF NOT EXISTS block:

```sql
CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  remind_at TEXT NOT NULL,          -- ISO 8601 datetime
  notes TEXT,                        -- descripción opcional
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dismissed', 'done')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  notified_at TEXT                   -- cuando se mostró la notificación
);
CREATE INDEX IF NOT EXISTS idx_reminders_remind_at ON reminders(remind_at);
```

TAREA - Parte 2: CRUD
Crea src/memory/reminders.ts con:
```typescript
export interface Reminder {
  id: number
  title: string
  remind_at: string
  notes: string | null
  status: 'pending' | 'dismissed' | 'done'
  created_at: string
  notified_at: string | null
}

export function createReminder(params: {
  title: string
  remind_at: Date
  notes?: string
}): Reminder

export function getPendingReminders(): Reminder[]  // status='pending' AND remind_at <= now
export function getDueReminders(): Reminder[]       // pending AND remind_at <= NOW
export function markReminder(id: number, status: 'dismissed' | 'done'): void
export function listReminders(limit?: number): Reminder[]  // todos los pending futuros
```

TAREA - Parte 3: Checker al startup
En src/tui/App.tsx, en el useEffect que corre al iniciar (donde está runCleanup):
- Llama a getDueReminders()
- Si hay reminders pendientes, muéstralos como mensajes de tipo 'recall' al inicio de la sesión
- Márcalos como notified (añade un campo notified_at)

TAREA - Parte 4: Router + Agent
- Añade FORCE_REMINDER_PATTERNS al router para detectar "recuérdame", "reminder", "no olvides"
- Añade 'reminderQuery' al RoutingDecision
- En agent.ts, añade handleReminder() que use el LLM para parsear:
  - título del recordatorio
  - fecha/hora (relativa como "mañana a las 9", "el viernes", etc.)
  - Usa Date parsing con el LLM — dale la fecha actual como contexto y pídele el ISO 8601

RESTRICCIONES:
- El parsing de fechas relativas DEBE hacerse via LLM (no regex frágil)
- Sin `any`, strict mode
- Verifica con `npx tsc --noEmit` y `npm test`
```

---

### 3.3 — Plugin System (MCP-compatible)

**Por qué:** Para agregar Google Drive, Jira, Notion, Spotify, etc. sin modificar el core cada vez. Diseñado para ser compatible con Model Context Protocol.

**Prompt:**
```
Eres un senior TypeScript developer trabajando en el proyecto null CLI.

CONTEXTO:
null CLI tiene tools hardcodeadas en src/core/tools.ts. Para escalar a un asistente
tipo Jarvis real, necesitamos un sistema de plugins donde cada tool/integración sea
un módulo independiente que se registra en el sistema.

Model Context Protocol (MCP) define un estándar para tools que ya usan Claude, Cursor, etc.
La idea es ser compatible con ese estándar a futuro.

TAREA:
1. Crea src/core/plugin-registry.ts:
```typescript
export interface PluginTool {
  name: string                    // identificador único: 'calendar_create'
  description: string             // para el LLM: cuándo usar esta tool
  parameters: ToolParameter[]     // esquema de parámetros
  execute: (params: Record<string, unknown>) => Promise<unknown>
}

export interface ToolParameter {
  name: string
  type: 'string' | 'number' | 'boolean' | 'date'
  description: string
  required: boolean
}

export interface Plugin {
  name: string          // 'google-calendar', 'weather', 'sports'
  version: string
  tools: PluginTool[]
  onLoad?: () => Promise<void>   // setup async (auth, conexiones, etc.)
}

class PluginRegistry {
  private plugins: Map<string, Plugin>
  private tools: Map<string, PluginTool>
  
  register(plugin: Plugin): void
  getTool(name: string): PluginTool | undefined
  getAllTools(): PluginTool[]
  getToolsSchema(): string  // formato para inyectar en system prompt
}

export const registry = new PluginRegistry()
```

2. Convierte las tools existentes a plugins. Crea src/plugins/ y mueve:
   - src/plugins/datetime.plugin.ts (get_time)
   - src/plugins/weather.plugin.ts (get_weather, get_weather_by_city)
   - src/plugins/sports.plugin.ts (sports_query via ESPN)
   - src/plugins/web.plugin.ts (web_search, web_fetch)

3. Crea src/core/plugin-loader.ts que:
   - Carga todos los plugins de src/plugins/
   - Carga plugins externos de ~/.null-cli/plugins/ (carpeta opcional del usuario)
   - Llama onLoad() de cada plugin

4. Actualiza src/core/tools.ts para que delegue al registry.

5. Actualiza el system prompt en src/core/ollama.ts para que incluya
   registry.getToolsSchema() dinámicamente.

RESTRICCIONES:
- Mantén compatibilidad hacia atrás — los imports actuales de tools deben seguir funcionando
- Los plugins externos son opcionales — si la carpeta no existe, no falla
- Sin `any`, strict mode
- Los plugins deben poder fallar en onLoad() sin crashear la app
- Verifica con `npx tsc --noEmit`
```

---

## FASE 4 — UX y Polish

---

### 4.1 — Optimizar el web search pipeline

**Por qué:** 5 fetches paralelos = el más lento (5s) bloquea todo. Cambiar a estrategia adaptativa.

**Prompt:**
```
Eres un senior TypeScript developer trabajando en el proyecto null CLI.

CONTEXTO:
En src/core/agent.ts (previamente era App.tsx), la función fetchArticles hace
Promise.allSettled con hasta 5 URLs simultáneas. El problema:
- El fetch más lento puede tardar 5+ segundos
- No hay razón de esperar todos si el primero ya tiene contenido suficiente
- Algunos sitios bloquean scrapers y retornan HTML inútil

TAREA:
1. Reemplaza fetchArticles con una estrategia de fetch adaptativa:
   ```typescript
   async function fetchArticlesAdaptive(
     results: SearchResult[],
     options: {
       maxArticles?: number      // default: 3 (era 5)
       minContentLength?: number // default: 500 chars de contenido útil
       timeoutMs?: number        // default: 4000ms por fetch
     }
   ): Promise<FetchedArticle[]>
   ```
   
   Estrategia:
   - Fetch del primer resultado siempre (suele ser el más relevante)
   - Si el primero tiene >2000 chars de contenido útil → skip el resto, ya tenemos suficiente
   - Si no → fetch del segundo en paralelo con el tercero
   - Timeout agresivo: 4s por request (era 10s en web-fetch.ts)
   - Si Wikipedia extract está disponible → cuenta como contenido, reduce fetches necesarios

2. En src/tools/web-fetch.ts, añade soporte para AbortSignal externo:
   ```typescript
   export async function fetchPageText(
     url: string,
     options?: {
       maxChars?: number
       signal?: AbortSignal    // NUEVO
     }
   ): Promise<string>
   ```

3. Añade una función helper:
   ```typescript
   function hasUsefulContent(text: string, minLength: number): boolean
   ```
   Que verifica que el texto no sea solo HTML de error, CAPTCHA, o contenido vacío.

RESTRICCIONES:
- No cambies la interfaz de retorno de performSearch
- El Wikipedia extract sigue teniendo prioridad
- Sin `any`, strict mode
- Verifica con `npx tsc --noEmit`
```

---

### 4.2 — Mejorar el router con scoring ponderado

**Por qué:** El sistema actual de 50+ regex en orden específico es frágil. Un scoring system es más mantenible y debuggeable.

**Prompt:**
```
Eres un senior TypeScript developer trabajando en el proyecto null CLI.

CONTEXTO:
El router en src/core/router.ts tiene ~50 regex patterns organizados como arrays que
se evalúan en orden. Problemas:
- El orden importa y es difícil de razonar
- Casos ambiguos caen al LLM (lento)
- No hay forma de debuggear por qué clasificó X como Y

TAREA:
Reescribe el sistema de heurísticas usando scoring ponderado. Mantén la misma
interfaz pública (routeQuery sigue siendo la única export pública).

```typescript
interface Signal {
  pattern: RegExp
  intent: RoutingDecision
  weight: number          // positivo = favorece ese intent, negativo = penaliza
  description?: string    // para debugging
}

const SIGNALS: Signal[] = [
  // Programación → none (peso alto para forzar none)
  { pattern: /\b(function|clase|class|array|loop)\b/i, intent: 'none', weight: 10 },
  
  // Deportes → sportsQuery
  { pattern: /\b(resultados?|marcador)\b/i, intent: 'sportsQuery', weight: 8 },
  
  // Recencia → penaliza none, favorece webSearch
  { pattern: /\b(hoy|today|ahora|now)\b/i, intent: 'webSearch', weight: 3 },
  
  // Si hay recencia Y deportes → deportes gana (suma de scores)
  // etc.
]

function scoreQuery(query: string): Record<RoutingDecision, number> {
  // retorna scores para cada intent
}

function topDecision(scores: Record<RoutingDecision, number>): {
  decision: RoutingDecision
  confidence: number
  scores: Record<RoutingDecision, number>  // para debugging
}
```

Reglas:
- Si el score ganador es >= 6 → heuristic decision (sin LLM)
- Si el score ganador está entre 3-5 → heuristic con confidence < 0.8
- Si el score máximo es < 3 → fallback al LLM
- En --dev mode, loggear los scores de cada query a stderr

RESTRICCIONES:
- La función routeQuery mantiene exactamente la misma firma
- RouterResult mantiene exactamente la misma interfaz
- Los tests existentes en tests/router.test.ts deben seguir pasando
- Sin `any`, strict mode
- Verifica con `npm test` al final
```

---

### 4.3 — Comando de setup interactivo

**Por qué:** Ahora mismo el usuario tiene que saber que existe `null config set weather-key X`. Mejor un wizard.

**Prompt:**
```
Eres un senior TypeScript developer trabajando en el proyecto null CLI.

CONTEXTO:
null CLI requiere configuración inicial (API keys, preferencias) pero no hay un
wizard de setup. El usuario tiene que descubrir los comandos manualmente.

TAREA:
Crea el comando `null setup` que corra un wizard interactivo en terminal (sin TUI de Ink,
solo readline/prompts simples para máxima compatibilidad).

El wizard debe hacer en orden:
1. Verificar que Ollama está corriendo (GET http://localhost:11434)
   - Si no → mostrar instrucciones de instalación y salir
   - Si sí → mostrar qué modelos tiene instalados

2. Preguntar qué modelo usar (con lista de los disponibles via `ollama list`)
   - Default: qwen2.5:7b si está disponible, sino el primero de la lista
   - Guardar en config

3. Preguntar si quiere configurar OpenWeather (opcional)
   - Si sí → pedir API key → validar con una llamada de prueba → guardar
   - Si no → skip con mensaje de cómo hacerlo después

4. Preguntar si quiere conectar Google Calendar (opcional)
   - Si sí → iniciar el flujo OAuth
   - Si no → skip

5. Mostrar resumen de configuración y mensaje de bienvenida con ejemplos de uso

Implementación:
- Usa readline nativo de Node.js (no dependencias externas)
- En src/cli/index.ts añade el subcomando: program.command('setup').action(runSetup)
- Crea src/cli/setup.ts con la lógica del wizard
- Colorea el output con chalk (ya es dependency)
- Muestra progress con ora (ya es dependency)

RESTRICCIONES:
- Sin dependencias nuevas (usa readline, chalk, ora que ya están)
- El setup debe ser re-ejecutable sin romper config existente
- Si el usuario interrumpe (Ctrl+C), guardar lo que ya se configuró
- Verifica con `npx tsc --noEmit`
```

---

## FASE 5 — Features avanzados

---

### 5.1 — Multi-turn tool calling (agente autónomo)

**Por qué:** Ahora el agente hace una tool call y responde. Para queries complejas necesitas: buscar → leer resultado → decidir si buscar más → responder.

**Prompt:**
```
Eres un senior TypeScript developer trabajando en el proyecto null CLI.

CONTEXTO:
El agente actual (src/core/agent.ts) hace exactamente UNA tool call por query y luego
pasa el resultado al LLM. Para queries como "busca los últimos artículos sobre IA y
resúmelos" necesita: buscar → leer cada artículo → decidir si necesita más contexto → responder.

TAREA:
Implementa un ReAct loop simple (máximo 3 iteraciones para evitar loops infinitos):

```typescript
// src/core/agent.ts
export async function processQueryWithReAct(
  query: string,
  options?: {
    maxIterations?: number  // default: 3
    onToolCall?: (toolName: string) => void  // callback para el TUI
  }
): Promise<AgentResult>
```

El loop:
1. Manda el query al LLM con los tools disponibles en el system prompt
2. Si el LLM responde con una tool call (detectada via JSON en su respuesta) → ejecutar
3. Inyectar resultado como contexto y volver al paso 1
4. Si el LLM responde con texto → es la respuesta final

Para que el LLM sepa cuándo llamar una tool, modifica el system prompt para incluir:
```
When you need to use a tool, respond ONLY with this JSON format:
{"tool": "tool_name", "params": {...}}

When you have enough information to answer, respond normally in the user's language.
```

Detecta si la respuesta es un tool call:
```typescript
function parseMaybeToolCall(response: string): ToolCall | null {
  // intenta JSON.parse, valida que tiene .tool y .params
  // retorna null si no es un tool call válido
}
```

RESTRICCIONES:
- Máximo 3 iteraciones hardcodeadas (sin configurar por ahora)
- Si detecta un loop (misma tool con mismos params 2 veces) → break
- El callback onToolCall permite al TUI mostrar "🔧 Usando tool: web_search..."
- processQuery (la función original simple) sigue existiendo para el path rápido
- Sin `any`, strict mode
- Verifica con `npx tsc --noEmit`
```

---

### 5.2 — Modo offline / fallback gracioso

**Por qué:** Si Ollama no está corriendo o no hay internet, el CLI debe fallar amablemente, no con un stack trace.

**Prompt:**
```
Eres un senior TypeScript developer trabajando en el proyecto null CLI.

CONTEXTO:
null CLI falla con un error poco claro cuando Ollama no está corriendo.
También falla cuando no hay internet para web search.

TAREA:
1. Crea src/core/health.ts:
   ```typescript
   export interface HealthStatus {
     ollama: { available: boolean; models: string[]; latencyMs: number }
     internet: { available: boolean }
   }
   
   export async function checkHealth(timeoutMs?: number): Promise<HealthStatus>
   export async function waitForOllama(maxRetries?: number, intervalMs?: number): Promise<boolean>
   ```

2. En src/cli/index.ts, antes de lanzar la TUI o ejecutar un prompt directo:
   - Llama checkHealth() con timeout de 2s
   - Si Ollama no está → mostrar mensaje de error claro con instrucciones
   - Si internet no está → mostrar warning (no error — el CLI sigue funcionando para
     queries que no necesitan internet)

3. En src/core/agent.ts, en performSearch y performSportsQuery:
   - Wrap en try/catch con detección de network error
   - Si falla por red → retornar un AgentResult con userContent que le diga al LLM
     que responda con lo que sabe, sin internet
   
4. Añade el comando `null health` que muestra el status de todos los servicios:
   - Ollama (con latencia y modelos disponibles)
   - Internet
   - Google Calendar (si está configurado)
   - OpenWeather (si está configurado)

RESTRICCIONES:
- Health checks con timeout agresivo (2s máximo)
- No bloquear el startup más de 2s en total
- Los errores de red deben ser silenciosos para el usuario final (maneja graciosamente)
- Verifica con `npx tsc --noEmit`
```

---

## Orden de ejecución recomendado

```
SEMANA 1:
  ✅ 1.1 Centralizar modelo en config
  ✅ 1.2 Limpiar orphans y sincronizar tipos

SEMANA 2:
  ✅ 2.1 Extraer pipeline a agent.ts
  ✅ 2.2 Abstracción LLMClient

SEMANA 3-4:
  ✅ 3.1 Google Calendar
  ✅ 3.2 Reminders

SEMANA 5:
  ✅ 4.1 Optimizar web search
  ✅ 4.2 Router con scoring
  ✅ 4.3 Setup wizard

SEMANA 6+:
  ✅ 3.3 Plugin system
  ✅ 5.1 ReAct loop
  ✅ 5.2 Health checks y modo offline
```

---

## Comandos de verificación

Después de cada paso, corre siempre:
```bash
npm run build && npx tsc --noEmit && npm test
```

Para ver el router en acción en modo debug:
```bash
null "resultados de la liga mx" --dev
```

---

## Notes técnicas para los prompts

Cuando uses estos prompts con un agente de IA, añade siempre al final:

```
El proyecto usa:
- TypeScript 5.x strict mode, ESM modules ("type": "module" en package.json)
- Node.js 18+, imports con extensión .js (aunque el archivo sea .ts)
- Sin semicolons, single quotes, trailing commas, 2-space indentation
- Named exports, no default exports
- better-sqlite3 para SQLite (síncrono, no promesas)
- Ink 7 para TUI (React en terminal)
- Commander 14 para CLI

Verifica SIEMPRE con `npx tsc --noEmit` antes de terminar.
```
