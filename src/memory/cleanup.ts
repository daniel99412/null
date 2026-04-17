import {
  getStaleSessionIds,
  getSessionMessages,
  saveSummary,
  deleteSessionMessages,
  archiveSession,
} from './sessions.js'

const CLEANUP_THRESHOLD_DAYS = 30

const SUMMARIZE_PROMPT = `You are a memory system. Summarize the following conversation between a user and an AI assistant.
Your summary should:
1. Capture the main topic(s) discussed
2. Note any key decisions, conclusions, or solutions reached
3. Mention any important details the user shared (preferences, project context, etc.)
4. Be concise but complete enough to recall the conversation later (2-4 paragraphs max)

Write the summary in the same language the conversation was held in.
Do NOT start with "In this conversation..." or similar filler. Go straight to the content.`

interface OllamaResponse {
  message?: { content?: string }
}

/**
 * Call Ollama without streaming to get a complete response.
 */
async function generateSummary(conversationText: string): Promise<string> {
  const res = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'qwen2.5-coder:7b',
      stream: false,
      messages: [
        { role: 'system', content: SUMMARIZE_PROMPT },
        { role: 'user', content: conversationText },
      ],
    }),
  })

  if (!res.ok) {
    throw new Error(`Ollama summarization failed: ${res.status}`)
  }

  const data = await res.json() as OllamaResponse
  return data.message?.content || ''
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
