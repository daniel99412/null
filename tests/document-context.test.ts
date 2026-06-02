import { mkdtemp, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveDocumentParts } from '../src/core/document-context.js'

let tmpDirs: string[] = []

afterEach(async () => {
  for (const dir of tmpDirs) {
    await rm(dir, { recursive: true, force: true })
  }
  tmpDirs = []
})

async function makeTmpDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'null-docs-'))
  tmpDirs.push(dir)
  return dir
}

describe('document context', () => {
  it('resolves a markdown @ reference into a file_context part', async () => {
    const cwd = await makeTmpDir()
    await writeFile(path.join(cwd, 'README.md'), '# Null\n\nLocal assistant docs.', 'utf-8')

    const parts = await resolveDocumentParts('resume @README.md', { cwd })

    expect(parts).toHaveLength(1)
    expect(parts[0].type).toBe('file_context')
    expect(parts[0].filename).toBe('README.md')
    expect(parts[0].mime).toBe('text/markdown')
    expect(parts[0].content).toContain('Local assistant docs.')
  })

  it('creates an inline error part for missing files', async () => {
    const cwd = await makeTmpDir()

    const parts = await resolveDocumentParts('analiza @missing.md', { cwd })

    expect(parts).toHaveLength(1)
    expect(parts[0].content).toContain('[Local file context error]')
    expect(parts[0].metadata).toHaveProperty('error')
  })

  it('creates an inline error part for unsupported files', async () => {
    const cwd = await makeTmpDir()
    await writeFile(path.join(cwd, 'image.png'), 'not real png', 'utf-8')

    const parts = await resolveDocumentParts('analiza @image.png', { cwd })

    expect(parts).toHaveLength(1)
    expect(parts[0].content).toContain('Unsupported local attachment type')
  })

  it('dedupes identical paths', async () => {
    const cwd = await makeTmpDir()
    await writeFile(path.join(cwd, 'a.md'), 'same file', 'utf-8')

    const parts = await resolveDocumentParts('compara @a.md @./a.md', { cwd })

    expect(parts).toHaveLength(1)
  })

  it('adds a truncation note when file text exceeds configured limits', async () => {
    const cwd = await makeTmpDir()
    await writeFile(path.join(cwd, 'long.md'), 'x'.repeat(20), 'utf-8')

    const parts = await resolveDocumentParts('resume @long.md', {
      cwd,
      maxCharsPerFile: 5,
      maxTotalChars: 80_000,
    })

    expect(parts).toHaveLength(1)
    expect(parts[0].content).toContain('truncated to 5 characters')
    expect(parts[0].metadata).toMatchObject({ truncated: true, includedChars: 5 })
  })
})
