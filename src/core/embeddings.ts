import { loadConfig, DEFAULT_OLLAMA_URL } from '../config/index.js'

const EMBEDDING_MODEL = 'nomic-embed-text'

interface OllamaEmbeddingResponse {
  embedding: number[]
}

let _baseUrl = DEFAULT_OLLAMA_URL

function getBaseUrl(): string {
  const config = loadConfig()
  return config.ollamaUrl ?? DEFAULT_OLLAMA_URL
}

export function getEmbeddingModel(): string {
  return EMBEDDING_MODEL
}

const embedCache = new Map<string, Float32Array>()

export async function embed(text: string): Promise<Float32Array> {
  const cached = embedCache.get(text)
  if (cached) return cached

  const baseUrl = getBaseUrl()
  const res = await fetch(`${baseUrl}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: text }),
  })

  if (!res.ok) {
    throw new Error(`Embedding failed: ${res.status} ${res.statusText}`)
  }

  const data = await res.json() as OllamaEmbeddingResponse
  const vec = new Float32Array(data.embedding)
  embedCache.set(text, vec)
  return vec
}

export async function embedBatch(texts: string[]): Promise<Float32Array[]> {
  return Promise.all(texts.map((t) => embed(t)))
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

export function embeddingToBlob(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer)
}

export function blobToEmbedding(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
}
