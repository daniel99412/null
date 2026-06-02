import { getDb, closeDb } from './database.js'
import type { LLMMessage } from '../core/prompt-builder.js'
import type { MessagePart } from '../core/document-context.js'

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

interface MessagePartRow {
  id: number
  message_id: number
  session_id: string
  type: MessagePart['type']
  content: string
  path: string | null
  filename: string | null
  mime: string | null
  synthetic: 0 | 1
  metadata_json: string | null
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
): number {
  const db = getDb()
  const result = db.prepare(
    'INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)',
  ).run(sessionId, role, content)
  const messageId = Number(result.lastInsertRowid)

  saveMessageParts(sessionId, messageId, [{
    type: 'text',
    content,
    synthetic: false,
  }])

  updateSessionTimestamp(sessionId)
  return messageId
}

export function getSessionMessages(sessionId: string): ChatMessage[] {
  const db = getDb()
  const rows = db
    .prepare('SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC')
    .all(sessionId) as MessageRow[]

  return rows.map((r) => ({ role: r.role, content: r.content }))
}

export function saveMessageParts(
  sessionId: string,
  messageId: number,
  parts: MessagePart[],
): void {
  if (parts.length === 0) return

  const db = getDb()
  const insert = db.prepare(`
    INSERT INTO message_parts (
      message_id,
      session_id,
      type,
      content,
      path,
      filename,
      mime,
      synthetic,
      metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)

  const insertMany = db.transaction((items: MessagePart[]) => {
    for (const part of items) {
      insert.run(
        messageId,
        sessionId,
        part.type,
        part.content,
        part.path ?? null,
        part.filename ?? null,
        part.mime ?? null,
        part.synthetic ? 1 : 0,
        part.metadata ? JSON.stringify(part.metadata) : null,
      )
    }
  })

  insertMany(parts)
}

export function getMessageParts(messageId: number): MessagePart[] {
  const db = getDb()
  const rows = db.prepare(
    'SELECT * FROM message_parts WHERE message_id = ? ORDER BY id ASC',
  ).all(messageId) as MessagePartRow[]

  return rows.map(rowToMessagePart)
}

export function getSessionPromptMessages(
  sessionId: string,
  options: { beforeMessageId?: number } = {},
): LLMMessage[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT id, session_id, role, content, created_at
    FROM messages
    WHERE session_id = ?
      AND (? IS NULL OR id < ?)
    ORDER BY id ASC
  `).all(sessionId, options.beforeMessageId ?? null, options.beforeMessageId ?? null) as MessageRow[]

  if (rows.length === 0) return []

  const messageIds = rows.map((row) => row.id)
  const placeholders = messageIds.map(() => '?').join(',')
  const partRows = placeholders
    ? db.prepare(`SELECT * FROM message_parts WHERE message_id IN (${placeholders}) ORDER BY message_id ASC, id ASC`).all(...messageIds) as MessagePartRow[]
    : []
  const partsByMessageId = new Map<number, MessagePartRow[]>()

  for (const part of partRows) {
    const existing = partsByMessageId.get(part.message_id) ?? []
    existing.push(part)
    partsByMessageId.set(part.message_id, existing)
  }

  return rows.map((row) => {
    const parts = partsByMessageId.get(row.id)
    if (!parts || parts.length === 0) {
      return { role: row.role, content: row.content }
    }

    const textPart = parts.find((part) => part.type === 'text')
    const syntheticParts = parts.filter((part) => part.synthetic === 1 && part.type !== 'text')
    const content = [
      textPart?.content ?? row.content,
      ...syntheticParts.map((part) => part.content),
    ].filter((part) => part.trim().length > 0).join('\n\n')

    return { role: row.role, content }
  })
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
  db.prepare('DELETE FROM message_parts WHERE session_id = ?').run(id)
  db.prepare('DELETE FROM messages WHERE session_id = ?').run(id)
  db.prepare('DELETE FROM session_summaries WHERE session_id = ?').run(id)
  db.prepare('UPDATE memory_events SET session_id = NULL WHERE session_id = ?').run(id)
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
}

export function deleteAllSessions(): void {
  const db = getDb()
  const deleteAll = db.transaction(() => {
    db.prepare('DELETE FROM message_parts').run()
    db.prepare('DELETE FROM messages').run()
    db.prepare('DELETE FROM session_summaries').run()
    db.prepare('UPDATE memory_events SET session_id = NULL').run()
    db.prepare('DELETE FROM sessions').run()
  })
  deleteAll()
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
  db.prepare('DELETE FROM message_parts WHERE session_id = ?').run(sessionId)
  db.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId)
}

function rowToMessagePart(row: MessagePartRow): MessagePart {
  return {
    type: row.type,
    content: row.content,
    path: row.path,
    filename: row.filename,
    mime: row.mime,
    synthetic: row.synthetic === 1,
    metadata: row.metadata_json ? parseMetadata(row.metadata_json) : undefined,
  }
}

function parseMetadata(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown
    return typeof parsed === 'object' && parsed !== null
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

export { closeDb }
