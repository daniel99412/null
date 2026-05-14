import { loadConfig, DEFAULT_MODEL, ROUTER_MODEL } from '../config/index.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LLMClient {
  /** Streaming — yields tokens via callback, returns full response */
  streamChat(
    messages: ChatMessage[],
    onToken: (token: string) => void,
  ): Promise<string>

  /** Non-streaming — for router classification and summarization */
  complete(messages: ChatMessage[]): Promise<string>
}

// ─── Ollama implementation ────────────────────────────────────────────────────

interface OllamaChatBody {
  model: string
  stream: boolean
  messages: { role: string; content: string }[]
}

interface OllamaStreamChunk {
  message?: { content?: string }
}

interface OllamaCompleteResponse {
  message?: { content?: string }
}

export function createOllamaClient(options: {
  baseUrl: string
  model: string
}): LLMClient {
  const { baseUrl, model } = options
  const endpoint = `${baseUrl}/api/chat`

  return {
    async streamChat(messages, onToken) {
      const body: OllamaChatBody = {
        model,
        stream: true,
        messages,
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
            const json = JSON.parse(line) as OllamaStreamChunk
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
    },

    async complete(messages) {
      const body: OllamaChatBody = {
        model,
        stream: false,
        messages,
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        throw new Error(`Ollama request failed: ${res.status}`)
      }

      const data = await res.json() as OllamaCompleteResponse
      return data.message?.content || ''
    },
  }
}

// ─── Singleton clients ────────────────────────────────────────────────────────

let _defaultClient: LLMClient | null = null
let _routerClient: LLMClient | null = null

/** Returns the singleton LLMClient for main chat/summarization (uses config model). */
export function getDefaultClient(): LLMClient {
  if (!_defaultClient) {
    const config = loadConfig()
    _defaultClient = createOllamaClient({
      baseUrl: 'http://localhost:11434',
      model: config.model ?? DEFAULT_MODEL,
    })
  }
  return _defaultClient
}

/** Returns the singleton LLMClient for the router (smaller/faster model). */
export function getRouterClient(): LLMClient {
  if (!_routerClient) {
    _routerClient = createOllamaClient({
      baseUrl: 'http://localhost:11434',
      model: ROUTER_MODEL,
    })
  }
  return _routerClient
}

/** Invalidate cached clients (call after config change). */
export function resetClients(): void {
  _defaultClient = null
  _routerClient = null
}
