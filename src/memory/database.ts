import Database from 'better-sqlite3'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DATA_DIR = path.join(os.homedir(), '.null-cli')
const DB_PATH = path.join(DATA_DIR, 'null.db')

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }

  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // ── Core conversation tables ────────────────────────────────────────────────

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS session_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL UNIQUE,
      summary TEXT NOT NULL,
      message_count INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_session_summaries_session_id ON session_summaries(session_id);

    -- ── Cache tables ─────────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS search_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query_key TEXT NOT NULL UNIQUE,
      result TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      ttl_seconds INTEGER NOT NULL DEFAULT 300
    );

    -- ── Memory system ─────────────────────────────────────────────────────────

    -- Central memory store. One row per unique (type, value).
    CREATE TABLE IF NOT EXISTS memories (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      type        TEXT NOT NULL,   -- preference|tech_stack|occupation|project|goal|behavior|dislike|relationship|location|alias_self
      value       TEXT NOT NULL,   -- canonical, normalized (lowercase, trimmed)
      raw_value   TEXT,            -- how the user originally said it
      confidence  REAL NOT NULL DEFAULT 0.7,
      source      TEXT NOT NULL DEFAULT 'extracted' CHECK (source IN ('explicit', 'extracted', 'inferred')),
      expires_at  TEXT,            -- NULL = never expires
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(type, value)
    );

    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);

    -- Mutable score — updated on every mention, decayed over time.
    -- Kept separate from memories so score updates don't touch the main row's updated_at.
    CREATE TABLE IF NOT EXISTS memory_scores (
      memory_id    INTEGER PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
      score        REAL NOT NULL DEFAULT 0.7,
      recurrence   INTEGER NOT NULL DEFAULT 1,
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Alias/synonym table for deduplication and normalization.
    -- alias → (canonical, type): "zorros" → "atlas", type="preference"
    CREATE TABLE IF NOT EXISTS memory_aliases (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      alias     TEXT NOT NULL,
      canonical TEXT NOT NULL,
      type      TEXT NOT NULL,
      UNIQUE(alias, type)
    );

    CREATE INDEX IF NOT EXISTS idx_memory_aliases_alias ON memory_aliases(alias);

    -- Directional relations between memories (phase 2 — created empty now).
    CREATE TABLE IF NOT EXISTS memory_relations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id    INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      to_id      INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      relation   TEXT NOT NULL,  -- 'part_of' | 'related_to' | 'contradicts'
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Log of every time a memory was mentioned in a session.
    CREATE TABLE IF NOT EXISTS memory_events (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id    INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      session_id   TEXT,
      mentioned_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_memory_events_memory_id ON memory_events(memory_id);

    -- Log of retrieval calls (phase 2 — created empty now).
    CREATE TABLE IF NOT EXISTS retrieval_logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      query      TEXT NOT NULL,
      memory_ids TEXT NOT NULL DEFAULT '[]',  -- JSON array of IDs
      was_useful INTEGER,                      -- 1/0/NULL
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── Mexico News Digest tables ─────────────────────────────────────────────

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

    CREATE INDEX IF NOT EXISTS idx_news_articles_source ON news_articles_cache(source_id);
    CREATE INDEX IF NOT EXISTS idx_news_articles_published ON news_articles_cache(published_at);

    CREATE TABLE IF NOT EXISTS news_digest_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      query TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      UNIQUE(scope, query)
    );

    -- User-configurable news topics
    CREATE TABLE IF NOT EXISTS news_topics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      keywords TEXT NOT NULL DEFAULT '[]',
      scope_tags TEXT NOT NULL DEFAULT '[]',
      source_ids TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- ── Document index tables ─────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS doc_index (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      filename TEXT NOT NULL,
      extension TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime REAL NOT NULL,
      checksum TEXT NOT NULL,
      indexed_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
    );

    CREATE TABLE IF NOT EXISTS doc_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_id TEXT NOT NULL REFERENCES doc_index(id) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      token_count INTEGER NOT NULL,
      embedding BLOB,
      created_at INTEGER NOT NULL,
      UNIQUE(doc_id, chunk_index)
    );

    CREATE INDEX IF NOT EXISTS idx_doc_chunks_doc_id ON doc_chunks(doc_id);
  `)

  // ── Schema migrations ──────────────────────────────────────────────────────

  const sessionCols = db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]
  if (!sessionCols.some((c) => c.name === 'status')) {
    db.exec("ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
  }

  // ── Seed memory_aliases from canonical maps ────────────────────────────────

  seedAliases(db)

  // ── Seed news sources ──────────────────────────────────────────────────────

  seedNewsSources(db)

  // ── Seed news topics ────────────────────────────────────────────────────────

  seedNewsTopics(db)

  return db
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

// ── Seed aliases ──────────────────────────────────────────────────────────────
//
// Loaded from src/seeds/aliases.json — edit the JSON to add new aliases
// without touching TypeScript source. INSERT OR IGNORE — safe on every startup.

type AliasSeedRow = { alias: string; canonical: string; type: string }

function seedAliases(database: Database.Database): void {
  const seedPath = path.resolve(__dirname, '../seeds/aliases.json')
  let rows: AliasSeedRow[] = []
  try {
    rows = JSON.parse(fs.readFileSync(seedPath, 'utf-8')) as AliasSeedRow[]
  } catch {
    // File not found or parse error — skip seeding gracefully
    return
  }
  const insert = database.prepare(
    'INSERT OR IGNORE INTO memory_aliases (alias, canonical, type) VALUES (?, ?, ?)',
  )
  const insertMany = database.transaction((data: AliasSeedRow[]) => {
    for (const row of data) {
      insert.run(row.alias.toLowerCase(), row.canonical.toLowerCase(), row.type)
    }
  })
  insertMany(rows)
}

// ── News sources seed ─────────────────────────────────────────────────────────
//
// INSERT OR IGNORE — safe on every startup. Existing rows are never overwritten.

interface NewsSourceSeed {
  name: string
  url: string
  feed_url: string | null
  bias_base: number
  reliability: number
  type: string
  scope_json: string
  anchor: number
}

const NEWS_SOURCES_SEED: NewsSourceSeed[] = [
  // ── Anclas (international wire / reference outlets) ─────────────────────
  // BBC Mundo is the most reliable news feed currently working in our
  // verification. It serves as the primary anchor for international coverage.
  {
    name: 'BBC Mundo',
    url: 'https://www.bbc.com/mundo',
    feed_url: 'https://feeds.bbci.co.uk/mundo/rss.xml',
    bias_base: 5.0, reliability: 0.92, type: 'international-news',
    scope_json: JSON.stringify(['mexico-impact', 'latin-america', 'world']),
    anchor: 1,
  },
  // ── Cobertura nacional ────────────────────────────────────────────────────
  {
    name: 'Quadratín México',
    url: 'https://mexico.quadratin.com.mx',
    feed_url: 'https://mexico.quadratin.com.mx/feed/atom/',
    bias_base: 5.0, reliability: 0.82, type: 'mexican-wire',
    scope_json: JSON.stringify(['mexico', 'states', 'politics']),
    anchor: 0,
  },
  // ── Centro / Nacional ────────────────────────────────────────────────────
  {
    name: 'Excélsior',
    url: 'https://www.excelsior.com.mx',
    feed_url: 'https://www.excelsior.com.mx/rss',
    bias_base: 5.5, reliability: 0.81, type: 'national-news',
    scope_json: JSON.stringify(['mexico', 'politics', 'economy', 'security']),
    anchor: 0,
  },
  // ── Economía / Negocios ──────────────────────────────────────────────────
  {
    name: 'El Financiero',
    url: 'https://www.elfinanciero.com.mx',
    feed_url: 'https://www.elfinanciero.com.mx/rss/feed.xml',
    bias_base: 6.0, reliability: 0.86, type: 'business-news',
    scope_json: JSON.stringify(['mexico', 'economy', 'business', 'mexico-impact']),
    anchor: 0,
  },
  {
    name: 'El Financiero Nacional',
    url: 'https://www.elfinanciero.com.mx/nacional',
    feed_url: 'https://www.elfinanciero.com.mx/nacional/rss',
    bias_base: 6.0, reliability: 0.86, type: 'business-news',
    scope_json: JSON.stringify(['mexico', 'politics', 'security']),
    anchor: 0,
  },
  {
    name: 'El Financiero Internacional',
    url: 'https://www.elfinanciero.com.mx/internacional',
    feed_url: 'https://www.elfinanciero.com.mx/internacional/rss',
    bias_base: 5.5, reliability: 0.85, type: 'business-news',
    scope_json: JSON.stringify(['mexico-impact', 'world']),
    anchor: 0,
  },
  // ── Izquierda ─────────────────────────────────────────────────────────────
  {
    name: 'La Jornada',
    url: 'https://www.jornada.com.mx',
    feed_url: 'https://www.jornada.com.mx/rss/edicion.xml',
    bias_base: 2.5, reliability: 0.82, type: 'national-news',
    scope_json: JSON.stringify(['mexico', 'politics', 'security', 'economy']),
    anchor: 0,
  },
  {
    name: 'La Jornada Política',
    url: 'https://www.jornada.com.mx/politica',
    feed_url: 'https://www.jornada.com.mx/rss/politica.xml',
    bias_base: 2.5, reliability: 0.82, type: 'national-news',
    scope_json: JSON.stringify(['mexico', 'politics']),
    anchor: 0,
  },
  {
    name: 'La Jornada Economía',
    url: 'https://www.jornada.com.mx/economia',
    feed_url: 'https://www.jornada.com.mx/rss/economia.xml',
    bias_base: 2.5, reliability: 0.82, type: 'national-news',
    scope_json: JSON.stringify(['mexico', 'economy', 'business']),
    anchor: 0,
  },
  {
    name: 'La Jornada Estados',
    url: 'https://www.jornada.com.mx/estados',
    feed_url: 'https://www.jornada.com.mx/rss/estados.xml',
    bias_base: 2.5, reliability: 0.82, type: 'national-news',
    scope_json: JSON.stringify(['mexico', 'states', 'security']),
    anchor: 0,
  },
  // ── Internacionales ───────────────────────────────────────────────────────
  {
    name: 'El País México',
    url: 'https://elpais.com/mexico',
    feed_url: 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/mexico/portada',
    bias_base: 4.5, reliability: 0.89, type: 'international-news',
    scope_json: JSON.stringify(['mexico', 'mexico-impact', 'latin-america']),
    anchor: 0,
  },
]

function seedNewsSources(database: Database.Database): void {
  // Use ON CONFLICT to UPSERT on name (which is UNIQUE) so that
  // feed_url/bias/etc. stay in sync with the seed when the list changes,
  // while preserving the source `id` so FK references in
  // news_articles_cache / news_digest_cache remain valid.
  const upsert = database.prepare(`
    INSERT INTO news_sources
      (name, url, feed_url, bias_base, reliability, type, scope_json, anchor)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      url = excluded.url,
      feed_url = excluded.feed_url,
      bias_base = excluded.bias_base,
      reliability = excluded.reliability,
      type = excluded.type,
      scope_json = excluded.scope_json,
      anchor = excluded.anchor,
      updated_at = datetime('now')
  `)
  const insertMany = database.transaction((rows: NewsSourceSeed[]) => {
    for (const row of rows) {
      upsert.run(row.name, row.url, row.feed_url, row.bias_base, row.reliability, row.type, row.scope_json, row.anchor)
    }
  })
  insertMany(NEWS_SOURCES_SEED)

  // Disable any sources that are no longer in the seed (e.g. a feed went
  // dead). We don't delete them so historical FK references stay valid.
  const seedNames = NEWS_SOURCES_SEED.map((r) => r.name)
  if (seedNames.length > 0) {
    const placeholders = seedNames.map(() => '?').join(',')
    database.prepare(`
      UPDATE news_sources
      SET enabled = 0, updated_at = datetime('now')
      WHERE name NOT IN (${placeholders})
    `).run(...seedNames)
  }
}

// ── News topics seed ──────────────────────────────────────────────────────────

interface NewsTopicSeed {
  name: string
  keywords: string[]
  scope_tags: string[]
  source_ids?: number[]
}

const NEWS_TOPICS_SEED: NewsTopicSeed[] = [
  {
    name: 'México',
    keywords: ['méxico', 'mexico', 'nacional', 'país'],
    scope_tags: ['mexico', 'politics', 'security', 'economy'],
  },
  {
    name: 'Internacional',
    keywords: ['internacional', 'world', 'global', 'eeuu', 'china', 'europa', 'internacionales'],
    scope_tags: ['world', 'latin-america', 'international-news'],
  },
  {
    name: 'Finanzas',
    keywords: ['finanzas', 'economía', 'economy', 'negocios', 'business', 'bolsa', 'dólar', 'empresas'],
    scope_tags: ['economy', 'business'],
  },
  {
    name: 'Tecnología',
    keywords: ['tecnología', 'technology', 'tech', 'AI', 'inteligencia artificial', 'startup', 'digital', 'software'],
    scope_tags: ['technology', 'science'],
  },
  {
    name: 'Ciencia',
    keywords: ['ciencia', 'science', 'investigación', 'research', 'salud', 'health', 'medio ambiente', 'environment'],
    scope_tags: ['science', 'health', 'environment'],
  },
]

export interface NewsTopicRow {
  id: number
  name: string
  keywords: string
  scope_tags: string
  source_ids: string
  enabled: number
  created_at: string
  updated_at: string
}

function seedNewsTopics(database: Database.Database): void {
  const upsert = database.prepare(`
    INSERT INTO news_topics (name, keywords, scope_tags, source_ids, enabled)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(name) DO UPDATE SET
      keywords = excluded.keywords,
      scope_tags = excluded.scope_tags,
      updated_at = CURRENT_TIMESTAMP
  `)
  const insertMany = database.transaction((rows: NewsTopicSeed[]) => {
    for (const row of rows) {
      upsert.run(row.name, JSON.stringify(row.keywords), JSON.stringify(row.scope_tags), JSON.stringify(row.source_ids ?? []))
    }
  })
  insertMany(NEWS_TOPICS_SEED)
}

export function getNewsTopics(): NewsTopicRow[] {
  const db = getDb()
  return db.prepare('SELECT * FROM news_topics WHERE enabled = 1 ORDER BY name').all() as NewsTopicRow[]
}

export function getNewsTopicByName(name: string): NewsTopicRow | null {
  const db = getDb()
  return db.prepare('SELECT * FROM news_topics WHERE enabled = 1 AND name = ?').get(name) as NewsTopicRow | null
}

export function upsertNewsTopic(name: string, keywords: string[], scope_tags?: string[], source_ids?: number[]): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO news_topics (name, keywords, scope_tags, source_ids, enabled)
    VALUES (?, ?, ?, ?, 1)
    ON CONFLICT(name) DO UPDATE SET
      keywords = excluded.keywords,
      scope_tags = excluded.scope_tags,
      source_ids = excluded.source_ids,
      updated_at = CURRENT_TIMESTAMP
  `).run(name, JSON.stringify(keywords), JSON.stringify(scope_tags ?? []), JSON.stringify(source_ids ?? []))
}

export function deleteNewsTopic(name: string): void {
  const db = getDb()
  db.prepare("UPDATE news_topics SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE name = ?").run(name)
}

export function cleanCaches(): number {
  const db = getDb()
  let total = 0

  for (const table of ['search_cache', 'news_digest_cache', 'news_articles_cache']) {
    const count = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number }
    db.prepare(`DELETE FROM ${table}`).run()
    total += count.c
  }

  return total
}
