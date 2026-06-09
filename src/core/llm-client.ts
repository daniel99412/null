import { loadConfig, DEFAULT_MODEL, CODE_MODEL, ROUTER_MODEL, DEFAULT_OLLAMA_URL } from '../config/index.js'
import { isCodeQuery } from './code-query.js'

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
    options?: { temperature?: number; think?: boolean },
  ): Promise<string>

  /** Non-streaming — for router classification and summarization */
  complete(messages: ChatMessage[]): Promise<string>
}

// ─── LLM call queue ───────────────────────────────────────────────────────────

class LLMCallQueue {
  private active = 0
  private queue: Array<() => void> = []

  constructor(private readonly maxConcurrent: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.maxConcurrent) {
      await new Promise<void>((resolve) => {
        this.queue.push(resolve)
      })
    }

    this.active += 1
    try {
      return await task()
    } finally {
      this.active -= 1
      this.queue.shift()?.()
    }
  }
}

const defaultLLMQueue = new LLMCallQueue(1)

export function runQueuedLLMCall<T>(task: () => Promise<T>): Promise<T> {
  return defaultLLMQueue.run(task)
}

// ─── Ollama implementation ────────────────────────────────────────────────────

interface OllamaChatBody {
  model: string
  stream: boolean
  messages: { role: string; content: string }[]
  think?: boolean
  options?: { temperature?: number }
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
    async streamChat(messages, onToken, options) {
      return defaultLLMQueue.run(async () => {
        const body: OllamaChatBody = {
          model,
          stream: true,
          messages,
          think: options?.think ?? false,
          ...(options?.temperature !== undefined && { options: { temperature: options.temperature } }),
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
      })
    },

    async complete(messages) {
      return defaultLLMQueue.run(async () => {
        const body: OllamaChatBody = {
          model,
          stream: false,
          messages,
          think: false,
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
      })
    },
  }
}

// ─── Singleton clients ────────────────────────────────────────────────────────

let _defaultClient: LLMClient | null = null
let _codeClient: LLMClient | null = null
let _routerClient: LLMClient | null = null

/** Returns the singleton LLMClient for main chat/summarization (uses config model). */
export function getDefaultClient(): LLMClient {
  if (!_defaultClient) {
    const config = loadConfig()
    _defaultClient = createOllamaClient({
      baseUrl: config.ollamaUrl ?? DEFAULT_OLLAMA_URL,
      model: config.model ?? DEFAULT_MODEL,
    })
  }
  return _defaultClient
}

export function getCodeClient(): LLMClient {
  if (!_codeClient) {
    const config = loadConfig()
    _codeClient = createOllamaClient({
      baseUrl: config.ollamaUrl ?? DEFAULT_OLLAMA_URL,
      model: config.codeModel ?? CODE_MODEL,
    })
  }
  return _codeClient
}

export function getModelForQuery(query: string): string {
  const config = loadConfig()
  return isCodeQuery(query)
    ? config.codeModel ?? CODE_MODEL
    : config.model ?? DEFAULT_MODEL
}

export function getClientForQuery(query: string): LLMClient {
  return isCodeQuery(query) ? getCodeClient() : getDefaultClient()
}

/** Returns the singleton LLMClient for the router (smaller/faster model). */
export function getRouterClient(): LLMClient {
  if (!_routerClient) {
    const config = loadConfig()
    _routerClient = createOllamaClient({
      baseUrl: config.ollamaUrl ?? DEFAULT_OLLAMA_URL,
      model: config.routerModel ?? ROUTER_MODEL,
    })
  }
  return _routerClient
}

/**
 * Returns a client for short sports commentary — uses the same small model
 * as the router (qwen2.5:3b) which follows constrained prompts better than
 * the larger coder model.
 */
export function getCommentaryClient(): LLMClient {
  return getRouterClient()
}

/** Invalidate cached clients (call after config change). */
export function resetClients(): void {
  _defaultClient = null
  _codeClient = null
  _routerClient = null
}
