# MCP Migration + News Topics Plan

## Orden: primero News Topics, luego MCP

Se hace primero el sistema de topics (sobre la arquitectura actual) porque es más rápido iterar.
Después MCP envuelve todo como protocolo estándar.

---

## Fase 1: News Topics

### 1a — DB: `news_topics` table

```sql
CREATE TABLE IF NOT EXISTS news_topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  keywords TEXT NOT NULL,                -- JSON: ["tecnología", "tech", "AI", "startup"]
  scope_tags TEXT NOT NULL DEFAULT '[]',  -- JSON: matchea source.scope_json
  enabled INTEGER NOT NULL DEFAULT 1,
  source_ids TEXT NOT NULL DEFAULT '[]',  -- JSON: [1, 3, 5] — fuentes específicas
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)
```

**Seeds por defecto:**

| Topic | keywords | scope_tags |
|---|---|---|
| México | méxico, mexico, nacional | mexico, politics, security |
| Internacional | internacional, world, global, eeuu, china, europa | world, latin-america |
| Finanzas | finanzas, economía, economy, negocios, business, bolsa, dólar | economy, business |
| Tecnología | tecnología, technology, tech, AI, inteligencia artificial, startup, digital, software | technology, science |
| Ciencia | ciencia, science, investigación, research, salud, medio ambiente | science, health, environment |

### 1b — Refactor `buildMexicoNewsDigest` → `buildTopicNewsDigest`

| Cambio | Archivo |
|---|---|
| Renombrar función principal | `mexico-news.ts` → `buildTopicNewsDigest(topicName)` |
| Lookup topic en DB | `SELECT * FROM news_topics WHERE name = ?` |
| Fetch feeds por scope | `fetchFeedsByScope(scope_tags)` — filtra `news_sources` donde `scope_json` intersecta |
| Fallback keyword filter | si scope da < 5 artículos, fetch ALL feeds y filtra por keywords |
| Clustering / ranking | sin cambios |
| Header dinámico | `RESUMEN DE NOTICIAS — {topic}` en vez de hardcoded `MÉXICO` |
| Cache key | incluye topic name en vez de scope hardcoded |

### 1c — Router: `mexicoNewsDigest` → `newsDigest`

- Renombrar `RoutingDecision.mexicoNewsDigest` → `newsDigest`
- Nuevos signals: `dame noticias de [topicKeyword]`, `qué pasó en [topicKeyword]`
- Si el query no menciona topic específico pero pide "noticias":
  - Usar el topic con más score en memoria del usuario
  - O mostrar menú de topics disponibles
- CLLM actualizado para clasificar `newsDigest` con topic extraído

### 1d — Gestión de topics vía chat + memoria

Comandos (como ReAct tools primero, después MCP):

| Comando | Acción |
|---|---|
| `agrega el topic {name} con keywords {kw}` | INSERT en `news_topics` + guarda en `memories` type=preference |
| `quita el topic {name}` | `enabled=0` + limpia de memoria |
| `muestra mis topics` | SELECT + formatea lista |

Cada topic se guarda como **memoria**: `type: 'preference', value: 'sigue noticias de {topic}'`.
Así el LLM sabe qué topics tiene configurados y puede sugerir noticias proactivamente.

### 1e — Sugerencias automáticas

- `memory-extractor.ts` detecta queries frecuentes del tipo "dame noticias de X"
- Si un tema aparece 3+ veces sin estar configurado como topic, el LLM sugiere:
  > "Veo que preguntas seguido por noticias de {X}. ¿Quieres que lo guarde como topic?"

### Archivos a modificar (Fase 1)

| Archivo | Cambio |
|---|---|
| `src/memory/database.ts` | + `news_topics` table, `seedNewsTopics()`, migración de datos |
| `src/tools/mexico-news.ts` | Refactor → `buildTopicNewsDigest()`, lookup DB, scope filter, header dinámico |
| `src/tools/rss-fetcher.ts` | + `fetchFeedsByScope(scopes: string[])` |
| `src/core/router.ts` | Rename decision, nuevos signals, topic extraction |
| `src/core/agent.ts` | Handler `newsDigest` con topic lookup, memory context |
| `src/core/toolAction.ts` | + `news_digest`, `news_manage_topics` actions |
| `src/core/intent-classifier.ts` | Nueva categoría `newsDigest` + topic |
| `src/memory/memory-extractor.ts` | Sugerencias automáticas de topics |

