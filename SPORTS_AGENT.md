# Sports Agent — Null CLI
> Arquitectura v2 · Multi-provider · Liga MX + Big 5 + más

---

## Visión general

El Sports Agent es un sub-agente especializado dentro de Null CLI que entrega
información deportiva en tiempo real: resultados, tablas, calendario y noticias.
Opera con tres providers de datos externos y selecciona automáticamente el mejor
según el tipo de consulta y disponibilidad.

---

## Stack de providers

| Provider   | Rol principal         | Fortaleza                              | Debilidad                        |
|------------|-----------------------|----------------------------------------|----------------------------------|
| FotMob     | Source of truth       | Live scores, fixtures, standings       | X-MAS header puede cambiar       |
| ESPN       | Noticias y clubes     | News API estable, datos de equipos     | Live scores pobres en Liga MX    |
| SofaScore  | Stats profundas (v2+) | Ratings, heatmaps, estadísticas ricas  | Cloudflare, rate limiting fuerte |

### Mapeo capability → provider

| Capability    | Primary    | Fallback   |
|---------------|------------|------------|
| `scoreboard`  | FotMob     | ESPN       |
| `standings`   | FotMob     | ESPN       |
| `fixtures`    | FotMob     | ESPN       |
| `news`        | ESPN       | FotMob     |

---

## Ligas soportadas (MVP)

| Liga                 | FotMob ID | ESPN slug         | Sport      |
|----------------------|-----------|-------------------|------------|
| Liga MX              | 10160     | mex.1             | soccer     |
| Premier League       | 47        | eng.1             | soccer     |
| La Liga              | 87        | esp.1             | soccer     |
| Bundesliga           | 54        | ger.1             | soccer     |
| Serie A              | 55        | ita.1             | soccer     |
| Ligue 1              | 53        | fra.1             | soccer     |
| Champions League     | 42        | uefa.champions    | soccer     |
| MLS                  | 130       | usa.1             | soccer     |
| Copa Libertadores    | 384       | conmebol.libertadores | soccer |

---

## Estructura de archivos

```
src/tools/sports/
├── index.ts                  # buildSportsContext() — punto de entrada público
├── types.ts                  # Interfaces compartidas (SportsProvider, etc.)
├── router.ts                 # Selección de provider por capability + fallback
├── intent.ts                 # Detección de intent (scoreboard/standings/fixtures/news)
├── providers/
│   ├── fotmob.ts             # FotMobProvider
│   ├── espn.ts               # ESPNProvider
│   └── sofascore.ts          # SofaScoreProvider (v2+, stub por ahora)
├── formatters/
│   ├── scoreboard.ts         # Tabla markdown de resultados
│   ├── standings.ts          # Tabla de posiciones
│   ├── fixtures.ts           # Calendario de partidos
│   └── news.ts               # Cards de noticias
└── cache.ts                  # TTL cache por tipo de dato (SQLite)
```

---

## Schema de base de datos

```sql
-- Entidades canónicas (source of truth interno)
CREATE TABLE leagues (
  id          TEXT PRIMARY KEY,   -- 'liga_mx', 'premier_league'
  name        TEXT NOT NULL,      -- 'Liga MX'
  country     TEXT,               -- 'México'
  sport       TEXT NOT NULL       -- 'soccer'
);

CREATE TABLE teams (
  id          TEXT PRIMARY KEY,   -- 'atlas', 'manchester_city'
  name        TEXT NOT NULL,      -- 'Atlas'
  league_id   TEXT NOT NULL REFERENCES leagues(id)
);

-- Mapeo de entidades a providers externos
CREATE TABLE entity_providers (
  entity_type TEXT NOT NULL,      -- 'league' | 'team'
  entity_id   TEXT NOT NULL,      -- 'liga_mx'
  provider    TEXT NOT NULL,      -- 'fotmob' | 'espn' | 'sofascore'
  external_id TEXT NOT NULL,      -- '10160'
  PRIMARY KEY (entity_type, entity_id, provider)
);

-- Aliases de detección (input del usuario → entity_id canónico)
CREATE TABLE sports_aliases (
  alias       TEXT PRIMARY KEY,   -- 'ligamx', 'zorros', 'chivas'
  entity_id   TEXT NOT NULL,      -- 'liga_mx', 'atlas'
  entity_type TEXT NOT NULL       -- 'league' | 'team'
);

-- Cache de resultados por provider
CREATE TABLE sports_cache (
  cache_key   TEXT PRIMARY KEY,
  result      TEXT NOT NULL,      -- JSON
  created_at  INTEGER NOT NULL,
  ttl_seconds INTEGER NOT NULL
);
```

