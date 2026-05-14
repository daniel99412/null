import {
  getStaleSessionIds,
  getSessionMessages,
  saveSummary,
  deleteSessionMessages,
  archiveSession,
} from './sessions.js'
import { getDefaultClient } from '../core/llm-client.js'
import { getDb } from './database.js'
import { PERMANENT_TYPES } from './memory-store.js'

const CLEANUP_THRESHOLD_DAYS = 30

const SUMMARIZE_PROMPT = `You are a memory system. Summarize the following conversation between a user and an AI assistant.
Your summary should:
1. Capture the main topic(s) discussed
2. Note any key decisions, conclusions, or solutions reached
3. Mention any important details the user shared (preferences, project context, etc.)
4. Be concise but complete enough to recall the conversation later (2-4 paragraphs max)

Write the summary in the same language the conversation was held in.
Do NOT start with "In this conversation..." or similar filler. Go straight to the content.`

/**
 * Call Ollama without streaming to get a complete response.
 */
async function generateSummary(conversationText: string): Promise<string> {
  const client = getDefaultClient()
  return client.complete([
    { role: 'system', content: SUMMARIZE_PROMPT },
    { role: 'user', content: conversationText },
  ])
}

/**
 * Format messages into a readable conversation transcript for summarization.
 */
function formatConversation(messages: { role: string; content: string }[]): string {
  return messages
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n')
}

/**
 * Run the cleanup process: summarize and archive sessions older than the threshold.
 * Returns the number of sessions archived.
 */
export async function runCleanup(): Promise<number> {
  const staleIds = getStaleSessionIds(CLEANUP_THRESHOLD_DAYS)

  if (staleIds.length === 0) return 0

  let archived = 0

  for (const sessionId of staleIds) {
    try {
      const messages = getSessionMessages(sessionId)

      if (messages.length === 0) {
        archiveSession(sessionId)
        archived++
        continue
      }

      const transcript = formatConversation(messages)
      const summary = await generateSummary(transcript)

      if (summary.trim().length > 0) {
        saveSummary(sessionId, summary, messages.length)
        deleteSessionMessages(sessionId)
        archiveSession(sessionId)
        archived++
      }
    } catch {
      // Skip sessions that fail to summarize — will retry next startup
      continue
    }
  }

  return archived
}

// ── Memory decay ──────────────────────────────────────────────────────────────

const DECAY_FACTOR = 0.95        // score multiplier per week of inactivity
const DECAY_THRESHOLD_DAYS = 30  // days inactive before decay kicks in
const DELETE_SCORE_THRESHOLD = 0.15  // delete memory if score drops below this

/**
 * Apply weekly score decay to non-permanent memories that haven't been seen
 * in DECAY_THRESHOLD_DAYS. Also hard-deletes expired memories (expires_at < now)
 * that have a low enough score.
 *
 * Safe to run on every startup — no-op if no stale memories exist.
 */
export function runMemoryDecay(): void {
  const db = getDb()

  // Build IN clause for permanent types to exclude
  const permanentList = Array.from(PERMANENT_TYPES).map(() => '?').join(', ')
  const permanentValues = Array.from(PERMANENT_TYPES)

  // Find decayable memories: non-permanent, not seen in threshold days
  const stale = db.prepare(`
    SELECT ms.memory_id, ms.score
    FROM memory_scores ms
    JOIN memories m ON m.id = ms.memory_id
    WHERE m.type NOT IN (${permanentList})
      AND ms.last_seen_at < datetime('now', '-${DECAY_THRESHOLD_DAYS} days')
  `).all(...permanentValues) as { memory_id: number; score: number }[]

  if (stale.length === 0) {
    // Also clean hard-expired memories regardless
    deleteExpiredMemories(db)
    return
  }

  const updateScore = db.prepare(
    'UPDATE memory_scores SET score = ? WHERE memory_id = ?',
  )
  const deleteMemory = db.prepare('DELETE FROM memories WHERE id = ?')

  const decay = db.transaction(() => {
    for (const row of stale) {
      const newScore = row.score * DECAY_FACTOR
      if (newScore < DELETE_SCORE_THRESHOLD) {
        deleteMemory.run(row.memory_id) // cascades to memory_scores
      } else {
        updateScore.run(newScore, row.memory_id)
      }
    }
  })

  decay()
  deleteExpiredMemories(db)
}

function deleteExpiredMemories(db: ReturnType<typeof getDb>): void {
  db.prepare(`
    DELETE FROM memories
    WHERE expires_at IS NOT NULL
      AND expires_at < datetime('now')
      AND id IN (
        SELECT memory_id FROM memory_scores WHERE score < ?
      )
  `).run(DELETE_SCORE_THRESHOLD)
}
