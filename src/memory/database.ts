import Database from 'better-sqlite3'
import path from 'path'
import os from 'os'
import fs from 'fs'

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

    CREATE TABLE IF NOT EXISTS espn_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cache_key TEXT NOT NULL UNIQUE,
      result TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      ttl_seconds INTEGER NOT NULL DEFAULT 86400
    );

    CREATE INDEX IF NOT EXISTS idx_espn_cache_key ON espn_cache(cache_key);

    -- ── Legacy preferences table (kept for backward compat, data migrated below) ──

    CREATE TABLE IF NOT EXISTS user_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      value TEXT NOT NULL,
      label TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(category, value)
    );

    CREATE INDEX IF NOT EXISTS idx_user_preferences_category ON user_preferences(category);

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
  `)

  // ── Schema migrations ──────────────────────────────────────────────────────

  const sessionCols = db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]
  if (!sessionCols.some((c) => c.name === 'status')) {
    db.exec("ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
  }

  // ── Seed memory_aliases from canonical maps ────────────────────────────────

  seedAliases(db)

  // ── Migrate user_preferences → memories ───────────────────────────────────

  migratePreferences(db)

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
// These are the same canonical maps that lived in preferences.ts.
// Storing them in the DB makes them editable at runtime without a deploy.
// INSERT OR IGNORE — safe to run on every startup.

const ALIAS_SEED: { alias: string; canonical: string; type: string }[] = [
  // Teams — Liga MX
  { alias: 'atlas', canonical: 'atlas', type: 'preference' },
  { alias: 'zorros', canonical: 'atlas', type: 'preference' },
  { alias: 'america', canonical: 'america', type: 'preference' },
  { alias: 'aguilas', canonical: 'america', type: 'preference' },
  { alias: 'club america', canonical: 'america', type: 'preference' },
  { alias: 'chivas', canonical: 'chivas', type: 'preference' },
  { alias: 'guadalajara', canonical: 'chivas', type: 'preference' },
  { alias: 'rebano', canonical: 'chivas', type: 'preference' },
  { alias: 'cruz azul', canonical: 'cruz azul', type: 'preference' },
  { alias: 'la maquina', canonical: 'cruz azul', type: 'preference' },
  { alias: 'pumas', canonical: 'pumas', type: 'preference' },
  { alias: 'pumas unam', canonical: 'pumas', type: 'preference' },
  { alias: 'tigres', canonical: 'tigres', type: 'preference' },
  { alias: 'tigres uanl', canonical: 'tigres', type: 'preference' },
  { alias: 'monterrey', canonical: 'monterrey', type: 'preference' },
  { alias: 'rayados', canonical: 'monterrey', type: 'preference' },
  { alias: 'toluca', canonical: 'toluca', type: 'preference' },
  { alias: 'diablos rojos', canonical: 'toluca', type: 'preference' },
  { alias: 'pachuca', canonical: 'pachuca', type: 'preference' },
  { alias: 'tuzos', canonical: 'pachuca', type: 'preference' },
  { alias: 'santos', canonical: 'santos laguna', type: 'preference' },
  { alias: 'santos laguna', canonical: 'santos laguna', type: 'preference' },
  { alias: 'leon', canonical: 'leon', type: 'preference' },
  { alias: 'necaxa', canonical: 'necaxa', type: 'preference' },
  { alias: 'rayos', canonical: 'necaxa', type: 'preference' },
  { alias: 'puebla', canonical: 'puebla', type: 'preference' },
  { alias: 'camoteros', canonical: 'puebla', type: 'preference' },
  { alias: 'queretaro', canonical: 'queretaro', type: 'preference' },
  { alias: 'gallos', canonical: 'queretaro', type: 'preference' },
  { alias: 'tijuana', canonical: 'tijuana', type: 'preference' },
  { alias: 'xolos', canonical: 'tijuana', type: 'preference' },
  { alias: 'juarez', canonical: 'juarez', type: 'preference' },
  { alias: 'bravos', canonical: 'juarez', type: 'preference' },
  // Teams — LaLiga
  { alias: 'barcelona', canonical: 'barcelona', type: 'preference' },
  { alias: 'real madrid', canonical: 'real madrid', type: 'preference' },
  { alias: 'atletico madrid', canonical: 'atletico madrid', type: 'preference' },
  // Teams — EPL
  { alias: 'manchester city', canonical: 'manchester city', type: 'preference' },
  { alias: 'man city', canonical: 'manchester city', type: 'preference' },
  { alias: 'arsenal', canonical: 'arsenal', type: 'preference' },
  { alias: 'liverpool', canonical: 'liverpool', type: 'preference' },
  { alias: 'chelsea', canonical: 'chelsea', type: 'preference' },
  { alias: 'manchester united', canonical: 'manchester united', type: 'preference' },
  { alias: 'man united', canonical: 'manchester united', type: 'preference' },
  { alias: 'tottenham', canonical: 'tottenham', type: 'preference' },
  { alias: 'spurs', canonical: 'tottenham', type: 'preference' },
  // Teams — NBA
  { alias: 'lakers', canonical: 'lakers', type: 'preference' },
  { alias: 'los angeles lakers', canonical: 'lakers', type: 'preference' },
  { alias: 'celtics', canonical: 'celtics', type: 'preference' },
  { alias: 'warriors', canonical: 'warriors', type: 'preference' },
  { alias: 'bulls', canonical: 'bulls', type: 'preference' },
  // Leagues
  { alias: 'liga mx', canonical: 'liga mx', type: 'preference' },
  { alias: 'ligamx', canonical: 'liga mx', type: 'preference' },
  { alias: 'liga mexicana', canonical: 'liga mx', type: 'preference' },
  { alias: 'premier league', canonical: 'premier league', type: 'preference' },
  { alias: 'epl', canonical: 'premier league', type: 'preference' },
  { alias: 'premier', canonical: 'premier league', type: 'preference' },
  { alias: 'la liga', canonical: 'la liga', type: 'preference' },
  { alias: 'laliga', canonical: 'la liga', type: 'preference' },
  { alias: 'serie a', canonical: 'serie a', type: 'preference' },
  { alias: 'bundesliga', canonical: 'bundesliga', type: 'preference' },
  { alias: 'ligue 1', canonical: 'ligue 1', type: 'preference' },
  { alias: 'champions league', canonical: 'champions league', type: 'preference' },
  { alias: 'champions', canonical: 'champions league', type: 'preference' },
  { alias: 'ucl', canonical: 'champions league', type: 'preference' },
  { alias: 'copa libertadores', canonical: 'copa libertadores', type: 'preference' },
  { alias: 'libertadores', canonical: 'copa libertadores', type: 'preference' },
  { alias: 'nba', canonical: 'nba', type: 'preference' },
  { alias: 'nfl', canonical: 'nfl', type: 'preference' },
  { alias: 'mlb', canonical: 'mlb', type: 'preference' },
  { alias: 'nhl', canonical: 'nhl', type: 'preference' },
  { alias: 'mls', canonical: 'mls', type: 'preference' },
  // Sports
  { alias: 'futbol', canonical: 'futbol', type: 'preference' },
  { alias: 'soccer', canonical: 'futbol', type: 'preference' },
  { alias: 'football', canonical: 'futbol', type: 'preference' },
  { alias: 'basketball', canonical: 'basketball', type: 'preference' },
  { alias: 'basquetbol', canonical: 'basketball', type: 'preference' },
  { alias: 'baseball', canonical: 'baseball', type: 'preference' },
  { alias: 'beisbol', canonical: 'baseball', type: 'preference' },
  { alias: 'hockey', canonical: 'hockey', type: 'preference' },
  { alias: 'tenis', canonical: 'tenis', type: 'preference' },
  { alias: 'tennis', canonical: 'tenis', type: 'preference' },
  { alias: 'futbol americano', canonical: 'futbol americano', type: 'preference' },
  // Tech stack aliases
  { alias: 'c#', canonical: 'dotnet', type: 'tech_stack' },
  { alias: 'csharp', canonical: 'dotnet', type: 'tech_stack' },
  { alias: '.net', canonical: 'dotnet', type: 'tech_stack' },
  { alias: 'dotnet', canonical: 'dotnet', type: 'tech_stack' },
  { alias: 'asp.net', canonical: 'dotnet', type: 'tech_stack' },
  { alias: 'node', canonical: 'nodejs', type: 'tech_stack' },
  { alias: 'node.js', canonical: 'nodejs', type: 'tech_stack' },
  { alias: 'nodejs', canonical: 'nodejs', type: 'tech_stack' },
  { alias: 'js', canonical: 'javascript', type: 'tech_stack' },
  { alias: 'javascript', canonical: 'javascript', type: 'tech_stack' },
  { alias: 'ts', canonical: 'typescript', type: 'tech_stack' },
  { alias: 'typescript', canonical: 'typescript', type: 'tech_stack' },
  { alias: 'react.js', canonical: 'react', type: 'tech_stack' },
  { alias: 'react', canonical: 'react', type: 'tech_stack' },
  { alias: 'vue.js', canonical: 'vue', type: 'tech_stack' },
  { alias: 'vue', canonical: 'vue', type: 'tech_stack' },
  { alias: 'k8s', canonical: 'kubernetes', type: 'tech_stack' },
  { alias: 'kubernetes', canonical: 'kubernetes', type: 'tech_stack' },
  { alias: 'postgres', canonical: 'postgresql', type: 'tech_stack' },
  { alias: 'postgresql', canonical: 'postgresql', type: 'tech_stack' },
  { alias: 'py', canonical: 'python', type: 'tech_stack' },
  { alias: 'python', canonical: 'python', type: 'tech_stack' },
]

function seedAliases(database: Database.Database): void {
  const insert = database.prepare(
    'INSERT OR IGNORE INTO memory_aliases (alias, canonical, type) VALUES (?, ?, ?)',
  )
  const insertMany = database.transaction((rows: typeof ALIAS_SEED) => {
    for (const row of rows) {
      insert.run(row.alias.toLowerCase(), row.canonical.toLowerCase(), row.type)
    }
  })
  insertMany(ALIAS_SEED)
}

// ── Migrate user_preferences → memories ──────────────────────────────────────
//
// Runs once on startup. Existing preferences become memories with:
//   type = 'preference', source = 'explicit', score = 0.9 (high — user stated them)
// INSERT OR IGNORE ensures idempotency.

function migratePreferences(database: Database.Database): void {
  const prefs = database
    .prepare('SELECT category, value, label FROM user_preferences')
    .all() as { category: string; value: string; label: string | null }[]

  if (prefs.length === 0) return

  const insertMemory = database.prepare(`
    INSERT OR IGNORE INTO memories (type, value, raw_value, confidence, source)
    VALUES ('preference', ?, ?, 0.9, 'explicit')
  `)

  const getMemoryId = database.prepare(
    "SELECT id FROM memories WHERE type = 'preference' AND value = ?",
  )

  const insertScore = database.prepare(`
    INSERT OR IGNORE INTO memory_scores (memory_id, score, recurrence, last_seen_at)
    VALUES (?, 0.9, 1, datetime('now'))
  `)

  const migrate = database.transaction(() => {
    for (const pref of prefs) {
      insertMemory.run(pref.value, pref.label ?? pref.value)
      const row = getMemoryId.get(pref.value) as { id: number } | undefined
      if (row) {
        insertScore.run(row.id)
      }
    }
  })

  migrate()
}
