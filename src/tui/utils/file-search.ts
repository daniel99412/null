import fs from 'fs'
import path from 'path'

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt',
  'coverage', '.nyc_output', '.cache', '.vite', '.svelte-kit',
  '.serverless', '.fusebox', '.dynamodb', '.firebase',
  'vendor', '.pnpm-store', '.yarn',
])

const MAX_DEPTH = 5

interface FileEntry {
  name: string
  relativePath: string
}

function walk(dir: string, depth: number, pattern: string, results: FileEntry[]): void {
  if (depth > MAX_DEPTH) return
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue
      if (IGNORE_DIRS.has(entry.name)) continue
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1, pattern, results)
      } else {
        const relativePath = path.relative(process.cwd(), fullPath)
        if (!pattern || relativePath.toLowerCase().includes(pattern.toLowerCase())) {
          results.push({ name: entry.name, relativePath })
        }
      }
    }
  } catch {
    // Permission denied, skip
  }
}

export function searchFiles(pattern: string): FileEntry[] {
  const results: FileEntry[] = []
  walk(process.cwd(), 0, pattern, results)
  return results.slice(0, 20)
}
