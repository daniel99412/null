import { getDb } from '../memory/database.js'
import { embed, cosineSimilarity, blobToEmbedding } from '../core/embeddings.js'

export interface SearchResult {
  docId: string
  docPath: string
  filename: string
  chunkIndex: number
  content: string
  score: number
  tokenCount: number
}

const MAX_RESULTS = 5
const MIN_SCORE = 0.4

export async function searchDocs(query: string): Promise<SearchResult[]> {
  const queryVec = await embed(query)
  const db = getDb()

  const rows = db.prepare(`
    SELECT c.doc_id, c.chunk_index, c.content, c.token_count, c.embedding,
           d.path, d.filename
    FROM doc_chunks c
    JOIN doc_index d ON d.id = c.doc_id
    WHERE d.status = 'active' AND c.embedding IS NOT NULL
  `).all() as Array<{
    doc_id: string
    chunk_index: number
    content: string
    token_count: number
    embedding: Buffer
    path: string
    filename: string
  }>

  if (rows.length === 0) return []

  const scored: Array<SearchResult & { score: number }> = []

  for (const row of rows) {
    const vec = blobToEmbedding(row.embedding)
    const score = cosineSimilarity(queryVec, vec)
    if (score >= MIN_SCORE) {
      scored.push({
        docId: row.doc_id,
        docPath: row.path,
        filename: row.filename,
        chunkIndex: row.chunk_index,
        content: row.content,
        tokenCount: row.token_count,
        score,
      })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, MAX_RESULTS)
}

export async function searchDocsByKeyword(query: string): Promise<SearchResult[]> {
  const db = getDb()
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return []

  const conditions = terms.map(() => 'c.content LIKE ?')
  const params = terms.map((t) => `%${t}%`)
  const sql = `
    SELECT c.doc_id, c.chunk_index, c.content, c.token_count,
           d.path, d.filename
    FROM doc_chunks c
    JOIN doc_index d ON d.id = c.doc_id
    WHERE d.status = 'active' AND ${conditions.join(' AND ')}
    ORDER BY c.token_count ASC
    LIMIT ?
  `

  const rows = db.prepare(sql).all(...params, MAX_RESULTS) as Array<{
    doc_id: string
    chunk_index: number
    content: string
    token_count: number
    path: string
    filename: string
  }>

  return rows.map((r) => ({
    docId: r.doc_id,
    docPath: r.path,
    filename: r.filename,
    chunkIndex: r.chunk_index,
    content: r.content,
    tokenCount: r.token_count,
    score: 1.0,
  }))
}

export async function searchDocsHybrid(query: string): Promise<SearchResult[]> {
  const [semantic, keyword] = await Promise.all([
    searchDocs(query).catch(() => [] as SearchResult[]),
    searchDocsByKeyword(query),
  ])
  const seen = new Set<string>()
  const merged: SearchResult[] = []
  for (const r of [...semantic, ...keyword]) {
    const key = `${r.docId}:${r.chunkIndex}`
    if (!seen.has(key)) {
      seen.add(key)
      merged.push(r)
    }
  }
  merged.sort((a, b) => b.score - a.score)
  return merged.slice(0, MAX_RESULTS)
}

export interface DocContext {
  query: string
  results: SearchResult[]
}

export function buildDocContext(results: SearchResult[]): string {
  if (results.length === 0) return ''
  const lines: string[] = ['[Project documentation context]']
  for (const r of results) {
    lines.push(`\nFrom ${r.filename} (chunk ${r.chunkIndex}):`)
    lines.push(r.content)
  }
  return lines.join('\n')
}
