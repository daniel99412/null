# ESPN API — Documentación Completa

> Referencia unificada de la API no oficial de ESPN: dominios, endpoints, parámetros, slugs de ligas, schemas de respuesta, notas de compatibilidad por deporte y ejemplos curl.
>
> **Dominios verificados en vivo el 2026-03-26 — todos respondieron HTTP 200 OK.**

---

## Tabla de Contenidos

1. [Dominios y Routing](#1-dominios-y-routing)
2. [Quick Reference — Endpoints más usados](#2-quick-reference)
3. [Notas críticas por deporte — errores conocidos](#3-notas-criticas-errores-conocidos)
4. [Endpoints Globales (v2 y v3)](#4-endpoints-globales)
5. [Deportes](#5-deportes)
   - [Football (NFL / NCAA / CFL)](#51-football)
   - [Basketball (NBA / WNBA / NCAA)](#52-basketball)
   - [Soccer (260+ ligas)](#53-soccer)
   - [Baseball (MLB / NCAA / Invierno)](#54-baseball)
   - [Hockey (NHL / NCAA)](#55-hockey)
   - [Golf (PGA / LPGA / LIV)](#56-golf)
   - [Motor Sports (F1 / IndyCar / NASCAR)](#57-motor-sports)
   - [Tennis (ATP / WTA)](#58-tennis)
   - [MMA (UFC / Bellator / 50+ promotions)](#59-mma)
   - [Rugby Union](#510-rugby-union)
   - [Rugby League (NRL / Super League)](#511-rugby-league)
   - [Lacrosse (PLL / NLL / NCAA)](#512-lacrosse)
   - [Cricket](#513-cricket)
   - [Volleyball](#514-volleyball)
   - [Water Polo](#515-water-polo)
   - [Field Hockey](#516-field-hockey)
   - [Australian Rules Football (AFL)](#517-australian-rules-football)
   - [College Sports — resumen especial](#518-college-sports)
6. [Schemas de Respuesta (JSON)](#6-schemas-de-respuesta)
7. [Now API — Noticias en tiempo real](#7-now-api)
8. [CDN Game Package](#8-cdn-game-package)
9. [Athlete Data — common/v3](#9-athlete-data-commonv3)

---

## 1. Dominios y Routing

| Dominio | Uso principal | Claves verificadas en respuesta |
|---------|---------------|---------------------------------|
| `site.api.espn.com/apis/site/v2/` | Scoreboard, teams, news, injuries, transactions, statistics, groups, draft, summary, rankings | `leagues`, `season`, `week`, `events` (scoreboard); `header`, `articles` (news) |
| `site.api.espn.com/apis/v2/` | **Standings** — `site/v2` devuelve stub vacío | `uid`, `id`, `name`, `abbreviation`, `children` |
| `site.web.api.espn.com/apis/common/v3/` | Athlete stats, gamelog, overview, splits (`statistics/byathlete`) | igual a site.api |
| `cdn.espn.com/core/` | Paquete completo de partido — drives, plays, odds (requiere `?xhr=1`) | Varía por deporte |
| `now.core.api.espn.com/v1/` | Feed de noticias en tiempo real | `resultsCount`, `resultsLimit`, `resultsOffset`, `headlines[]` |
| `sports.core.api.espn.com/v2/` | Datos core — events, odds, play-by-play, athletes, coaches | `$ref`, `id`, `name`, `season`, `teams`, `athletes`; colecciones: `count`, `pageIndex`, `pageSize`, `items[]` |

### Excepciones por deporte

- **Cricket scoreboard** → usar core API: `sports.core.api.espn.com/v2/sports/cricket/leagues/{league}/events`
- **Rugby Union standings** → usar core API: `sports.core.api.espn.com/v2/sports/rugby/leagues/{league}/standings`
- **Golf scoreboard** → requiere slug nombrado: `pga`, `lpga`, `liv`, `eur` (IDs numéricos devuelven 400)
- **Tennis scoreboard** → requiere slug nombrado: `atp`, `wta` (IDs numéricos devuelven 400)
- **Soccer standings** → `/apis/site/v2/` devuelve `{}` vacío, usar `/apis/v2/`
- **Standings en general** → Todos los deportes de equipo: usar `/apis/v2/` en lugar de `/apis/site/v2/`

---

## 2. Quick Reference

| Dato | URL |
|------|-----|
| Scoreboard | `https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard` |
| Teams | `https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/teams` |
| Standings | `https://site.api.espn.com/apis/v2/sports/{sport}/{league}/standings` |
| Game summary | `https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/summary?event={id}` |
| Full game package | `https://cdn.espn.com/core/{sport}/game?xhr=1&gameId={id}` |
| Athlete overview | `https://site.web.api.espn.com/apis/common/v3/sports/{sport}/{league}/athletes/{id}/overview` |
| Athlete stats | `https://site.web.api.espn.com/apis/common/v3/sports/{sport}/{league}/athletes/{id}/stats` |
| Stats leaderboard | `https://site.web.api.espn.com/apis/common/v3/sports/{sport}/{league}/statistics/byathlete` |
| Real-time news | `https://now.core.api.espn.com/v1/sports/news?sport=football` |
| Core API | `https://sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}/...` |

### Parámetros comunes

| Parámetro | Descripción |
|-----------|-------------|
| `dates={YYYYMMDD}` | Filtrar por fecha |
| `dates={YYYYMMDD}-{YYYYMMDD}` | Rango de fechas |
| `week={n}&seasontype=2` | Semana específica (football) |
| `groups={id}` | Filtrar por conferencia |
| `limit={n}` | Número de resultados |
| `page={n}` | Paginación |
| `active=true` | Solo activos |

---

## 3. Notas Críticas — Errores conocidos

### Standings

| Deporte/Liga | Problema | Solución |
|--------------|----------|----------|
| Todos los deportes de equipo (NFL, NBA, NHL, MLB, etc.) | `/apis/site/v2/.../standings` devuelve solo un stub | Usar `/apis/v2/sports/{sport}/{league}/standings` |
| Soccer (todas las ligas) | `/apis/site/v2/` devuelve `{}` vacío | Usar `/apis/v2/sports/soccer/{league}/standings` o `site.web.api.espn.com/apis/v2/...` |
| Rugby Union | `/apis/site/v2/` devuelve error 500; `/apis/v2/` devuelve `{"children":[], "seasons":{}}` vacío | Usar `sports.core.api.espn.com/v2/sports/rugby/leagues/{league}/standings` (solo referencia) |
| AFL (Australian Football) | `/apis/site/v2/` devuelve redirect stub | Usar `site.api.espn.com/apis/v2/sports/australian-football/afl/standings` |

### Injuries (endpoint `/injuries`)

| Deporte | Estado |
|---------|--------|
| NBA, NFL, NHL, MLB, Soccer | Funciona correctamente |
| Golf | Devuelve **HTTP 500** — no soportado |
| Tennis | Devuelve **HTTP 500** — no soportado |
| MMA | Devuelve **HTTP 500** — no soportado |

### Athlete Data (common/v3)

| Deporte | `overview` | `stats` | `gamelog` | `splits` | `statistics/byathlete` |
|---------|-----------|---------|-----------|----------|----------------------|
| NFL | ✅ | ✅ | ✅ | ✅ | ✅ |
| NBA | ✅ | ✅ | ✅ | ✅ | ✅ |
| MLB | ✅ | ✅ | ✅ | ✅ | ✅ (con `?category=batting`) |
| NHL | ✅ | ✅ | ❌ 404 | ✅ | ✅ |
| Soccer | ⚠️ Mínimo (solo próximo partido) | ❌ 404 | ❌ 400 | ❌ | ❌ |
| College Basketball (NCAAM/NCAAW) | ✅ | ✅ | ✅ | ✅ | ✅ |
| WNBA | ✅ | ✅ | ✅ | ✅ | ✅ |

> Para soccer usar: `sports.core.api.espn.com/v2/sports/soccer/leagues/{league}/athletes/{id}`

### Scoreboard

| Deporte | Problema | Solución |
|---------|----------|----------|
| Cricket | `/scoreboard` devuelve 404 en todos los dominios | Usar `sports.core.api.espn.com/v2/sports/cricket/leagues/{league}/events` |
| Golf | Requiere slug nombrado (`pga`, `lpga`, `liv`, `eur`) | No usar IDs numéricos |
| Tennis | Requiere slug nombrado (`atp`, `wta`) | No usar IDs numéricos |

### Slugs especiales

| Deporte | Nota |
|---------|------|
| Rugby Union | Usa **IDs numéricos** como slugs (ej. `164205` para World Cup, `180659` para Six Nations) |
| Rugby League | ID único `3` para todas las competiciones bajo la liga principal |
| Soccer | Usa slugs con puntos: `eng.1`, `uefa.champions`, `usa.1`, etc. |

---

## 4. Endpoints Globales

**Base URL (v2):** `https://sports.core.api.espn.com/v2`
**Base URL (v3):** `https://sports.core.api.espn.com/v3`

### Discovery (Cross-sport)

```bash
# Todos los deportes
curl "https://sports.core.api.espn.com/v2/sports"
curl "https://sports.core.api.espn.com/v3/sports"

# Todas las ligas (cross-sport)
curl "https://sports.core.api.espn.com/v2/ontology/leagues?limit=500"
curl "https://sports.core.api.espn.com/v3/leagues?limit=500"

# Todos los equipos (cross-sport)
curl "https://sports.core.api.espn.com/v2/ontology/teams?limit=500"
curl "https://sports.core.api.espn.com/v3/teams?limit=1000"

# API docs
curl "https://sports.core.api.espn.com/v2/api-docs"
```

### Athletes & Coaches (v3 cross-sport)

```bash
curl "https://sports.core.api.espn.com/v3/athletes/{athleteId}"
curl "https://sports.core.api.espn.com/v3/{athlete}/eventlog"
curl "https://sports.core.api.espn.com/v3/coaches/{coachId}"
```

### Teams (v3 cross-sport)

```bash
curl "https://sports.core.api.espn.com/v3/teams/{teamId}"
curl "https://sports.core.api.espn.com/v3/teams/{teamId}/depthcharts"
curl "https://sports.core.api.espn.com/v3/teams/{teamId}/events"
```

### Events & Plays (v3)

```bash
curl "https://sports.core.api.espn.com/v3/events?limit=100&dates=20250915"
curl "https://sports.core.api.espn.com/v3/events/{eventId}"
curl "https://sports.core.api.espn.com/v3/events/{eventId}/competitions/{compId}/plays"
```

### Odds, Predicciones, Power Index (v3)

```bash
curl "https://sports.core.api.espn.com/v3/odds"
curl "https://sports.core.api.espn.com/v3/predictions"
curl "https://sports.core.api.espn.com/v3/powerindex"
curl "https://sports.core.api.espn.com/v3/standings"
```

### Tabla completa de endpoints v2 globales (selección)

| Endpoint | Method ID | Query Params principales |
|----------|-----------|--------------------------|
| `/v2/sports` | `getSports` | `page`, `limit` |
| `/v2/ontology/leagues` | `getLeagues` | `page`, `limit` |
| `/v2/ontology/teams` | `getTeams` | `page`, `limit` |
| `/v2/ontology/events` | `getEvents` | `discovery`, `page`, `limit`, `dates`, `start`, `end` |
| `/v2/athletes` | `getDraftAthletes` | `page`, `limit`, `available`, `position`, `team`, `sort`, `filter` |
| `/v2/colleges` | `getColleges` | `page`, `limit` |
| `/v2/competitions` | `getCompetitions` | `page`, `limit` |
| `/v2/drives` | `getDrives` | `period`, `page`, `limit` |
| `/v2/events` | `getSpadeEvents` | `page`, `limit` |
| `/v2/events/{eventId}/competitions/{competitionId}/odds` | `getCompetitionOdds` | `page`, `limit` |
| `/v2/events/{eventId}/competitions/{competitionId}/probabilities` | `getProbabilities` | `page`, `limit` |
| `/v2/plays` | `getPlays` | `page`, `limit`, `period`, `sort` |
| `/v2/powerindex` | `getPowerIndexSeasons` | `groupId`, `page`, `limit` |
| `/v2/probabilities` | `getProbabilities` | `page`, `limit` |
| `/v2/ranks` | `getTeamRankings` | `page`, `limit` |
| `/v2/venues` | `getEventVenues` | `page`, `limit` |
| `/v2/venues/{venueId}` | `getVenue` | `page`, `limit` |
| `/v2/zip/{zip}` | `getWeatherForZip` | `date`, `hour`, `page`, `limit` |
| `/v2/{league}/events` | `getEvents` | `bpi`, `page`, `limit`, `dates`, `season`, `weeks` |
| `/v2/{league}/standings` | `getCurrentStandings` | `page`, `limit` |
| `/v2/{league}/standings/season/{season}` | `getCurrentStandings` | `page`, `limit` |
| `/v2/{league}/leaders` | `getLeaders` | `page`, `limit` |
| `/v2/{league}/statistics` | `getStatistics` | `sort`, `page`, `limit` |
| `/v2/{league}/transactions` | `getTransactions` | `page`, `limit`, `dates` |
| `/v2/{league}/draft` | `getDraft` | `page`, `limit` |
| `/v2/{league}/qbr/{split}` | `getAllTimeQBR` | `qualified`, `sort`, `group`, `seasonType`, `page`, `limit` |
| `/v2/{athlete}/statistics` | `getCareerStatistics` | `seasonType`, `page`, `limit` |
| `/v2/{athlete}/eventlog` | `getEventLog` | `types`, `page`, `limit` |
| `/v2/{athlete}/injuries` | `getInjuries` | `dates`, `page`, `limit` |
| `/v2/{athlete}/contracts` | `getContracts` | `page`, `limit` |
| `/v2/{athlete}/vsathlete/{opponentId}` | `getPlayerVsPlayerCareerStats` | `seasontypes`, `page`, `limit` |
| `/v2/{oddId}/history/{betType}` | `getCompetitionOddsHistory` | `page`, `limit` |
| `/v2/olympics` | `getOlympicTypes` | `page`, `limit`, `dates`, `filter`, `country` |

---

## 5. Deportes

### 5.1 Football

**Sport slug:** `football`
**Ligas disponibles:**

| Abreviatura | Liga | Slug |
|-------------|------|------|
| `NFL` | National Football League | `nfl` |
| `NCAAF` | NCAA Football | `college-football` |
| `CFL` | Canadian Football League | `cfl` |
| `UFL` | United Football League | `ufl` |
| `XFL` | XFL | `xfl` |

#### Site API

```
GET https://site.api.espn.com/apis/site/v2/sports/football/{league}/{resource}
```

| Resource | Descripción |
|----------|-------------|
| `scoreboard` | Marcadores en vivo |
| `scoreboard?week={n}&seasontype=2` | Semana específica |
| `scoreboard?dates={YYYYMMDD}` | Fecha específica |
| `teams` | Todos los equipos |
| `teams/{id}` | Equipo individual |
| `teams/{id}/roster` | Plantel |
| `teams/{id}/schedule` | Calendario |
| `teams/{id}/record` | Record |
| `teams/{id}/news` | Noticias del equipo |
| `teams/{id}/depthcharts` | Profundidad de plantel |
| `teams/{id}/injuries` | Lesionados del equipo |
| `teams/{id}/leaders` | Líderes estadísticos |
| `injuries` | Lesionados de toda la liga |
| `transactions` | Fichajes, trades, waivers |
| `statistics` | Líderes estadísticos de la liga |
| `groups` | Conferencias y divisiones |
| `draft` | Draft board (solo NFL) |
| `standings` | ⚠️ Solo stub — usar `/apis/v2/` |
| `news` | Noticias |
| `athletes/{id}/news` | Noticias de un atleta |
| `summary?event={id}` | Resumen completo + boxscore |
| `rankings` | Rankings de polls (solo `college-football`) |

> ⚠️ **Standings:** Usar `https://site.api.espn.com/apis/v2/sports/football/{league}/standings`

#### Core API endpoints (v2)

```
https://sports.core.api.espn.com/v2/sports/football/leagues/{league}/...
```

| Sub-ruta | Descripción |
|----------|-------------|
| `/calendar` | Calendario |
| `/seasons` | Temporadas |
| `/seasons/{season}/athletes` | Atletas de temporada |
| `/seasons/{season}/draft` | Draft por año |
| `/seasons/{season}/freeagents` | Agentes libres |
| `/teams` | Equipos |
| `/athletes` | Atletas |
| `/events/{event}` | Evento individual |
| `/events/{event}/competitions/{competition}` | Competición |
| `/events/{event}/competitions/{competition}/broadcasts` | Transmisiones |
| `/events/{event}/competitions/{competition}/odds` | Cuotas |
| `/events/{event}/competitions/{competition}/officials` | Árbitros |
| `/media` | Medios |
| `/rankings` | Rankings |
| `/venues` | Estadios |
| `/franchises` | Franquicias |
| `/positions` | Posiciones |
| `/season` | Temporada actual |

#### CDN Game Data

```bash
curl "https://cdn.espn.com/core/nfl/game?xhr=1&gameId={EVENT_ID}"
curl "https://cdn.espn.com/core/nfl/boxscore?xhr=1&gameId={EVENT_ID}"
curl "https://cdn.espn.com/core/nfl/playbyplay?xhr=1&gameId={EVENT_ID}"
curl "https://cdn.espn.com/core/nfl/matchup?xhr=1&gameId={EVENT_ID}"
curl "https://cdn.espn.com/core/college-football/game?xhr=1&gameId={EVENT_ID}"
```

#### Endpoints especializados (Football)

```bash
# QBR — Season totals (NFL)
GET https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/{year}/types/2/groups/1/qbr/0
# QBR semanal
GET https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/{year}/types/2/weeks/{week}/qbr/0
# QBR College Football
GET https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/{year}/types/2/groups/80/qbr/0
# Split values: 0=totals, 1=home, 2=away

# Recruiting (NCAAF)
GET https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/{year}/recruits
GET https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/{year}/classes/{teamId}

# Power Index SP+
GET https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/{year}/powerindex
GET https://sports.core.api.espn.com/v2/sports/football/leagues/college-football/seasons/{year}/powerindex/leaders
```

#### Ejemplos

```bash
curl "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard"
curl "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=1&seasontype=2"
curl "https://site.api.espn.com/apis/v2/sports/football/nfl/standings"
curl "https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/6/roster"
curl "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?week=1&seasontype=2&groups=80"
curl "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/athletes?limit=100&active=true"
```

---

### 5.2 Basketball

**Sport slug:** `basketball`
**Ligas disponibles:**

| Abreviatura | Liga | Slug |
|-------------|------|------|
| `NBA` | National Basketball Association | `nba` |
| `WNBA` | Women's National Basketball Association | `wnba` |
| `NCAAM` | NCAA Men's Basketball | `mens-college-basketball` |
| `NCAAW` | NCAA Women's Basketball | `womens-college-basketball` |
| `NBL` | National Basketball League (Australia) | `nbl` |
| `FIBA` | FIBA World Cup | `fiba` |
| `NBA G LEAGUE` | NBA G League | `nba-development` |
| `NBALV` | Las Vegas Summer League | `nba-summer-las-vegas` |
| `NBACC` | NBA California Classic Summer League | `nba-summer-california` |
| `NBAGS` | Golden State Summer League | `nba-summer-golden-state` |
| `NBAOR` | Orlando Summer League | `nba-summer-orlando` |
| `NBAUT` | Salt Lake City Summer League | `nba-summer-utah` |
| `OLYMPICS` | Men's Olympics Basketball | `mens-olympics-basketball` |
| `OLYMPICS` | Women's Olympics Basketball | `womens-olympics-basketball` |

#### Site API

```
GET https://site.api.espn.com/apis/site/v2/sports/basketball/{league}/{resource}
```

| Resource | Descripción |
|----------|-------------|
| `scoreboard` | Marcadores |
| `scoreboard?dates={YYYYMMDD}` | Fecha específica |
| `teams` | Equipos |
| `teams/{id}/roster` | Plantel |
| `teams/{id}/injuries` | Lesionados |
| `teams/{id}/depth-charts` | Profundidad |
| `teams/{id}/leaders` | Líderes |
| `injuries` | Lesionados de la liga |
| `transactions` | Movimientos |
| `statistics` | Estadísticas |
| `groups` | Conferencias |
| `draft` | Draft (solo NBA) |
| `standings` | ⚠️ Solo stub — usar `/apis/v2/` |
| `news` | Noticias |
| `summary?event={id}` | Resumen + boxscore |
| `rankings` | Rankings (solo NCAA) |

#### Endpoints especializados (Basketball)

```bash
# Bracketology NCAA
GET https://sports.core.api.espn.com/v2/tournament/{tournamentId}/seasons/{year}/bracketology
# tournamentId: 22 = NCAA Men's, 23 = NCAA Women's

# BPI (Power Index)
GET https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball/seasons/{year}/powerindex
GET https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball/seasons/{year}/powerindex/{teamId}
```

#### Ejemplos

```bash
curl "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard"
curl "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=20250320"
curl "https://site.api.espn.com/apis/v2/sports/basketball/nba/standings"
curl "https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/13/roster"
curl "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard"
curl "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/athletes?limit=100&active=true"
```

---

### 5.3 Soccer

**Sport slug:** `soccer`

#### Ligas — más de 260 disponibles

##### Internacional / FIFA

| Slug | Descripción |
|------|-------------|
| `fifa.world` | FIFA World Cup |
| `fifa.wwc` | FIFA Women's World Cup |
| `fifa.world.u20` | FIFA Under-20 World Cup |
| `fifa.friendly` | International Friendly |
| `fifa.olympics` | Men's Olympic Soccer |
| `fifa.w.olympics` | Women's Olympic Soccer |
| `fifa.worldq.uefa` | World Cup Qualifying - UEFA |
| `fifa.worldq.concacaf` | World Cup Qualifying - Concacaf |
| `fifa.worldq.conmebol` | World Cup Qualifying - CONMEBOL |

##### UEFA

| Slug | Descripción |
|------|-------------|
| `uefa.champions` | UEFA Champions League |
| `uefa.europa` | UEFA Europa League |
| `uefa.europa.conf` | UEFA Conference League |
| `uefa.super_cup` | UEFA Super Cup |
| `uefa.wchampions` | UEFA Women's Champions League |
| `uefa.euro` | UEFA European Championship |
| `uefa.nations` | UEFA Nations League |

##### Principales ligas nacionales

| Slug | Descripción |
|------|-------------|
| `eng.1` | English Premier League |
| `eng.2` | English Championship |
| `eng.fa` | FA Cup |
| `eng.w.1` | Women's Super League |
| `esp.1` | Spanish LALIGA |
| `esp.2` | Spanish LALIGA 2 |
| `ger.1` | German Bundesliga |
| `ger.2` | German 2. Bundesliga |
| `ita.1` | Italian Serie A |
| `fra.1` | French Ligue 1 |
| `ned.1` | Dutch Eredivisie |
| `por.1` | Portuguese Primeira Liga |
| `sco.1` | Scottish Premiership |
| `bel.1` | Belgian Pro League |
| `tur.1` | Turkish Super Lig |
| `usa.1` | MLS |
| `usa.nwsl` | NWSL |
| `mex.1` | Mexican Liga BBVA MX |
| `conmebol.libertadores` | CONMEBOL Libertadores |
| `conmebol.america` | Copa America |
| `arg.1` | Argentine Liga Profesional |
| `bra.1` | Brazilian Serie A |
| `caf.nations` | Africa Cup of Nations |
| `afc.champions` | AFC Champions League Elite |
| `ksa.1` | Saudi Pro League |
| `jpn.1` | Japanese J.League |
| `eng.league_cup` | Carabao Cup |
| `concacaf.champions` | Concacaf Champions Cup |
| `concacaf.gold` | Concacaf Gold Cup |

#### Site API

```
GET https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/{resource}
```

| Resource | Descripción |
|----------|-------------|
| `scoreboard` | Marcadores |
| `teams` | Equipos |
| `teams/{id}/roster` | Plantel |
| `teams/{id}/injuries` | Lesionados |
| `standings` | ⚠️ Devuelve `{}` — usar `/apis/v2/` |
| `news` | Noticias |
| `summary?event={id}` | Resumen del partido |

> ⚠️ **Standings:** Usar `https://site.api.espn.com/apis/v2/sports/soccer/{league}/standings`
> También funciona con `site.web.api.espn.com/apis/v2/...`

> ⚠️ **Athlete data:** `athletes/{id}/stats` devuelve 404; `gamelog` devuelve 400 para soccer.
> Usar core API: `sports.core.api.espn.com/v2/sports/soccer/leagues/{league}/athletes/{id}`

#### Standings especiales

```bash
# EPL tabla completa
curl "https://site.api.espn.com/apis/v2/sports/soccer/eng.1/standings"
# Alternativa (respuesta idéntica)
curl "https://site.web.api.espn.com/apis/v2/sports/soccer/eng.1/standings"
# UCL group stage
curl "https://site.api.espn.com/apis/v2/sports/soccer/uefa.champions/standings"
```

#### Live match (Core API)

```bash
# Play-by-play (goles, tarjetas, subs)
curl "https://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/events/{id}/competitions/{id}/plays?limit=300"
# Situación en vivo (posesión)
curl "https://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/events/{id}/competitions/{id}/situation"
# Win probability
curl "https://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/events/{id}/competitions/{id}/probabilities"
# Cuotas
curl "https://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/events/{id}/competitions/{id}/odds"
# Goleadores / líderes
curl "https://sports.core.api.espn.com/v2/sports/soccer/leagues/eng.1/leaders"
```

#### Ejemplos

```bash
curl "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/scoreboard"
curl "https://site.api.espn.com/apis/v2/sports/soccer/eng.1/standings"
curl "https://site.api.espn.com/apis/site/v2/sports/soccer/uefa.champions/scoreboard"
curl "https://site.api.espn.com/apis/site/v2/sports/soccer/usa.1/scoreboard"
curl "https://sports.core.api.espn.com/v3/sports/soccer/eng.1/athletes?limit=100&active=true"
curl "https://site.api.espn.com/apis/site/v2/sports/soccer/eng.1/teams/359/roster"  # Arsenal
```

---

### 5.4 Baseball

**Sport slug:** `baseball`
**Ligas disponibles:**

| Abreviatura | Liga | Slug |
|-------------|------|------|
| `MLB` | Major League Baseball | `mlb` |
| `CBASE` | NCAA Baseball | `college-baseball` |
| `CSOFT` | NCAA Softball | `college-softball` |
| `WBBC` | World Baseball Classic | `world-baseball-classic` |
| `CBWS` | Caribbean Series | `caribbean-series` |
| `DOMWL` | Dominican Winter League | `dominican-winter-league` |
| `PUERT` | Puerto Rican Winter League | `puerto-rican-winter-league` |
| `VENWL` | Venezuelan Winter League | `venezuelan-winter-league` |
| `LMB` | Mexican League | `mexican-winter-league` |
| `OLYBB` | Olympics Baseball | `olympics-baseball` |

#### Site API

```
GET https://site.api.espn.com/apis/site/v2/sports/baseball/{league}/{resource}
```

| Resource | Descripción |
|----------|-------------|
| `scoreboard` | Marcadores |
| `teams/{id}/roster` | Plantel |
| `teams/{id}/injuries` | Lesionados |
| `teams/{id}/depth-charts` | Profundidad |
| `injuries` | Liga completa de lesionados |
| `transactions` | Movimientos |
| `standings` | ⚠️ Solo stub — usar `/apis/v2/` |
| `summary?event={id}` | Resumen + boxscore |

#### Athlete Data especial (MLB)

```bash
curl "https://site.web.api.espn.com/apis/common/v3/sports/baseball/mlb/athletes/{id}/stats"
curl "https://site.web.api.espn.com/apis/common/v3/sports/baseball/mlb/athletes/{id}/gamelog"
# Stats leaderboard con filtro de categoría
curl "https://site.web.api.espn.com/apis/common/v3/sports/baseball/mlb/statistics/byathlete?category=batting&sort=batting.homeRuns:desc&season=2024&seasontype=2"
```

#### Ejemplos

```bash
curl "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard"
curl "https://site.api.espn.com/apis/v2/sports/baseball/mlb/standings"
curl "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/teams/10/roster"
curl "https://cdn.espn.com/core/mlb/game?xhr=1&gameId={EVENT_ID}"
```

---

### 5.5 Hockey

**Sport slug:** `hockey`
**Ligas disponibles:**

| Abreviatura | Liga | Slug |
|-------------|------|------|
| `NHL` | National Hockey League | `nhl` |
| `NCAAH` | NCAA Men's Ice Hockey | `mens-college-hockey` |
| `CWHOC` | NCAA Women's Hockey | `womens-college-hockey` |
| `WCH` | World Cup of Hockey | `hockey-world-cup` |
| Olympics Men | Men's Ice Hockey | `olympics-mens-ice-hockey` |
| Olympics Women | Women's Ice Hockey | `olympics-womens-ice-hockey` |

> ⚠️ **NHL gamelog devuelve 404** vía `common/v3`. Stats y overview sí funcionan.

#### Ejemplos

```bash
curl "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard"
curl "https://site.api.espn.com/apis/v2/sports/hockey/nhl/standings"
curl "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/teams/28/roster"
curl "https://site.web.api.espn.com/apis/common/v3/sports/hockey/nhl/athletes/{id}/stats"
curl "https://cdn.espn.com/core/nhl/game?xhr=1&gameId={EVENT_ID}"
```

---

### 5.6 Golf

**Sport slug:** `golf`
**Ligas disponibles:**

| Abreviatura | Liga | Slug |
|-------------|------|------|
| `PGA` | PGA TOUR | `pga` |
| `LPGA` | Ladies Pro Golf Association | `lpga` |
| `LIV` | LIV Golf | `liv` |
| `EUR` | DP World Tour | `eur` |
| `SGA` | PGA TOUR Champions | `champions-tour` |
| `KORN FERRY` | Korn Ferry Tour | `ntw` |
| `TGL` | TGL | `tgl` |

> ⚠️ **Slug requerido:** El scoreboard de golf requiere slug nombrado. IDs numéricos devuelven 400.
> ⚠️ **Injuries devuelve HTTP 500** para golf — no soportado.

#### Site API

```
GET https://site.api.espn.com/apis/site/v2/sports/golf/{league}/{resource}
```

| Resource | Descripción |
|----------|-------------|
| `scoreboard` | Marcadores del torneo |
| `leaderboard?tournamentId={id}` | Leaderboard de torneo |
| `news` | Noticias |
| `summary?event={id}` | Resultados del torneo |

#### Ejemplos

```bash
curl "https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard"
curl "https://site.api.espn.com/apis/site/v2/sports/golf/lpga/scoreboard"
curl "https://site.api.espn.com/apis/site/v2/sports/golf/liv/scoreboard"
curl "https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/athletes?limit=100&active=true"
```

---

### 5.7 Motor Sports

**Sport slug:** `racing`
**Ligas disponibles:**

| Abreviatura | Liga | Slug |
|-------------|------|------|
| `F1` | Formula 1 | `f1` |
| `IRL` | IndyCar Series | `irl` |
| `NASCAR-PREMIER` | NASCAR Cup Series | `nascar-premier` |
| `NASCAR-SECONDARY` | NASCAR Xfinity Series | `nascar-secondary` |
| `NASCAR-TRUCK` | NASCAR Truck Series | `nascar-truck` |

#### Ejemplos

```bash
curl "https://site.api.espn.com/apis/site/v2/sports/racing/f1/scoreboard"
curl "https://site.api.espn.com/apis/site/v2/sports/racing/irl/scoreboard"
curl "https://site.api.espn.com/apis/site/v2/sports/racing/nascar-premier/scoreboard"
curl "https://sports.core.api.espn.com/v2/sports/racing/leagues/f1/events"
```

---

### 5.8 Tennis

**Sport slug:** `tennis`
**Ligas disponibles:**

| Abreviatura | Liga | Slug |
|-------------|------|------|
| `ATP` | ATP | `atp` |
| `WTA` | WTA | `wta` |

> ⚠️ **Slug requerido:** El scoreboard de tennis requiere slug nombrado (`atp`, `wta`). IDs numéricos devuelven 400.
> ⚠️ **Injuries devuelve HTTP 500** para tennis — no soportado.

#### Ejemplos

```bash
curl "https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard"
curl "https://site.api.espn.com/apis/site/v2/sports/tennis/wta/scoreboard"
curl "https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard?dates=20250620-20250707"
curl "https://sports.core.api.espn.com/v2/sports/tennis/leagues/atp/athletes?limit=100&active=true"
```

---

### 5.9 MMA

**Sport slug:** `mma`

ESPN rastrea más de 50 organizaciones de MMA. Usar `https://sports.core.api.espn.com/v2/sports/mma/leagues` para el listado completo.

**Principales promociones:**

| Slug | Organización |
|------|-------------|
| `ufc` | Ultimate Fighting Championship |
| `bellator` | Bellator MMA |
| `ifc` | Invicta FC (Women's) |
| `lfa` | Legacy Fighting Alliance |
| `ksw` | Konfrontacja Sztuk Walki |
| `cage-warriors` | Cage Warriors |
| `k1` | K-1 |
| `m1` | M-1 Mix-Fight Championship |

> ⚠️ **Injuries devuelve HTTP 500** para MMA — no soportado.
> ⚠️ **Standings no aplica** para MMA — usar endpoints de eventos/atletas.

#### Site API

```
GET https://site.api.espn.com/apis/site/v2/sports/mma/{league}/{resource}
```

| Resource | Descripción |
|----------|-------------|
| `scoreboard` | Resultados de eventos |
| `news` | Noticias |
| `summary?event={id}` | Resumen del evento + resultados de peleas |

#### Ejemplos

```bash
curl "https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard"
curl "https://sports.core.api.espn.com/v2/sports/mma/leagues/ufc/athletes?limit=100&active=true"
curl "https://sports.core.api.espn.com/v2/sports/mma/leagues/ufc/events"
curl "https://sports.core.api.espn.com/v2/sports/mma/leagues"  # lista todas las ligas MMA
```

---

### 5.10 Rugby Union

**Sport slug:** `rugby`

> ⚠️ **Rugby Union usa IDs numéricos como slugs** — no nombres como `six-nations`.

**Principales IDs de liga:**

| ID | Competición |
|----|-------------|
| `164205` | Rugby World Cup |
| `180659` | Six Nations |
| `267979` | Gallagher Premiership |
| `242041` | Super Rugby Pacific |
| `289262` | Major League Rugby |

Para descubrir IDs: `curl "https://sports.core.api.espn.com/v2/sports/rugby/leagues"`

#### Standings — estado

> ⚠️ **Standings tienen soporte muy limitado para Rugby Union:**
> - `/apis/site/v2/` devuelve **error 500** para todos los IDs testeados
> - `/apis/v2/` devuelve `{"children":[], "seasons":{}}` vacío
> - Usar `sports.core.api.espn.com/v2/sports/rugby/leagues/{league}/standings` solo como referencia

#### Ejemplos

```bash
curl "https://sports.core.api.espn.com/v2/sports/rugby/leagues"
curl "https://site.api.espn.com/apis/site/v2/sports/rugby/164205/scoreboard"  # World Cup
curl "https://site.api.espn.com/apis/site/v2/sports/rugby/180659/scoreboard"  # Six Nations
curl "https://site.api.espn.com/apis/site/v2/sports/rugby/267979/scoreboard"  # Premiership
curl "https://sports.core.api.espn.com/v2/sports/rugby/leagues/164205/teams"
curl "https://sports.core.api.espn.com/v2/sports/rugby/leagues/267/standings"
```

---

### 5.11 Rugby League

**Sport slug:** `rugby-league`

> ⚠️ **Rugby League usa ID numérico `3`** para todas las competiciones (NRL, Super League, etc.).

#### Ejemplos

```bash
curl "https://site.api.espn.com/apis/site/v2/sports/rugby-league/3/scoreboard"
curl "https://site.api.espn.com/apis/v2/sports/rugby-league/3/standings"
curl "https://sports.core.api.espn.com/v2/sports/rugby-league/leagues/3/teams"
curl "https://sports.core.api.espn.com/v2/sports/rugby-league/leagues/3/events"
curl "https://sports.core.api.espn.com/v2/sports/rugby-league/leagues/3/athletes?limit=50&active=true"
```

---

### 5.12 Lacrosse

**Sport slug:** `lacrosse`

| Slug | Liga |
|------|------|
| `pll` | Premier Lacrosse League |
| `nll` | National Lacrosse League |
| `mens-college-lacrosse` | NCAA Men's Lacrosse |
| `womens-college-lacrosse` | NCAA Women's Lacrosse |

#### Ejemplos

```bash
curl "https://site.api.espn.com/apis/site/v2/sports/lacrosse/pll/scoreboard"
curl "https://site.api.espn.com/apis/site/v2/sports/lacrosse/nll/scoreboard"
curl "https://sports.core.api.espn.com/v2/sports/lacrosse/leagues/pll/teams"
```

---

### 5.13 Cricket

**Sport slug:** `cricket`

> ⚠️ **Scoreboard via site API devuelve 404** en todos los dominios y rutas testeadas.
> Para obtener partidos usar el core API.

**Slugs de liga conocidos:** `icc.t20`, `ipl`, y otros — usar `https://sports.core.api.espn.com/v2/sports/cricket/leagues` para descubrir.

#### Ejemplos

```bash
# Scoreboard — NO funciona via site API; usar core API:
curl "https://sports.core.api.espn.com/v2/sports/cricket/leagues/icc.t20/events"
curl "https://sports.core.api.espn.com/v2/sports/cricket/leagues/ipl/events"
curl "https://sports.core.api.espn.com/v2/sports/cricket/leagues"
# Teams sí funciona en site API:
curl "https://sports.core.api.espn.com/v2/sports/cricket/leagues/icc.t20/teams"
```

---

### 5.14 Volleyball

**Sport slug:** `volleyball`

| Slug | Liga |
|------|------|
| `mens-college-volleyball` | NCAA Men's Volleyball |
| `womens-college-volleyball` | NCAA Women's Volleyball |
| `fivb.m` | FIVB Men (uso en site API) |
| `fivb.w` | FIVB Women (uso en site API) |

#### Ejemplos

```bash
curl "https://site.api.espn.com/apis/site/v2/sports/volleyball/fivb.w/scoreboard"
curl "https://site.api.espn.com/apis/site/v2/sports/volleyball/fivb.m/scoreboard"
curl "https://sports.core.api.espn.com/v2/sports/volleyball/leagues"
```

---

### 5.15 Water Polo

**Sport slug:** `water-polo`

| Slug | Liga |
|------|------|
| `mens-college-water-polo` | NCAA Men's Water Polo |
| `womens-college-water-polo` | NCAA Women's Water Polo |
| `fina.m` | FINA Men (uso en site API) |
| `fina.w` | FINA Women (uso en site API) |

#### Ejemplos

```bash
curl "https://site.api.espn.com/apis/site/v2/sports/water-polo/fina.m/scoreboard"
curl "https://site.api.espn.com/apis/site/v2/sports/water-polo/fina.w/scoreboard"
curl "https://sports.core.api.espn.com/v2/sports/water-polo/leagues"
```

---

### 5.16 Field Hockey

**Sport slug:** `field-hockey`

| Slug | Liga |
|------|------|
| `womens-college-field-hockey` | NCAA Women's Field Hockey |
| `fih.m` | FIH Men (uso en site API) |
| `fih.w` | FIH Women (uso en site API) |

#### Ejemplos

```bash
curl "https://site.api.espn.com/apis/site/v2/sports/field-hockey/fih.w/scoreboard"
curl "https://site.api.espn.com/apis/site/v2/sports/field-hockey/fih.m/scoreboard"
curl "https://sports.core.api.espn.com/v2/sports/field-hockey/leagues"
```

---

### 5.17 Australian Rules Football

**Sport slug:** `australian-football`

| Slug | Liga |
|------|------|
| `afl` | AFL (Australian Football League) |

> ⚠️ **Standings:** `/apis/site/v2/` devuelve redirect stub. Usar `/apis/v2/`.

#### Ejemplos

```bash
curl "https://site.api.espn.com/apis/site/v2/sports/australian-football/afl/scoreboard"
curl "https://site.api.espn.com/apis/v2/sports/australian-football/afl/standings"
curl "https://site.web.api.espn.com/apis/v2/sports/australian-football/afl/standings"
curl "https://sports.core.api.espn.com/v2/sports/australian-football/leagues/afl/teams?limit=25"
curl "https://sports.core.api.espn.com/v2/sports/australian-football/leagues/afl/events"
```

---

### 5.18 College Sports

#### Ligas soportadas

| Deporte | Liga | Slug |
|---------|------|------|
| Football | NCAA Football | `college-football` |
| Men's Basketball | NCAA Men's Basketball | `mens-college-basketball` |
| Women's Basketball | NCAA Women's Basketball | `womens-college-basketball` |
| Baseball | NCAA Baseball | `college-baseball` |

#### Compatibilidad de endpoints

| Resource | NCAAF | NCAAM | NCAAW | NCAAB |
|----------|-------|-------|-------|-------|
| `scoreboard` | ✅ | ✅ | ✅ | ✅ |
| `teams` | ✅ | ✅ | ✅ | ✅ |
| `teams/{id}/roster` | ✅ | ✅ | ✅ | ✅ |
| `teams/{id}/schedule` | ✅ | ✅ | ✅ | ✅ |
| `news` | ✅ | ✅ | ✅ | ✅ |
| `rankings` | ✅ | ✅ | — | — |
| `summary?event={id}` | ✅ | ✅ | ✅ | ✅ |
| `groups` | ✅ | ✅ | ✅ | ✅ |

#### Conference IDs (College Football)

```bash
# groups= para filtrar por conferencia en scoreboard
# 80 = FBS (todos los principales)
# 4  = ACC
# 8  = Big 12
# 9  = Pac-12
# 12 = SEC
# 21 = Big Ten

curl "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?groups=80"
curl "https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard?week=1&seasontype=2&groups=80"
```

#### Rankings (College)

```bash
curl "https://site.api.espn.com/apis/site/v2/sports/football/college-football/rankings"
curl "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/rankings"
```

#### NCAA Tournament Bracket

```bash
curl "https://sports.core.api.espn.com/v2/tournament/22/seasons/2025/bracketology"
# 22 = NCAA Men's, 23 = NCAA Women's
```

---

## 6. Schemas de Respuesta

### Scoreboard (`/apis/site/v2/sports/{sport}/{league}/scoreboard`)

```json
{
  "leagues": [
    {
      "id": "46",
      "name": "National Basketball Association",
      "abbreviation": "NBA",
      "slug": "nba",
      "season": { "year": 2025, "type": 2, "slug": "regular-season" },
      "logos": [{ "href": "https://...", "width": 500, "height": 500 }]
    }
  ],
  "events": [
    {
      "id": "401765432",
      "uid": "s:40~l:46~e:401765432",
      "date": "2025-03-15T00:00Z",
      "name": "Boston Celtics at Golden State Warriors",
      "shortName": "BOS @ GSW",
      "season": { "year": 2025, "type": 2, "slug": "regular-season" },
      "week": { "number": 18 },
      "status": {
        "clock": "0.0",
        "displayClock": "0.0",
        "period": 4,
        "type": {
          "id": "3",
          "name": "STATUS_FINAL",
          "state": "post",
          "completed": true,
          "description": "Final",
          "detail": "Final",
          "shortDetail": "Final"
        }
      },
      "competitions": [
        {
          "id": "401765432",
          "attendance": 18064,
          "venue": {
            "id": "1234",
            "fullName": "Chase Center",
            "address": { "city": "San Francisco", "state": "CA" },
            "capacity": 18064,
            "indoor": true
          },
          "broadcasts": [
            {
              "market": { "id": "1", "type": "National" },
              "media": { "shortName": "ESPN" },
              "type": { "id": "1", "shortName": "TV" }
            }
          ],
          "competitors": [
            {
              "id": "17",
              "homeAway": "home",
              "team": {
                "id": "9",
                "abbreviation": "GSW",
                "displayName": "Golden State Warriors",
                "color": "006BB6",
                "alternateColor": "FDB927",
                "logo": "https://..."
              },
              "score": "121",
              "winner": true,
              "records": [{ "name": "overall", "summary": "42-24" }],
              "leaders": [
                {
                  "name": "points",
                  "displayName": "Points Leader",
                  "leaders": [
                    {
                      "displayValue": "32",
                      "athlete": { "id": "3136776", "displayName": "Stephen Curry" }
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

### Teams (`/apis/site/v2/sports/{sport}/{league}/teams`)

```json
{
  "sports": [
    {
      "id": "46",
      "name": "Basketball",
      "leagues": [
        {
          "id": "46",
          "name": "NBA",
          "teams": [
            {
              "team": {
                "id": "9",
                "uid": "s:40~l:46~t:9",
                "slug": "golden-state-warriors",
                "abbreviation": "GSW",
                "displayName": "Golden State Warriors",
                "shortDisplayName": "Warriors",
                "location": "Golden State",
                "color": "006BB6",
                "alternateColor": "FDB927",
                "isActive": true,
                "logos": [{ "href": "https://...", "width": 500, "height": 500, "rel": ["full", "default"] }],
                "links": [{ "rel": ["clubhouse"], "href": "https://www.espn.com/nba/team/_/id/9/..." }]
              }
            }
          ]
        }
      ]
    }
  ],
  "count": 30,
  "pageIndex": 1,
  "pageSize": 100
}
```

### Team Roster (`/apis/site/v2/sports/{sport}/{league}/teams/{id}/roster`)

```json
{
  "team": { "id": "9", "abbreviation": "GSW", "displayName": "Golden State Warriors" },
  "athletes": [
    {
      "position": "G",
      "items": [
        {
          "id": "3136776",
          "firstName": "Stephen",
          "lastName": "Curry",
          "displayName": "Stephen Curry",
          "jersey": "30",
          "position": { "id": "2", "name": "Shooting Guard", "abbreviation": "SG" },
          "age": 36,
          "height": 74,
          "weight": 185,
          "birthDate": "1988-03-14",
          "experience": { "years": 15 },
          "status": { "id": "1", "name": "Active", "type": "active" },
          "headshot": { "href": "https://..." }
        }
      ]
    }
  ],
  "coach": [{ "id": "6010", "firstName": "Steve", "lastName": "Kerr" }]
}
```

### Team Injuries (`/apis/site/v2/sports/{sport}/{league}/teams/{id}/injuries`)

```json
{
  "team": { "id": "9", "abbreviation": "GSW" },
  "injuries": [
    {
      "id": "12345",
      "athlete": {
        "id": "3136776",
        "displayName": "Stephen Curry",
        "position": { "abbreviation": "SG" }
      },
      "type": { "id": "1", "name": "knee", "description": "Knee", "abbreviation": "KNEE" },
      "location": "left knee",
      "detail": "Left knee soreness",
      "side": "left",
      "fantasy": { "status": "doubtful", "injuryType": "KNEE" },
      "status": "Doubtful",
      "date": "2025-03-10T00:00Z"
    }
  ]
}
```

### Game Summary (`/apis/site/v2/sports/{sport}/{league}/summary?event={id}`)

```json
{
  "boxscore": {
    "teams": [
      {
        "team": { "id": "9", "displayName": "Golden State Warriors" },
        "statistics": [
          { "name": "assists", "displayValue": "28", "label": "Assists" },
          { "name": "rebounds", "displayValue": "41", "label": "Rebounds" },
          { "name": "fieldGoalPct", "displayValue": "48.5", "label": "FG%" }
        ],
        "players": [
          {
            "position": { "displayName": "Guard" },
            "statistics": [
              {
                "names": ["MIN", "FG", "3PT", "FT", "OREB", "DREB", "REB", "AST", "STL", "BLK", "TO", "PF", "+/-", "PTS"],
                "athletes": [
                  {
                    "athlete": { "id": "3136776", "displayName": "Stephen Curry" },
                    "didNotPlay": false,
                    "stats": ["36", "12-24", "4-10", "4-4", "0", "5", "5", "7", "1", "0", "2", "2", "+8", "32"]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  },
  "plays": [
    {
      "id": "4017654340001",
      "sequenceNumber": "1",
      "text": "S. Curry makes 2-pt jump shot from 14 ft",
      "clock": { "displayValue": "11:42" },
      "period": { "number": 1 },
      "team": { "id": "9" },
      "scoreValue": 2,
      "scoringPlay": true
    }
  ],
  "leaders": [
    {
      "name": "points",
      "displayName": "Points Leaders",
      "leaders": [
        { "displayValue": "32", "team": { "id": "9" }, "athlete": { "id": "3136776", "displayName": "Stephen Curry" } }
      ]
    }
  ],
  "broadcasts": [{ "market": "national", "names": ["ESPN"] }],
  "predictor": {
    "header": "ESPN BPI Win Probability",
    "homeTeam": { "team": { "id": "9" }, "gameProjection": "63.4", "teamChanceLoss": "36.6" }
  }
}
```

### Standings (`/apis/v2/sports/{sport}/{league}/standings`)

```json
{
  "uid": "s:40~l:46",
  "season": { "year": 2025, "displayName": "2024-25" },
  "fullViewLink": { "href": "https://www.espn.com/nba/standings" },
  "children": [
    {
      "name": "Eastern Conference",
      "abbreviation": "EAST",
      "standings": {
        "entries": [
          {
            "team": {
              "id": "2",
              "displayName": "Boston Celtics",
              "abbreviation": "BOS",
              "logo": "https://..."
            },
            "note": { "color": "03A653", "description": "Clinched Playoffs" },
            "stats": [
              { "name": "wins", "displayName": "Wins", "displayValue": "52" },
              { "name": "losses", "displayName": "Losses", "displayValue": "14" },
              { "name": "winPercent", "displayName": "PCT", "displayValue": ".788" },
              { "name": "gamesBehind", "displayName": "GB", "displayValue": "-" },
              { "name": "streak", "displayName": "Strk", "displayValue": "W3" }
            ]
          }
        ]
      }
    }
  ]
}
```

### Athlete (Core API v2)

`GET https://sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}/athletes/{id}`

```json
{
  "id": "3136776",
  "uid": "s:40~l:46~a:3136776",
  "firstName": "Stephen",
  "lastName": "Curry",
  "displayName": "Stephen Curry",
  "weight": 185,
  "height": 74,
  "age": 36,
  "dateOfBirth": "1988-03-14T00:00Z",
  "birthPlace": { "city": "Charlotte", "state": "NC", "country": "USA" },
  "jersey": "30",
  "active": true,
  "position": { "id": "2", "name": "Shooting Guard", "abbreviation": "SG" },
  "team": { "$ref": "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/teams/9" },
  "experience": { "years": 15 },
  "college": { "name": "Davidson", "mascot": "Bulldogs" },
  "draft": { "year": 2009, "round": 1, "selection": 7 },
  "headshot": { "href": "https://a.espncdn.com/...", "alt": "Stephen Curry" },
  "statistics": { "$ref": "https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba/athletes/3136776/statistics" }
}
```

### Betting Odds (Core API v2)

`GET https://sports.core.api.espn.com/v2/sports/{sport}/leagues/{league}/events/{id}/competitions/{id}/odds`

```json
{
  "count": 3,
  "items": [
    {
      "provider": { "id": "41", "name": "DraftKings", "priority": 1 },
      "details": "-3.5",
      "overUnder": 222.5,
      "spread": -3.5,
      "overOdds": -110,
      "underOdds": -110,
      "awayTeamOdds": { "favorite": false, "underdog": true, "moneyLine": 140, "spreadOdds": -110 },
      "homeTeamOdds": { "favorite": true, "underdog": false, "moneyLine": -165, "spreadOdds": -110 },
      "open": {
        "over": { "value": 220.0 },
        "under": { "value": 220.0 },
        "spread": { "home": { "line": -4.5 } }
      }
    }
  ]
}
```

### Win Probabilities (Core API v2)

`GET .../events/{id}/competitions/{id}/probabilities`

```json
{
  "count": 1,
  "items": [
    {
      "homeWinPercentage": 0.634,
      "awayWinPercentage": 0.366,
      "tiePercentage": 0.0,
      "lastModified": "2025-03-15T02:14:00Z",
      "play": { "$ref": "https://sports.core.api.espn.com/v2/..." }
    }
  ]
}
```

### League-wide Injuries (`/apis/site/v2/sports/{sport}/{league}/injuries`)

> Funciona para NBA, NFL, NHL, MLB, Soccer. Devuelve HTTP 500 para MMA, Tennis, Golf.

```json
{
  "timestamp": "2025-03-23T12:00:00Z",
  "status": "success",
  "season": { "year": 2025, "type": 2 },
  "injuries": [
    {
      "team": { "id": "9", "displayName": "Golden State Warriors", "abbreviation": "GSW" },
      "injuries": [
        {
          "id": "12345",
          "athlete": { "id": "3136776", "displayName": "Stephen Curry", "position": { "abbreviation": "PG" } },
          "type": { "name": "knee" },
          "status": "Day-To-Day",
          "date": "2025-03-20T00:00Z"
        }
      ]
    }
  ]
}
```

### Transactions (`/apis/site/v2/sports/{sport}/{league}/transactions`)

```json
{
  "timestamp": "2025-03-23T12:00:00Z",
  "status": "success",
  "season": { "year": 2025, "type": 2 },
  "count": 42,
  "transactions": [
    {
      "id": "99001",
      "date": "2025-03-20T00:00Z",
      "description": "GSW signed F Joe Smith to a 10-day contract",
      "team": { "id": "9", "displayName": "Golden State Warriors" },
      "type": { "id": "1", "description": "Contract Signing" }
    }
  ]
}
```

### Groups / Conferences (`/apis/site/v2/sports/{sport}/{league}/groups`)

```json
{
  "status": "success",
  "groups": [
    {
      "id": "5",
      "name": "Eastern Conference",
      "abbreviation": "East",
      "children": [
        { "id": "1", "name": "Atlantic Division", "abbreviation": "Atlantic" }
      ]
    }
  ]
}
```

### Rankings (`/apis/site/v2/sports/{sport}/{league}/rankings`)

> Funciona para `college-football` y `mens-college-basketball`.

```json
{
  "rankings": [
    {
      "name": "AP Top 25",
      "shortName": "AP Poll",
      "type": "ap",
      "occurrence": { "number": 13, "displayValue": "Week 13" },
      "ranks": [
        {
          "current": 1,
          "previous": 1,
          "points": 1575,
          "firstPlaceVotes": 63,
          "team": {
            "id": "333",
            "displayName": "Alabama Crimson Tide",
            "abbreviation": "ALA",
            "record": { "summary": "11-0" }
          }
        }
      ]
    }
  ]
}
```

### Statistics by Athlete (`statistics/byathlete`)

> Funciona para NBA, NFL, MLB, NHL.

```bash
curl "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byathlete"
curl "https://site.web.api.espn.com/apis/common/v3/sports/baseball/mlb/statistics/byathlete?category=batting&sort=batting.homeRuns:desc&season=2024"
```

```json
{
  "pagination": { "count": 500, "limit": 50, "page": 1, "pages": 10 },
  "league": { "id": "46", "name": "NBA" },
  "currentSeason": { "year": 2025, "type": 2 },
  "athletes": [
    {
      "athlete": {
        "id": "3136776",
        "displayName": "Stephen Curry",
        "team": { "id": "9", "abbreviation": "GSW" },
        "position": { "abbreviation": "PG" }
      },
      "statistics": [
        { "name": "avgPoints", "displayValue": "26.4", "rank": 5 }
      ]
    }
  ]
}
```

---

## 7. Now API — Noticias en tiempo real

`GET https://now.core.api.espn.com/v1/sports/news`

**Parámetros de filtro:**

| Parámetro | Ejemplo | Descripción |
|-----------|---------|-------------|
| `sport` | `?sport=football` | Filtrar por deporte |
| `league` | `?league=nfl` | Filtrar por liga |
| `team` | `?team=9` | Filtrar por equipo |
| `limit` | `?limit=50` | Número de resultados |
| `offset` | `?offset=20` | Para paginación |

```bash
curl "https://now.core.api.espn.com/v1/sports/news?sport=football"
curl "https://now.core.api.espn.com/v1/sports/news?league=nfl&limit=20"
curl "https://now.core.api.espn.com/v1/sports/news?sport=basketball&league=nba&team=9"
```

**Schema de respuesta:**

```json
{
  "resultsCount": 1000,
  "resultsLimit": 20,
  "resultsOffset": 0,
  "feed": [
    {
      "dataSourceIdentifier": "espn_wire_12345",
      "description": "Stephen Curry scores 32 points...",
      "nowId": "11-12345",
      "premium": false,
      "published": "2025-03-15T02:00:00Z",
      "lastModified": "2025-03-15T02:30:00Z",
      "type": "HeadlineNews",
      "headline": "Curry scores 32, Warriors top Celtics",
      "links": {
        "web": { "href": "https://www.espn.com/nba/story/_/id/12345" },
        "api": { "href": "https://api.espn.com/v1/sports/news/12345" }
      },
      "images": [
        { "id": 98765, "url": "https://a.espncdn.com/photo/...", "width": 576, "height": 324 }
      ],
      "categories": [
        { "type": "league", "id": 46, "description": "NBA" },
        { "type": "team", "id": 9, "description": "Golden State Warriors" },
        { "type": "athlete", "id": 3136776, "description": "Stephen Curry" }
      ]
    }
  ]
}
```

---

## 8. CDN Game Package

`GET https://cdn.espn.com/core/{sport}/{endpoint}?xhr=1`

> Devuelve un objeto `gamepackageJSON` con todos los datos del partido. **Requiere `?xhr=1`.**

```bash
# NFL
curl "https://cdn.espn.com/core/nfl/game?xhr=1&gameId={EVENT_ID}"
curl "https://cdn.espn.com/core/nfl/boxscore?xhr=1&gameId={EVENT_ID}"
curl "https://cdn.espn.com/core/nfl/playbyplay?xhr=1&gameId={EVENT_ID}"
curl "https://cdn.espn.com/core/nfl/matchup?xhr=1&gameId={EVENT_ID}"
curl "https://cdn.espn.com/core/nfl/scoreboard?xhr=1"

# NBA
curl "https://cdn.espn.com/core/nba/game?xhr=1&gameId={EVENT_ID}"
curl "https://cdn.espn.com/core/nba/scoreboard?xhr=1"

# MLB
curl "https://cdn.espn.com/core/mlb/game?xhr=1&gameId={EVENT_ID}"

# NHL
curl "https://cdn.espn.com/core/nhl/game?xhr=1&gameId={EVENT_ID}"

# College Football
curl "https://cdn.espn.com/core/college-football/game?xhr=1&gameId={EVENT_ID}"

# Soccer (usa slug de liga)
curl "https://cdn.espn.com/core/soccer/scoreboard?xhr=1&league=eng.1"
```

**Estructura de respuesta:**

```json
{
  "gameId": "401671793",
  "gamepackageJSON": {
    "header": {
      "id": "401671793",
      "season": { "year": 2025, "type": 3 },
      "competitions": [
        {
          "id": "401671793",
          "competitors": [
            { "id": "12", "homeAway": "home", "score": "27", "winner": true },
            { "id": "25", "homeAway": "away", "score": "24", "winner": false }
          ],
          "status": { "type": { "name": "STATUS_FINAL", "state": "post", "completed": true } }
        }
      ]
    },
    "boxscore": { "teams": [], "players": [] },
    "drives": {
      "previous": [
        {
          "id": "4016717931",
          "description": "10 plays, 75 yards, 4:32",
          "team": { "id": "12" },
          "plays": [],
          "result": "Touchdown",
          "yards": 75
        }
      ]
    },
    "plays": [{ "id": "...", "text": "...", "scoringPlay": true }],
    "winprobability": [{ "homeWinPercentage": 0.72, "playId": "..." }],
    "news": { "articles": [] },
    "standings": {}
  }
}
```

---

## 9. Athlete Data — common/v3

**Base:** `https://site.web.api.espn.com/apis/common/v3/sports/{sport}/{league}/athletes/{id}/`

### Overview

```bash
curl "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/{id}/overview"
```

```json
{
  "statistics": {
    "labels": ["GP", "PTS", "REB", "AST"],
    "names": ["gamesPlayed", "avgPoints", "avgRebounds", "avgAssists"],
    "values": [56.0, 26.4, 4.5, 6.1],
    "displayValues": ["56", "26.4", "4.5", "6.1"]
  },
  "news": { "articles": [{ "headline": "...", "published": "2025-03-14T21:00Z" }] },
  "nextGame": { "id": "401765999", "date": "2025-03-16T17:30Z", "name": "..." },
  "gameLog": { "events": [{ "id": "401765000", "gameResult": "W", "stats": ["34", "5", "7"] }] },
  "rotowire": { "injury": null, "news": "Curry is healthy and expected to play Friday." }
}
```

### Stats

```bash
curl "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/{id}/stats"
```

```json
{
  "filters": [
    {
      "displayName": "Season Type",
      "name": "seasontype",
      "value": "2",
      "options": [
        { "value": "2", "displayValue": "Regular Season" },
        { "value": "3", "displayValue": "Playoffs" }
      ]
    }
  ],
  "teams": [{ "id": "9", "displayName": "Golden State Warriors" }],
  "categories": [
    {
      "name": "general",
      "displayName": "General",
      "labels": ["GP", "GS", "MIN", "PTS", "REB", "AST", "STL", "BLK", "TO", "FG%", "3P%", "FT%"],
      "totals": ["56", "56", "34.2", "26.4", "4.5", "6.1", "0.9", "0.4", "3.1", ".502", ".408", ".924"]
    }
  ]
}
```

### Gamelog

```bash
curl "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/{id}/gamelog"
```

```json
{
  "filters": [{ "displayName": "Season", "name": "season", "value": "2025" }],
  "labels": ["DATE", "OPP", "RESULT", "MIN", "FG", "3PT", "FT", "REB", "AST", "STL", "BLK", "PTS"],
  "events": [
    {
      "id": "401765000",
      "date": "2025-03-14T00:00Z",
      "opponent": { "id": "2", "displayName": "Boston Celtics", "abbreviation": "BOS" },
      "gameResult": "W",
      "stats": ["36", "12-24", "4-10", "4-4", "5", "7", "1", "0", "32"]
    }
  ]
}
```

### Splits

```bash
curl "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/{id}/splits"
```

```json
{
  "displayName": "Stephen Curry",
  "categories": [
    { "name": "home", "displayName": "Home", "labels": ["GP", "PTS", "REB", "AST"], "totals": ["28", "27.1", "4.8", "6.4"] },
    { "name": "away", "displayName": "Away", "labels": ["GP", "PTS", "REB", "AST"], "totals": ["28", "25.7", "4.2", "5.8"] }
  ]
}
```

### Compatibilidad por deporte

| Endpoint | NFL | NBA | MLB | NHL | Soccer | NCAAM/NCAAW | WNBA |
|----------|-----|-----|-----|-----|--------|-------------|------|
| `overview` | ✅ | ✅ | ✅ | ✅ | ⚠️ mínimo | ✅ | ✅ |
| `stats` | ✅ | ✅ | ✅ | ✅ | ❌ 404 | ✅ | ✅ |
| `gamelog` | ✅ | ✅ | ✅ | ❌ 404 | ❌ 400 | ✅ | ✅ |
| `splits` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| `statistics/byathlete` | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |

---

*Documentación consolidada desde `docs/` — última verificación de dominios: 2026-03-26*