### TTL por tipo de dato

| Tipo           | TTL              | Razón                                  |
|----------------|------------------|----------------------------------------|
| Live scores    | 60 seg           | Partido en curso                       |
| Final scores   | 24 horas         | Ya no cambia                           |
| Fixtures       | 1 hora           | Cambios de horario son raros           |
| Standings      | 4 horas          | Solo cambia tras jornada               |
| News           | 30 minutos       | Noticias se actualizan frecuentemente  |

---

## Interfaces TypeScript

```typescript
// types.ts

export type SportProvider = 'fotmob' | 'espn' | 'sofascore'
export type SportsCapability = 'scoreboard' | 'standings' | 'fixtures' | 'news'
export type EntityType = 'league' | 'team'

export interface SportsProvider {
  id: SportProvider
  capabilities: Record<SportsCapability, boolean>

  getScoreboard(leagueId: string, range: DateRange): Promise<SportsScoreboard>
  getStandings(leagueId: string): Promise<SportsStandings>
  getFixtures(leagueId: string, range: DateRange): Promise<SportsFixtures>
  getNews(entityId: string, entityType: EntityType): Promise<SportsNewsItem[]>
}

export interface SportsScoreboard {
  league: string
  season?: string
  seasonPhase?: string
  games: SportsGame[]
  effectiveRange: DateRange
}

export interface SportsGame {
  id: string
  date: string           // ISO 8601
  status: 'scheduled' | 'in_progress' | 'final'
  statusDetail: string   // 'FT', 'HT', "45'"
  home: SportsCompetitor
  away: SportsCompetitor
  venue?: string
  phase?: string         // 'Cuartos de Final', 'Semifinales'
}

export interface SportsCompetitor {
  team: string
  abbreviation: string
  score: string
  winner: boolean
}

export interface SportsStandings {
  league: string
  season?: string
  groups: {
    name: string
    entries: StandingsEntry[]
  }[]
}

export interface StandingsEntry {
  rank?: number
  team: string
  played: number
  wins: number
  draws: number
  losses: number
  goalsFor: number
  goalsAgainst: number
  points: number
  form?: string          // 'WDLWW'
  note?: string          // 'Classified', 'Relegated'
}

export interface SportsFixtures {
  league: string
  games: SportsGame[]    // solo status: 'scheduled'
}

export interface SportsNewsItem {
  headline: string
  description?: string
  published: string      // ISO 8601
  source: string
  url?: string
  categories: string[]
}

export interface DateRange {
  from: Date
  to: Date
}

// Resultado unificado que sale del buildSportsContext()
export interface SportsQueryResult {
  intent: SportsCapability
  leagueId: string
  teamId?: string
  provider: SportProvider
  scoreboard?: SportsScoreboard
  standings?: SportsStandings
  fixtures?: SportsFixtures
  news?: SportsNewsItem[]
  tableOutput: string        // Markdown pre-renderizado para TUI
  llmContext: string         // Texto para inyectar al LLM
  seasonPhase?: string
  scoreboard?: SportsScoreboard  // raw para el commentary prompt
}
```

---

## Flujo de una query

```
Usuario: "dame los resultados de la liga mx"
          │
          ▼
     intent.ts
     detectSportsIntent(query)
          │
          ├── leagueId: 'liga_mx'
          ├── intent:   'scoreboard'
          └── dateRange: lastMatchday / currentWeek
          │
          ▼
     router.ts
     resolveProvider('scoreboard', 'liga_mx')
          │
          ├── busca entity_providers WHERE entity_id='liga_mx'
          ├── filtra por capability 'scoreboard'
          └── ordena por prioridad → FotMob primero
          │
          ▼
     providers/fotmob.ts
     FotMobProvider.getScoreboard('10160', range)
          │
          ├── revisa sports_cache
          ├── si miss → fetch FotMob API
          ├── parsea respuesta → SportsScoreboard
          └── guarda en cache con TTL apropiado
          │
          ▼
     formatters/scoreboard.ts
     formatScoreboardTable(scoreboard)
     formatScoreboardContext(scoreboard)  ← para el LLM
          │
          ▼
     SportsQueryResult {
       tableOutput: "| Atlas | 2-1 | Chivas | ...",
       llmContext:  "=== Liga MX === ...",
       scoreboard:  { ... }
     }
          │
          ▼
     sports/agents/sports.agent.ts
     → tableOutput se muestra en TUI inmediatamente
     → llmContext se inyecta al LLM para commentary
```

