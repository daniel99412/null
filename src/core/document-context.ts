import fs from 'fs/promises'
import path from 'path'
import os from 'os'

export interface DocumentContextOptions {
  cwd?: string
  maxCharsPerFile?: number
  maxTotalChars?: number
}

export interface MessagePart {
  type: 'text' | 'file_context' | 'tool_observation'
  content: string
  path?: string | null
  filename?: string | null
  mime?: string | null
  synthetic?: boolean
  metadata?: Record<string, unknown>
}

interface DocumentRef {
  raw: string
  typedPath: string
  explicitOutsideCwd: boolean
}

type ExtractedFileText =
  | { ok: true; text: string }
  | { ok: false; error: string }

const DEFAULT_MAX_CHARS_PER_FILE = 30_000
const DEFAULT_MAX_TOTAL_CHARS = 80_000

const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.json',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.py',
  '.go',
  '.rs',
  '.yaml',
  '.yml',
  '.toml',
  '.html',
  '.css',
  '.sql',
  '.log',
])

const MIME_BY_EXTENSION = new Map<string, string>([
  ['.txt', 'text/plain'],
  ['.md', 'text/markdown'],
  ['.json', 'application/json'],
  ['.ts', 'text/typescript'],
  ['.tsx', 'text/typescript'],
  ['.js', 'text/javascript'],
  ['.jsx', 'text/javascript'],
  ['.py', 'text/x-python'],
  ['.go', 'text/x-go'],
  ['.rs', 'text/x-rust'],
  ['.yaml', 'application/x-yaml'],
  ['.yml', 'application/x-yaml'],
  ['.toml', 'application/toml'],
  ['.html', 'text/html'],
  ['.css', 'text/css'],
  ['.sql', 'application/sql'],
  ['.log', 'text/plain'],
  ['.pdf', 'application/pdf'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
])

export function extractDocumentRefs(input: string): DocumentRef[] {
  const refs: DocumentRef[] = []
  const pattern = /@(?:"([^"]+)"|'([^']+)'|([^\s]+))/g
  let match: RegExpExecArray | null

  while ((match = pattern.exec(input)) !== null) {
    const typedPath = (match[1] ?? match[2] ?? match[3] ?? '').replace(/[),.;:!?]+$/u, '')
    if (!typedPath) continue
    refs.push({
      raw: match[0],
      typedPath,
      explicitOutsideCwd: path.isAbsolute(typedPath) || typedPath.startsWith('~/'),
    })
  }

  return refs
}

export function hasDocumentRefs(input: string): boolean {
  return extractDocumentRefs(input).length > 0
}

export async function resolveDocumentParts(
  input: string,
  options: DocumentContextOptions = {},
): Promise<MessagePart[]> {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const maxCharsPerFile = options.maxCharsPerFile ?? DEFAULT_MAX_CHARS_PER_FILE
  const maxTotalChars = options.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS
  const refs = extractDocumentRefs(input)
  const seen = new Set<string>()
  const parts: MessagePart[] = []
  let remainingTotal = maxTotalChars

  for (const ref of refs) {
    const resolvedPath = resolveTypedPath(ref.typedPath, cwd)
    if (seen.has(resolvedPath)) continue
    seen.add(resolvedPath)

    const filename = path.basename(resolvedPath)
    const ext = path.extname(resolvedPath).toLowerCase()
    const mime = MIME_BY_EXTENSION.get(ext) ?? 'application/octet-stream'

    if (!ref.explicitOutsideCwd && isOutsideDirectory(resolvedPath, cwd)) {
      parts.push(errorPart(resolvedPath, filename, mime, `Relative @ paths must stay inside ${cwd}. Use an absolute path or ~/ path if you want to attach a file outside the project.`))
      continue
    }

    if (remainingTotal <= 0) {
      parts.push(errorPart(resolvedPath, filename, mime, `Skipped because the total document context limit of ${maxTotalChars} characters was reached.`))
      continue
    }

    const extracted = await extractFileText(resolvedPath, ext)
    if (!extracted.ok) {
      parts.push(errorPart(resolvedPath, filename, mime, extracted.error))
      continue
    }

    const rawText = extracted.text
    const limit = Math.min(maxCharsPerFile, remainingTotal)
    const truncated = rawText.length > limit
    const includedText = rawText.slice(0, limit)
    remainingTotal -= includedText.length

    const header = [
      '[Local file context]',
      `Filename: ${filename}`,
      `Path: ${resolvedPath}`,
      `Type: ${mime}`,
      `Extracted characters: ${rawText.length}`,
      truncated ? `Note: This file was truncated to ${includedText.length} characters. Do not infer missing content.` : null,
      '',
    ].filter(Boolean).join('\n')

    parts.push({
      type: 'file_context',
      content: `${header}${includedText}`,
      path: resolvedPath,
      filename,
      mime,
      synthetic: true,
      metadata: {
        originalRef: ref.raw,
        extractedChars: rawText.length,
        includedChars: includedText.length,
        truncated,
      },
    })
  }

  return parts
}

function resolveTypedPath(typedPath: string, cwd: string): string {
  if (typedPath.startsWith('~/')) {
    return path.resolve(os.homedir(), typedPath.slice(2))
  }
  if (path.isAbsolute(typedPath)) {
    return path.resolve(typedPath)
  }
  return path.resolve(cwd, typedPath)
}

function isOutsideDirectory(filePath: string, directory: string): boolean {
  const relative = path.relative(directory, filePath)
  return relative.startsWith('..') || path.isAbsolute(relative)
}

async function extractFileText(filePath: string, ext: string): Promise<ExtractedFileText> {
  try {
    if (TEXT_EXTENSIONS.has(ext)) {
      return { ok: true, text: await fs.readFile(filePath, 'utf-8') }
    }

    if (ext === '.pdf') {
      const pdfParseModule = await import('pdf-parse')
      const pdfParse = pdfParseModule.default ?? pdfParseModule
      const buffer = await fs.readFile(filePath)
      const parsed = await pdfParse(buffer)
      return { ok: true, text: parsed.text ?? '' }
    }

    if (ext === '.docx') {
      const mammoth = await import('mammoth')
      const result = await mammoth.extractRawText({ path: filePath })
      return { ok: true, text: result.value ?? '' }
    }

    return { ok: false, error: `Unsupported local attachment type "${ext || 'unknown'}". Supported v1 formats are text-like files, PDF, and DOCX.` }
  } catch (err) {
    return { ok: false, error: `Could not read local attachment: ${err instanceof Error ? err.message : String(err)}` }
  }
}

function errorPart(filePath: string, filename: string, mime: string, message: string): MessagePart {
  return {
    type: 'file_context',
    content: [
      '[Local file context error]',
      `Filename: ${filename}`,
      `Path: ${filePath}`,
      `Type: ${mime}`,
      `Error: ${message}`,
    ].join('\n'),
    path: filePath,
    filename,
    mime,
    synthetic: true,
    metadata: { error: message },
  }
}
