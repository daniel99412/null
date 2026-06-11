import { getDefaultClient } from './llm-client.js'
import { debugLog } from '../utils/debug.js'

export async function buildNewsIntro(query: string, count: number): Promise<string> {
  const client = getDefaultClient()
  const systemPrompt = [
    'You write short terminal-friendly status messages.',
    'Reply in the same language as the user query.',
    'Write exactly one sentence.',
    `Mention that you gathered ${count} news items for today.`,
    'Do not use bullet points.',
    'Do not mention URLs.',
    'Do not mention "cards".',
    'Keep it under 22 words if possible.',
  ].join(' ')

  try {
    const text = await client.complete([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: query },
    ])
    const cleaned = text.replace(/\s+/g, ' ').trim()
    if (cleaned.length > 0 && cleaned.length <= 220) return cleaned
  } catch (err) {
    debugLog(`[news-intro] LLM intro failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  return fallbackIntro(query, count)
}

function fallbackIntro(query: string, count: number): string {
  const topic = query.trim() || 'news'
  return `Saqué ${count} noticias de hoy sobre ${topic}.`
}
