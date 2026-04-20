import Database from 'better-sqlite3'
import path from 'path'
import os from 'os'
import fs from 'fs'

const DATA_DIR = path.join(os.homedir(), '.null-cli')
const DB_PATH = path.join(DATA_DIR, 'null.db')

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db

  // Ensure data directory exists
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }

  db = new Database(DB_PATH)

  // Enable WAL mode for better concurrent performance
  db.pragma('journal_mode = WAL')

  // Create tables
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

    CREATE TABLE IF NOT EXISTS search_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query_key TEXT NOT NULL UNIQUE,
      result TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      ttl_seconds INTEGER NOT NULL DEFAULT 300
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_session_summaries_session_id ON session_summaries(session_id);
  `)

  // Migration: add status column if missing (for existing DBs)
  const columns = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]
  if (!columns.some((c) => c.name === 'status')) {
    db.exec("ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived'))")
  }

  return db
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
