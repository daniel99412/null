const DEFAULT_SYSTEM_PROMPT = `You are Null CLI, a helpful AI assistant running locally.
You are concise, accurate, and helpful.
Answer in the same language the user writes to you.`

interface OllamaRequestBody {
  model: string
  stream: boolean
  messages: { role: string; content: string }[]
}

export async function streamChat(
  prompt: string,
  onToken: (token: string) => void,
  customMessages?: { role: string; content: string }[],
  systemPrompt?: string,
): Promise<string> {
  const messages = customMessages || [
    {
      role: 'user',
      content: prompt,
    },
  ]

  const body: OllamaRequestBody = {
    model: 'qwen2.5-coder:7b',
    stream: true,
    messages: [
      { role: 'system', content: systemPrompt || DEFAULT_SYSTEM_PROMPT },
      ...messages,
    ],
  }

  const res = await fetch('http://localhost:11434/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!res.body) {
    throw new Error('No response body from Ollama')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()

  let buffer = ''
  let fullContent = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.trim()) continue

      try {
        const json = JSON.parse(line) as { message?: { content?: string } }
        const token = json.message?.content

        if (token) {
          fullContent += token
          onToken(token)
        }
      } catch {
        // ignore partial JSON
      }
    }
  }

  return fullContent
}
