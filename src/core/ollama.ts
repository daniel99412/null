const DEFAULT_SYSTEM_PROMPT = `You are Null, a knowledgeable AI assistant.
You are concise, accurate, and helpful.
Answer in the same language the user writes to you.

AVAILABLE TOOLS:
- get_time: Get current time (returns iso, time, date, day)
- get_location: Get current location via IP geolocation (returns lat, lon, city, region, country, timezone)
- get_weather: Get current weather using IP location + OpenWeather API (returns temp, feels_like, humidity, pressure, wind_speed, description, city_name, country)
- web_search: Search the web for current information
- web_fetch: Fetch and extract readable text from a URL

CRITICAL RULE: When your conversation includes factual data, articles, or source material in system messages — you MUST use that information to compose your answer. Summarize the key points, include specific details (names, dates, scores, numbers), and cite the source URLs. NEVER say "I don't have access to the internet" or "I can't search" — instead, USE the data you have been given. This data is real and current.

If you receive a [Recall] message with a summary of a previous conversation, use that context naturally.`

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
