import { mkdtemp, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildFileScopedHistory, resolveDocumentParts } from '../src/core/document-context.js'

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

  it('marks short extracted text as a valid read', async () => {
    const cwd = await makeTmpDir()
    await writeFile(path.join(cwd, 'short.txt'), 'one line', 'utf-8')

    const parts = await resolveDocumentParts('resume @short.txt', { cwd })

    expect(parts).toHaveLength(1)
    expect(parts[0].content).toContain('Read status: OK')
    expect(parts[0].content).toContain('Truncated: no')
    expect(parts[0].content).toContain('contains only a small amount of text')
    expect(parts[0].content).toContain('1 | one line')
    expect(parts[0].metadata).toMatchObject({ readStatus: 'OK', selectionKind: 'full' })
  })

  it('adds synthetic line numbers so exact line questions can be answered', async () => {
    const cwd = await makeTmpDir()
    await writeFile(path.join(cwd, 'code.ts'), ['const a = 1', 'const b = 2', 'const c = 3'].join('\n'), 'utf-8')

    const parts = await resolveDocumentParts('que hay en la linea 2 de @code.ts', { cwd })

    expect(parts).toHaveLength(1)
    expect(parts[0].content).toContain('Content below is numbered with synthetic 1-based line numbers')
    expect(parts[0].content).toContain('2 | const b = 2')
    expect(parts[0].metadata).toMatchObject({ requestedLine: 2, selectionKind: 'line_window' })
  })

  it('shows the exact requested line window instead of only the file beginning', async () => {
    const cwd = await makeTmpDir()
    const lines = Array.from({ length: 120 }, (_, index) => `line ${index + 1}`)
    await writeFile(path.join(cwd, 'long.tsx'), lines.join('\n'), 'utf-8')

    const parts = await resolveDocumentParts('que hay en la linea 57 de @long.tsx', { cwd })

    expect(parts).toHaveLength(1)
    expect(parts[0].content).toContain('Showing this window because the user asked about line 57')
    expect(parts[0].content).toContain('57 | line 57')
    expect(parts[0].content).not.toContain('1 | line 1')
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

  it('does not carry content from a previous attachment into the next attachment context', async () => {
    const cwd = await makeTmpDir()
    await writeFile(path.join(cwd, 'a.md'), 'alpha-only content', 'utf-8')
    await writeFile(path.join(cwd, 'b.md'), 'bravo-only content', 'utf-8')

    const first = await resolveDocumentParts('que dice @a.md?', { cwd })
    const second = await resolveDocumentParts('y ahora que dice @b.md?', { cwd })

    expect(first[0].content).toContain('alpha-only content')
    expect(second[0].content).toContain('bravo-only content')
    expect(second[0].content).not.toContain('alpha-only content')
  })

  it('filters prior attachment turns from file-scoped history by default', () => {
    const history = buildFileScopedHistory([
      { role: 'user', content: 'que dice @a.md?' },
      { role: 'assistant', content: '[Attached local files]\nalpha-only content' },
      { role: 'user', content: 'mi tono preferido es directo' },
      { role: 'assistant', content: 'Entendido.' },
    ], { maxMessages: 4 })

    expect(history).toEqual([
      { role: 'user', content: 'mi tono preferido es directo' },
      { role: 'assistant', content: 'Entendido.' },
    ])
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
