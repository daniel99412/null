import Database from 'better-sqlite3'
import path from 'path'
import os from 'os'
import fs from 'fs'

function getDataDir(): string {
  if (process.env['NULL_CLI_DATA_DIR']) {
    return process.env['NULL_CLI_DATA_DIR']
  }
  if (process.env['VITEST']) {
    return path.join(os.tmpdir(), `null-cli-test-${process.pid}`)
  }
  return path.join(os.homedir(), '.null-cli')
}

function getDbPath(): string {
  return path.join(getDataDir(), 'null.db')
}

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db

  const dataDir = getDataDir()
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  db = new Database(getDbPath())
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

    CREATE TABLE IF NOT EXISTS message_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('text', 'file_context', 'tool_observation')),
      content TEXT NOT NULL,
      path TEXT,
      filename TEXT,
      mime TEXT,
      synthetic INTEGER NOT NULL DEFAULT 0,
      metadata_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_message_parts_message_id ON message_parts(message_id);
    CREATE INDEX IF NOT EXISTS idx_message_parts_session_id ON message_parts(session_id);

    CREATE TABLE IF NOT EXISTS session_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL UNIQUE,
      summary TEXT NOT NULL,
      message_count INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_session_summaries_session_id ON session_summaries(session_id);

    -- ── Legacy preferences table (kept for backward compat) ──────────────────

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

    CREATE TABLE IF NOT EXISTS memories (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      type        TEXT NOT NULL,
      value       TEXT NOT NULL,
      raw_value   TEXT,
      confidence  REAL NOT NULL DEFAULT 0.7,
      source      TEXT NOT NULL DEFAULT 'extracted' CHECK (source IN ('explicit', 'extracted', 'inferred')),
      expires_at  TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(type, value)
    );

    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);

    CREATE TABLE IF NOT EXISTS memory_scores (
      memory_id    INTEGER PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
      score        REAL NOT NULL DEFAULT 0.7,
      recurrence   INTEGER NOT NULL DEFAULT 1,
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS memory_aliases (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      alias     TEXT NOT NULL,
      canonical TEXT NOT NULL,
      type      TEXT NOT NULL,
      UNIQUE(alias, type)
    );

    CREATE INDEX IF NOT EXISTS idx_memory_aliases_alias ON memory_aliases(alias);

    CREATE TABLE IF NOT EXISTS memory_relations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id    INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      to_id      INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      relation   TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS memory_events (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id    INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      session_id   TEXT,
      mentioned_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_memory_events_memory_id ON memory_events(memory_id);

    CREATE TABLE IF NOT EXISTS retrieval_logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      query      TEXT NOT NULL,
      memory_ids TEXT NOT NULL DEFAULT '[]',
      was_useful INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `)

  // ── Schema migrations ──────────────────────────────────────────────────────

  const sessionCols = db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]
  if (!sessionCols.some((c) => c.name === 'status')) {
    db.exec("ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
  }

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

// ── Migrate user_preferences → memories ──────────────────────────────────────

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
