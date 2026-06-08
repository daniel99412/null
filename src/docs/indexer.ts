import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getDb } from '../memory/database.js'
import { embedBatch, embeddingToBlob } from '../core/embeddings.js'
import { chunkText } from './chunker.js'
import * as textParser from './parsers/text-parser.js'
import * as pdfParser from './parsers/pdf-parser.js'
import * as docxParser from './parsers/docx-parser.js'
import * as xlsxParser from './parsers/xlsx-parser.js'

export interface IndexedDoc {
  id: string
  path: string
  filename: string
  extension: string
  size: number
  mtime: number
  indexedAt: number
}

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  'coverage', '.nyc_output', '.cache', '.vite', '.svelte-kit',
  '.serverless', '.fusebox', '.dynamodb', '.firebase',
  'vendor', '.pnpm-store', '.yarn',
])

const MAX_FILE_SIZE = 10 * 1024 * 1024

const PARSERS = [textParser, pdfParser, docxParser, xlsxParser]

function getParser(ext: string): typeof PARSERS[0] | undefined {
  return PARSERS.find((p) => p.canParse(ext))
}

function fileChecksum(filePath: string): string {
  const content = fs.readFileSync(filePath)
  return crypto.createHash('sha256').update(content).digest('hex')
}

function isBinary(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase()
  if (getParser(ext)) return false

  const BINARY_EXTS = new Set([
    '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg',
    '.woff', '.woff2', '.ttf', '.eot', '.otf',
    '.zip', '.tar', '.gz', '.bz2', '.7z', '.rar',
    '.exe', '.dll', '.so', '.dylib', '.bin',
    '.mp3', '.mp4', '.avi', '.mov', '.mkv', '.wav', '.flac',
    '.o', '.a', '.lib', '.obj',
    '.pdf', '.docx', '.xlsx', '.xls',
  ])
  return BINARY_EXTS.has(ext)
}

export function walkDir(dir: string, files: string[] = []): string[] {
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      if (IGNORE_DIRS.has(entry.name)) continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walkDir(fullPath, files)
      } else if (entry.isFile()) {
        const stat = fs.statSync(fullPath)
        if (stat.size > MAX_FILE_SIZE) continue
        if (stat.size === 0) continue
        if (isBinary(fullPath)) continue
        files.push(fullPath)
      }
    }
  } catch {
    // permission denied, skip
  }
  return files
}

export async function indexFile(filePath: string): Promise<void> {
  const stat = fs.statSync(filePath)
  const ext = path.extname(filePath).toLowerCase()
  const parser = getParser(ext)
  if (!parser) return

  const docId = crypto.createHash('sha256').update(filePath).digest('hex')
  const checksum = fileChecksum(filePath)
  const db = getDb()

  // Check if already indexed with same content
  const existing = db.prepare('SELECT checksum FROM doc_index WHERE id = ?').get(docId) as { checksum: string } | undefined
  if (existing && existing.checksum === checksum) return

  const raw = await parser.parse(filePath) as string
  const chunks = chunkText(raw)

  if (chunks.length === 0) return

  const texts = chunks.map((c) => c.content)
  const embeddings = await embedBatch(texts).catch(() => null)

  // Transactional insert
  const insertDoc = db.prepare(`
    INSERT OR REPLACE INTO doc_index (id, path, filename, extension, size, mtime, checksum, indexed_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
  `)
  const insertChunk = db.prepare(`
    INSERT OR REPLACE INTO doc_chunks (doc_id, chunk_index, content, token_count, embedding, created_at)
    VALUES (?, ?, ?, ?, ?, unixepoch())
  `)
  const deleteChunks = db.prepare('DELETE FROM doc_chunks WHERE doc_id = ?')

  const tx = db.transaction(() => {
    insertDoc.run(docId, filePath, path.basename(filePath), ext, stat.size, stat.mtimeMs, checksum, Date.now())
    deleteChunks.run(docId)
    for (let i = 0; i < chunks.length; i++) {
      insertChunk.run(
        docId,
        chunks[i].index,
        chunks[i].content,
        chunks[i].tokenCount,
        embeddings ? embeddingToBlob(embeddings[i]) : null,
      )
    }
  })
  tx()
}

export async function indexDir(dirPath: string = process.cwd()): Promise<{ files: number; chunks: number }> {
  const files = walkDir(dirPath)
  let totalChunks = 0
  for (const file of files) {
    try {
      await indexFile(file)
      const docId = crypto.createHash('sha256').update(file).digest('hex')
      const count = getDb().prepare('SELECT COUNT(*) as c FROM doc_chunks WHERE doc_id = ?').get(docId) as { c: number }
      totalChunks += count.c
    } catch (err) {
      console.error(`[index] Failed to index ${file}: ${err}`)
    }
  }
  return { files: files.length, chunks: totalChunks }
}

export function getIndexedDocs(): IndexedDoc[] {
  const db = getDb()
  return db.prepare(`
    SELECT id, path, filename, extension, size, mtime, indexed_at AS indexedAt
    FROM doc_index WHERE status = 'active' ORDER BY indexed_at DESC
  `).all() as IndexedDoc[]
}

export function removeDeletedDocs(): void {
  const db = getDb()
  const docs = db.prepare('SELECT id, path FROM doc_index WHERE status = ?').all('active') as { id: string; path: string }[]
  for (const doc of docs) {
    if (!fs.existsSync(doc.path)) {
      db.prepare('UPDATE doc_index SET status = ? WHERE id = ?').run('deleted', doc.id)
    }
  }
}