---

## Fase 2: MCP Client Adapter

### Arquitectura

```
MCP Servers ──[tools/list]──► MCP Client ──[schema-converter]──► Ollama tools[]
                 ◄──[tools/call]───       ◄──[tool_calls]───
```

### Archivos nuevos

| Archivo | Propósito |
|---|---|
| `src/mcp/client.ts` | Conecta MCP servers (stdio/SSE), descubre tools con `tools/list`, cachea schemas |
| `src/mcp/schema-converter.ts` | Convierte `Tool` schema MCP → formato `tools` de Ollama (JSON Schema) |
| `src/mcp/tool-registry.ts` | Registry unificado: MCP tools + tools internas |
| `src/mcp/servers/null-server.ts` | MCP server que expone tools de Null (stdin/stdio) |

### Cambios en archivos existentes

| Archivo | Cambio |
|---|---|
| `src/core/llm-client.ts` | `OllamaChatBody` incluye `tools` array, maneja `tool_calls` en response |
| `src/core/agent.ts` | Reemplazar system prompt con tools + regex → parámetro `tools` real de Ollama |
| `src/core/execute.ts` | Dispatch vía `tools/call` en vez de `switch` |
| `src/core/tools.ts` | Wrapper thin que delega al MCP client |
| `package.json` | + `@modelcontextprotocol/sdk` |

### Tools expuestas por null-server

| Tool MCP | Función actual |
|---|---|
| `get_time` | `tools.ts:get_time` |
| `get_location` | `tools.ts:get_location` |
| `get_weather` | `tools.ts:get_weather` |
| `web_search` | `tools.ts:web_search` |
| `web_fetch` | `tools.ts:web_fetch` |
| `news_digest` | `mexico-news.ts:buildTopicNewsDigest` |
| `news_manage_topics` | CRUD de `news_topics` |

### Soporte para MCP servers externos (configurable)

```jsonc
// null-cli.json
{
  "mcpServers": {
    "github": { "command": "npx", "args": ["@modelcontextprotocol/server-github"], "transport": "stdio" }
  }
}
```

---

## Fase 3: MCP wrap de News Topics

Ya con el sistema de topics funcionando, se expone vía MCP:

### `news_digest`

```json
{
  "name": "news_digest",
  "description": "Get news digest for a configured topic",
  "inputSchema": {
    "type": "object",
    "properties": {
      "topic": { "type": "string", "description": "Topic name (tecnología, finanzas, méxico...)" }
    },
    "required": ["topic"]
  }
}
```

### `news_manage_topics`

```json
{
  "name": "news_manage_topics",
  "description": "Add, remove, or list news topics",
  "inputSchema": {
    "type": "object",
    "properties": {
      "action": { "type": "string", "enum": ["list", "add", "remove"] },
      "name": { "type": "string" },
      "keywords": { "type": "array", "items": { "type": "string" } }
    }
  }
}
```

---

## Timeline estimado

| Fase | Dependencias | Tiempo estimado |
|---|---|---|
| 1a + 1b (DB + refactor pipeline) | — | 2-3h |
| 1c + 1d (router + comandos chat) | 1a | 2-3h |
| 1e (sugerencias automáticas) | 1a | 1h |
| 2 (MCP Client Adapter) | — | 4-5h |
| 3 (wrap news en MCP) | 1 + 2 | 1h |

**Total: ~10-13h**

---

## Lo que ganas con esto

| Hoy | Con el plan |
|---|---|
| News hardcodeado a México | Topics configurables por el usuario |
| Router solo reconoce queries en español de México | Router detecta cualquier topic configurado |
| Tools en texto plano en el prompt | Tools con JSON Schema formal |
| Regex para parsear tool calls | Ollama devuelve `tool_calls` estructurados |
| `switch` para dispatch | Dispatch dinámico vía MCP `tools/call` |
| Sin descubrimiento | `tools/list` en startup |
| Tools solo internas | Cualquier MCP server externo funciona |