---

## Detección de intents

```typescript
// intent.ts — reglas de detección

const INTENT_SIGNALS = {
  scoreboard: [
    /\b(resultados?|marcador(es)?|scores?|cómo\s+quedó|cómo\s+terminó)\b/i,
    /\b(última\s+jornada|jornada\s+pasada|fin\s+de\s+semana)\b/i,
    /\b(jugó|jugaron|ganó|empató|perdió)\b/i,
  ],
  standings: [
    /\b(tabla|standings?|posiciones|clasificaci[oó]n|puntaje)\b/i,
    /\b(quién\s+va\s+primero|líder\s+de\s+la\s+liga)\b/i,
  ],
  fixtures: [
    /\b(calendario|fixture|próximos?\s+partidos?|cuándo\s+juega)\b/i,
    /\b(upcoming|next\s+match|siguiente\s+partido)\b/i,
  ],
  news: [
    /\b(noticias?|news|novedades?|transfers?|fichajes?)\b/i,
    /\b(qué\s+pasó\s+con|qué\s+hay\s+de)\b.*\b(equipo|club|liga)\b/i,
  ],
}
```

---

## FotMob Provider — endpoints clave

```typescript
// providers/fotmob.ts

const FOTMOB_BASE = 'https://www.fotmob.com/api'

// Partidos por fecha
GET /matches?date=YYYYMMDD

// Detalle de liga (standings + fixtures)
GET /leagues?id={leagueId}&cacheKey={season}&timezone={tz}

// Detalle de partido
GET /matchDetails?matchId={matchId}

// Noticias de liga
GET /leagues?id={leagueId}  // dentro de 'newsTab'

// Nota: algunos endpoints requieren header X-MAS
// Obtenerlo de las request headers en fotmob.com (TLTABLE request)
```

### IDs de ligas en FotMob

```typescript
const FOTMOB_LEAGUE_IDS = {
  liga_mx:          '10160',
  premier_league:   '47',
  la_liga:          '87',
  bundesliga:       '54',
  serie_a:          '55',
  ligue_1:          '53',
  champions_league: '42',
  mls:              '130',
  libertadores:     '384',
}
```

---

## ESPN Provider — endpoints clave

```typescript
// providers/espn.ts

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports'

// Noticias de liga
GET /{sport}/{leagueSlug}/news?limit=10

// Noticias de equipo
GET /{sport}/{leagueSlug}/teams/{teamId}/news?limit=10

// Scoreboard (fallback)
GET /{sport}/{leagueSlug}/scoreboard?dates={YYYYMMDD-YYYYMMDD}

// Standings (fallback)
GET /v2/sports/{sport}/{leagueSlug}/standings
```

---

## Orden de implementación recomendado

1. **Schema de DB** — crear tablas `leagues`, `teams`, `entity_providers`, `sports_aliases`, `sports_cache` con seeds para Liga MX + Big 5

2. **types.ts** — definir todas las interfaces

3. **intent.ts** — detección de intent + entidad desde el query

4. **providers/fotmob.ts** — implementar `getScoreboard`, `getStandings`, `getFixtures`, `getNews`

5. **providers/espn.ts** — implementar `getNews` principalmente, `getScoreboard`/`getStandings` como fallback

6. **router.ts** — lógica de selección de provider + fallback automático

7. **formatters/** — tablas markdown para TUI + contexto para LLM

8. **index.ts** — `buildSportsContext()` que orquesta todo

9. **Conectar al sports.agent.ts** — reemplazar la llamada actual a `buildSportsContext` del ESPN monolítico

---

## Notas importantes

- El `X-MAS` header de FotMob se genera client-side con un hash. Si empieza a fallar, revisar repos como `@max-xoo/fotmob` que lo manejan automáticamente.
- ESPN teams/{id}/news retorna `{}` para Liga MX — workaround: usar `leagueNews` y filtrar por nombre de equipo.
- El módulo actual `src/tools/sports.ts` puede borrarse completamente una vez que el nuevo `src/tools/sports/index.ts` esté funcional y los tests pasen.
- La tabla `espn_leagues` y `espn_teams` existentes pueden deprecarse gradualmente una vez migrado al nuevo schema.
