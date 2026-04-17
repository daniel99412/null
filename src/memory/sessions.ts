import { getDb, closeDb } from './database.js'

export interface ChatMessage {
  role: 'user' | 'assistant' | 'recall'
  content: string
}

export interface Session {
  id: string
  title: string | null
  status: 'active' | 'archived'
  created_at: string
  updated_at: string
}

export interface SessionSummary {
  id: number
  session_id: string
  summary: string
  message_count: number
  created_at: string
}

interface MessageRow {
  id: number
  session_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

function generateSessionId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 8)
  return `ses_${timestamp}${random}`
}

export function createSession(title?: string): Session {
  const db = getDb()
  const id = generateSessionId()
  const now = new Date().toISOString()

  db.prepare(
    'INSERT INTO sessions (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
  ).run(id, title || null, now, now)

  return { id, title: title || null, status: 'active', created_at: now, updated_at: now }
}

export function getSession(id: string): Session | undefined {
  const db = getDb()
  const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session | undefined
  return row
}

export function updateSessionTitle(id: string, title: string): void {
  const db = getDb()
  db.prepare(
    'UPDATE sessions SET title = ?, updated_at = datetime(\'now\') WHERE id = ?',
  ).run(title, id)
}

export function updateSessionTimestamp(id: string): void {
  const db = getDb()
  db.prepare(
    'UPDATE sessions SET updated_at = datetime(\'now\') WHERE id = ?',
  ).run(id)
}

export function saveMessage(
  sessionId: string,
  role: 'user' | 'assistant',
  content: string,
): void {
  const db = getDb()
  db.prepare(
    'INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)',
  ).run(sessionId, role, content)

  updateSessionTimestamp(sessionId)
}

export function getSessionMessages(sessionId: string): ChatMessage[] {
  const db = getDb()
  const rows = db
    .prepare('SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC')
    .all(sessionId) as MessageRow[]

  return rows.map((r) => ({ role: r.role, content: r.content }))
}

export function listSessions(limit: number = 10): Session[] {
  const db = getDb()
  const rows = db
    .prepare('SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?')
    .all(limit) as Session[]
  return rows
}

export function deleteSession(id: string): void {
  const db = getDb()
  db.prepare('DELETE FROM messages WHERE session_id = ?').run(id)
  db.prepare('DELETE FROM session_summaries WHERE session_id = ?').run(id)
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
}

/**
 * Get session IDs that haven't been updated in `days` days and are still active with messages.
 */
export function getStaleSessionIds(days: number = 30): string[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT s.id FROM sessions s
    INNER JOIN messages m ON m.session_id = s.id
    WHERE s.status = 'active'
      AND s.updated_at < datetime('now', ? || ' days')
    GROUP BY s.id
  `).all(`-${days}`) as { id: string }[]
  return rows.map((r) => r.id)
}

/**
 * Mark a session as archived.
 */
export function archiveSession(id: string): void {
  const db = getDb()
  db.prepare("UPDATE sessions SET status = 'archived' WHERE id = ?").run(id)
}

/**
 * Reactivate an archived session.
 */
export function reactivateSession(id: string): void {
  const db = getDb()
  db.prepare("UPDATE sessions SET status = 'active', updated_at = datetime('now') WHERE id = ?").run(id)
}

/**
 * Save a summary for a session.
 */
export function saveSummary(sessionId: string, summary: string, messageCount: number): void {
  const db = getDb()
  db.prepare(
    'INSERT OR REPLACE INTO session_summaries (session_id, summary, message_count) VALUES (?, ?, ?)',
  ).run(sessionId, summary, messageCount)
}

/**
 * Get the summary for a session, if one exists.
 */
export function getSummary(sessionId: string): SessionSummary | undefined {
  const db = getDb()
  return db.prepare(
    'SELECT * FROM session_summaries WHERE session_id = ?',
  ).get(sessionId) as SessionSummary | undefined
}

/**
 * Delete all messages for a session (used after archiving).
 */
export function deleteSessionMessages(sessionId: string): void {
  const db = getDb()
  db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId)
}

export { closeDb }
