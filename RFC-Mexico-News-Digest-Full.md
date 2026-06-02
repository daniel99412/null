
# RFC: Mexico News Digest para null

Version: 1.0
Status: Proposed

---

# Objetivo

Crear un flujo especializado para consultas de noticias generales de México que sea independiente del buscador genérico (`webSearch`).

El sistema debe:

- Obtener noticias relevantes de México.
- Obtener noticias internacionales con impacto directo en México.
- Agrupar historias repetidas cubiertas por múltiples medios.
- Calcular relevancia.
- Estimar inclinación política de cobertura.
- Reportar polarización.
- Generar resúmenes neutrales.
- Ser explicable.
- Ser barato de ejecutar.
- Funcionar principalmente con RSS/API.

---

# No Objetivos

No reemplazar webSearch.

No realizar fact-checking absoluto.

No determinar verdad.

No generar opiniones políticas.

No depender de scraping HTML para funcionar.

No depender de un LLM para clasificar todo.

---

# Arquitectura General

Usuario
↓
Intent Detection
↓
mexicoNewsDigest
↓
News Sources DB
↓
RSS/API Fetch
↓
Normalization
↓
Story Clustering
↓
Relevance Ranking
↓
Bias Analysis
↓
Summary Generation
↓
Top 10 Stories

---

# Separación de Flujos

## webSearch

Debe conservar comportamiento actual.

Características:

- DuckDuckGo
- pocas fuentes
- hasta 3 artículos
- sin clustering
- sin ranking político
- sin tarjetas especiales

## mexicoNewsDigest

Activado por consultas como:

- dame las noticias
- últimas noticias
- noticias de México
- qué pasó hoy
- resumen de noticias
- noticias importantes para México

---

# Fuentes

Las fuentes deben almacenarse en SQLite.

## Tipos

- agency
- mexican-wire
- national-news
- investigative
- business-news
- international-news
- fact-checking

## Scopes

```ts
type NewsScope =
  | "mexico"
  | "states"
  | "politics"
  | "security"
  | "economy"
  | "business"
  | "services"
  | "latin-america"
  | "world"
  | "mexico-impact"
  | "fact-checking";
```

---

# Escala Política

```txt
1 = izquierda dura
2 = izquierda fuerte
3 = izquierda moderada
4 = centro izquierda
5 = centro
6 = centro derecha
7 = derecha moderada
8 = derecha
9 = derecha fuerte
10 = derecha dura
```

Importante:

La escala NO representa:

- verdad
- calidad
- confiabilidad

Únicamente inclinación estimada.

---

# SQLite

## news_sources

