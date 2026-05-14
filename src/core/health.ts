export interface OllamaHealth {
  available: boolean
  models: string[]
  latencyMs: number
}

export interface InternetHealth {
  available: boolean
}

export interface HealthStatus {
  ollama: OllamaHealth
  internet: InternetHealth
}

interface OllamaTagsResponse {
  models?: { name: string }[]
}

/**
 * Check if Ollama is running and list available models.
 */
async function checkOllama(timeoutMs: number): Promise<OllamaHealth> {
  const start = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch('http://localhost:11434/api/tags', {
      signal: controller.signal,
    })
    clearTimeout(timer)
    const latencyMs = Date.now() - start

    if (!res.ok) {
      return { available: false, models: [], latencyMs }
    }

    const data = await res.json() as OllamaTagsResponse
    const models = (data.models ?? []).map((m) => m.name)
    return { available: true, models, latencyMs }
  } catch {
    clearTimeout(timer)
    return { available: false, models: [], latencyMs: Date.now() - start }
  }
}

/**
 * Check if internet is available by pinging a reliable host.
 */
async function checkInternet(timeoutMs: number): Promise<InternetHealth> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch('https://1.1.1.1', {
      method: 'HEAD',
      signal: controller.signal,
    })
    clearTimeout(timer)
    return { available: res.ok || res.status < 500 }
  } catch {
    clearTimeout(timer)
    return { available: false }
  }
}

/**
 * Run all health checks with a shared timeout budget.
 */
export async function checkHealth(timeoutMs = 2000): Promise<HealthStatus> {
  const [ollama, internet] = await Promise.all([
    checkOllama(timeoutMs),
    checkInternet(timeoutMs),
  ])

  return { ollama, internet }
}

/**
 * Poll Ollama until it's available or max retries are exhausted.
 * Returns true if Ollama became available, false if it timed out.
 */
export async function waitForOllama(maxRetries = 5, intervalMs = 1000): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    const health = await checkOllama(intervalMs)
    if (health.available) return true
    if (i < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, intervalMs))
    }
  }
  return false
}
