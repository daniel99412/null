import { getDefaultClient } from './llm-client.js'

export const DEFAULT_SYSTEM_PROMPT = `You are Null, a knowledgeable AI assistant.
You are concise, accurate, and helpful.
Answer in the same language the user writes to you.

AVAILABLE TOOLS:
- get_time: Get current time (returns iso, time, date, day)
- get_location: Get current location via IP geolocation (returns city, region, country)

If you receive a [Recall] message with a summary of a previous conversation, use that context naturally.`

export async function streamChat(
  prompt: string,
  onToken: (token: string) => void,
  customMessages?: { role: string; content: string }[],
  systemPrompt?: string,
  options?: { temperature?: number },
): Promise<string> {
  const messages = customMessages || [
    {
      role: 'user',
      content: prompt,
    },
  ]

  const normalizedMessages = messages.map((m) => ({
    role: m.role as 'system' | 'user' | 'assistant',
    content: m.content,
  }))

  const hasSystemPrompt = normalizedMessages.some((m) => m.role === 'system')
  const fullMessages = hasSystemPrompt
    ? normalizedMessages
    : [
      { role: 'system' as const, content: systemPrompt || DEFAULT_SYSTEM_PROMPT },
      ...normalizedMessages,
    ]

  const client = getDefaultClient()
  return client.streamChat(fullMessages, onToken, options)
}