```sql
CREATE TABLE IF NOT EXISTS news_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  feed_url TEXT,
  bias_base REAL NOT NULL,
  reliability REAL NOT NULL,
  type TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  anchor INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_checked_at TEXT,
  last_error TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0,
  unavailable_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

## news_articles_cache

```sql
CREATE TABLE IF NOT EXISTS news_articles_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  snippet TEXT,
  published_at TEXT,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  normalized_title TEXT,
  content_hash TEXT,
  category TEXT,
  raw_json TEXT,
  UNIQUE(source_id, url)
);
```

## news_digest_cache

```sql
CREATE TABLE IF NOT EXISTS news_digest_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  query TEXT NOT NULL,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL,
  UNIQUE(scope, query)
);
```

---

# Catálogo Inicial de Fuentes

Anclas:

- Reuters México
- AP México
- EFE México
- AFP

Cobertura nacional:

- Quadratín México
- OEM Informex

Centro:

- Animal Político
- El Universal
- Milenio
- Expansión Política
- La Silla Rota
- Excélsior

Economía:

- El Financiero
- El Economista
- Forbes México

Izquierda:

- La Jornada
- SinEmbargo
- Proceso

Derecha:

- Reforma
- Latinus

Internacionales:

- BBC Mundo
- CNN en Español
- El País México

---

# Obtención de Noticias

Orden:

1. feed_url
2. API oficial
3. RSS autodiscovery

No usar scraping HTML.

Si una fuente falla:

- registrar error
- incrementar contador
- continuar

Nunca romper el digest.

---

# Normalización

Todos los artículos deben convertirse a:

```ts
interface NewsArticle {
  source: string;
  title: string;
  url: string;
  snippet: string;
  publishedAt: string;
  category?: string;
}
```

---

# Clustering

Objetivo:

Agrupar artículos que hablan de la misma historia.

Una historia NO es un artículo.

Una historia puede tener:

- Reuters
- Reforma
- La Jornada
- Animal Político

cubriendo el mismo evento.

## Heurísticas

Comparar:

- título
- nombres propios
- lugares
- fechas
- entidades
- categoría

Evitar usar embeddings pesados en v1.

---

# Ranking

Cada historia recibe:

```ts
relevanceScore
```

Factores:

- cobertura
- recencia
- impacto nacional
- confiabilidad promedio
- categoría

Boost:

- política
- seguridad
- economía
- servicios públicos
- Banxico
- Pemex
- CFE
- T-MEC
- remesas
- migración
- aranceles

---

# México Impact

Las noticias internacionales pueden entrar al top si afectan a México.

Ejemplos:

- aranceles de EUA
- Trump
- T-MEC
- remesas
- migración
- nearshoring
- petróleo
- dólar
- Mundial 2026

---

# Bias Analysis

Separar:

1. inclinación de cobertura
2. inclinación de nota específica
3. polarización

Nunca mezclarlos.

---

# Source Prior

```ts
sourcePrior = weightedAverage(
  biasBase,
  reliability
);
```

---

# Article Bias

Calculado por LLM local.

Restricciones:

- peso bajo
- opcional
- puede ser null

Si hay poca evidencia:

```ts
articleBias = null;
```

---

# Fórmula

```ts
const articleWeight =
  llmConfidence >= 0.75
    ? 0.20
    : 0.10;

const contextWeight =
  sourcesCount >= 5
    ? 0.15
    : 0.05;

const sourceWeight =
  1 - articleWeight - contextWeight;
```

```ts
finalBias =
  sourcePrior * sourceWeight +
  articleBias * articleWeight +
  coverageContextBias * contextWeight;
```

Fallback:

```ts
finalBias =
  sourcePrior * 0.85 +
  coverageContextBias * 0.15;
```

---

# Polarización

Calcular desviación estándar.

```ts
polarizationScore =
  standardDeviation(
    sources.map(s => s.biasBase)
  );
```

Mapeo:

```txt
0.0 - 0.8 = baja
0.8 - 1.6 = media
> 1.6 = alta
```

Si existe una sola fuente:

```txt
no estimable
```

---

# Historias de Fuente Única

Permitidas.

Pero:

- menor confianza
- sin polarización
- menor ranking

---

# Resumen Neutral

Generar resumen corto.

Reglas:

- sin adjetivos cargados
- sin opinión
- solo hechos comunes
- priorizar consenso factual

---

# Output

```txt
┌─ Política · Reuters · Reforma · La Jornada
│
│ Titular:
│ México anuncia...
│
│ Resumen:
│ ...
│
│ Cobertura: 8 medios
│ Recencia: hace 45 minutos
│
│ Inclinación de cobertura:
│ centro (5.2)
│
│ Inclinación de nota:
│ centro izquierda
│
│ Confianza: alta
│ Polarización: media
└
```

---

# Cache

## Artículos

TTL recomendado:

6 horas

## Digest

TTL recomendado:

15 minutos

---

# Errores

Registrar:

- feed inválido
- timeout
- parse error
- rss vacío
- rate limit

Nunca abortar digest completo.

---

# Tests

## Unit

- rss parser
- clustering
- ranking
- bias
- polarización
- cache
- autodiscovery

## Integration

- dame las noticias
- últimas noticias
- noticias importantes para México
- noticias del mundo que afectan a México

---

# Criterios de Aceptación

- Digest funcional.
- Top 10 historias.
- Agrupación correcta.
- Fuentes fallidas no rompen ejecución.
- Sesgo explicado.
- Polarización explicada.
- Noticias internacionales relevantes para México incluidas.
- Sin scraping HTML obligatorio.
