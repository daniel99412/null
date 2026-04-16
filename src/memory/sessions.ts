import { getDb, closeDb } from './database.js'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface Session {
  id: string
  title: string | null
  created_at: string
  updated_at: string
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

  return { id, title: title || null, created_at: now, updated_at: now }
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
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
}

export { closeDb }
