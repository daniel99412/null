import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import * as textParser from '../docs/parsers/text-parser.js'
import * as pdfParser from '../docs/parsers/pdf-parser.js'
import * as docxParser from '../docs/parsers/docx-parser.js'
import * as xlsxParser from '../docs/parsers/xlsx-parser.js'

const DEFAULT_MAX_CHARS_PER_FILE = 30_000
const DEFAULT_MAX_TOTAL_CHARS = 80_000
const SMALL_FILE_MAX_CHARS = 18_000
const LINE_WINDOW_RADIUS = 20
const SEMANTIC_WINDOW_RADIUS = 5
const OVERVIEW_LINE_LIMIT = 80

const PARSERS = [textParser, pdfParser, docxParser, xlsxParser]

const MIME_BY_EXTENSION = new Map<string, string>([
  ['.txt', 'text/plain'],
  ['.md', 'text/markdown'],
  ['.json', 'application/json'],
  ['.xml', 'application/xml'],
  ['.yaml', 'application/x-yaml'],
  ['.yml', 'application/x-yaml'],
  ['.html', 'text/html'],
  ['.log', 'text/plain'],
  ['.env', 'text/plain'],
  ['.toml', 'application/toml'],
  ['.ini', 'text/plain'],
  ['.cfg', 'text/plain'],
  ['.conf', 'text/plain'],
  ['.csv', 'text/csv'],
  ['.tsv', 'text/tab-separated-values'],
  ['.js', 'text/javascript'],
  ['.ts', 'text/typescript'],
  ['.jsx', 'text/javascript'],
  ['.tsx', 'text/typescript'],
  ['.css', 'text/css'],
  ['.scss', 'text/css'],
  ['.less', 'text/css'],
  ['.sh', 'text/x-shellscript'],
  ['.bash', 'text/x-shellscript'],
  ['.zsh', 'text/x-shellscript'],
  ['.py', 'text/x-python'],
  ['.rb', 'text/x-ruby'],
  ['.go', 'text/x-go'],
  ['.rs', 'text/x-rust'],
  ['.java', 'text/x-java-source'],
  ['.c', 'text/x-c'],
  ['.cpp', 'text/x-c++'],
  ['.h', 'text/x-c'],
  ['.hpp', 'text/x-c++'],
  ['.sql', 'application/sql'],
  ['.svg', 'image/svg+xml'],
  ['.mjs', 'text/javascript'],
  ['.cjs', 'text/javascript'],
  ['.pdf', 'application/pdf'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.xls', 'application/vnd.ms-excel'],
])

export interface DocumentRef {
  raw: string
  typedPath: string
  explicitOutsideCwd: boolean
}

export interface DocumentPart {
  type: 'file_context'
  content: string
  path: string
  filename: string
  mime: string
  synthetic: true
  metadata: {
    readStatus?: 'OK' | 'ERROR'
    originalRef?: string
    extractedChars?: number
    extractedLines?: number
    includedChars?: number
    includedLines?: number
    truncated?: boolean
    selectionKind?: DocumentSelectionKind
    requestedLine?: number
    windowStartLine?: number
    windowEndLine?: number
    error?: string
  }
}

export type DocumentSelectionKind = 'full' | 'line_window' | 'overview' | 'semantic'

export interface FileScopedHistoryOptions {
  maxMessages?: number
  maxCharsPerMessage?: number
}

interface ResolveDocumentOptions {
  cwd?: string
  maxCharsPerFile?: number
  maxTotalChars?: number
}

interface ExtractResult {
  ok: boolean
  text?: string
  error?: string
}

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

export function stripDocumentRefs(input: string): string {
  return input
    .replace(/@(?:"([^"]+)"|'([^']+)'|([^\s]+))/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function resolveDocumentParts(
  input: string,
  options: ResolveDocumentOptions = {},
): Promise<DocumentPart[]> {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const maxCharsPerFile = options.maxCharsPerFile ?? DEFAULT_MAX_CHARS_PER_FILE
  const maxTotalChars = options.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS
  const refs = extractDocumentRefs(input)
  const requestedLine = extractRequestedLine(input)
  const seen = new Set<string>()
  const parts: DocumentPart[] = []
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
      parts.push(errorPart(resolvedPath, filename, mime, extracted.error ?? 'Unknown read error.'))
      continue
    }

    const rawText = extracted.text ?? ''
    const limit = Math.min(maxCharsPerFile, remainingTotal)
    const selection = selectDocumentText(rawText, input, limit, requestedLine)
    remainingTotal -= selection.includedChars

    const header = [
      '[Local file context]',
      'Read status: OK',
      `Filename: ${filename}`,
      `Path: ${resolvedPath}`,
      `Type: ${mime}`,
      `Extracted characters: ${rawText.length}`,
      `Extracted lines: ${selection.extractedLines}`,
      `Included characters: ${selection.includedChars}`,
      `Included lines: ${selection.includedLines}`,
      `Truncated: ${selection.truncated ? 'yes' : 'no'}`,
      `Selection: ${selection.kind}`,
      'Content below is numbered with synthetic 1-based line numbers in the form "N | text". These numbers refer to the extracted text shown here.',
      selection.firstLineNumber && selection.firstLineNumber > 1 ? `Line numbering starts at original extracted line ${selection.firstLineNumber}.` : null,
      selection.windowStartLine && selection.windowEndLine ? `Window shown: extracted lines ${selection.windowStartLine}-${selection.windowEndLine}.` : null,
      selection.kind === 'line_window' ? `Showing this window because the user asked about line ${requestedLine}.` : null,
      selection.kind === 'overview' ? 'Showing the beginning of the file plus relevant excerpts because the file is too large to include in full.' : null,
      selection.kind === 'semantic' ? 'Showing keyword-relevant excerpts because the file is too large to include in full.' : null,
      rawText.trim().length === 0 ? 'Note: The file was read successfully but extracted text is empty.' : null,
      rawText.trim().length > 0 && rawText.trim().length < 80 ? 'Note: The file was read successfully and contains only a small amount of text; do not treat that as an extraction error.' : null,
      selection.truncated ? `Note: This file was truncated to ${selection.includedChars} characters. Do not infer missing content.` : null,
    ].filter(Boolean).join('\n')

    parts.push({
      type: 'file_context',
      content: `${header}\n\n${selection.numberedText}`,
      path: resolvedPath,
      filename,
      mime,
      synthetic: true,
      metadata: {
        readStatus: 'OK',
        originalRef: ref.raw,
        extractedChars: rawText.length,
        extractedLines: selection.extractedLines,
        includedChars: selection.includedChars,
        includedLines: selection.includedLines,
        truncated: selection.truncated,
        selectionKind: selection.kind,
        requestedLine: requestedLine ?? undefined,
        windowStartLine: selection.windowStartLine,
        windowEndLine: selection.windowEndLine,
      },
    })
  }

  return parts
}

export function buildDocumentContextMessage(parts: DocumentPart[]): string {
  return [
    '[Attached local files]',
    'Attachment mode is active. The current attached local file blocks below are the primary and authoritative source for this answer. Ignore prior conversation content about other files unless the current user explicitly asks to compare with it. Do not say you cannot read PDFs, files, or local documents. Only report a read/extraction error if the file block explicitly says "[Local file context error]". If a file says "Read status: OK", treat the extracted text as valid even when it is short. Never invent extraction problems. When the user asks for a specific line number, answer from the matching "N | text" line exactly.',
    '',
    ...parts.map((part) => part.content),
  ].join('\n\n')
}

export function buildDocumentResponseInstruction(userQuestion: string): string {
  return [
    isSpanish(userQuestion)
      ? 'Reply in Spanish because the user wrote in Spanish.'
      : 'Reply in the same language the user used.',
    'Use the attached local file context above as the primary source.',
    'Do not say you cannot read PDFs, files, or local documents; they have already been read and converted to text.',
    'Only mention read errors if the file block explicitly says "[Local file context error]".',
    'If the file says "Read status: OK", the extracted text is valid even when it is short.',
    'If the user asks for a specific line, answer from the exact numbered "N | text" line.',
    'If the shown excerpt is not enough to answer, say so without inventing content outside the excerpt.',
    'If the user asks what it is about, summarize the central topic and key points.',
  ].join(' ')
}

export function buildFileScopedHistory(
  history: { role: string; content: string }[],
  options: FileScopedHistoryOptions = {},
): { role: string; content: string }[] {
  const maxMessages = options.maxMessages ?? 0
  const maxCharsPerMessage = options.maxCharsPerMessage ?? 500
  if (maxMessages <= 0) return []

  return history
    .filter((message) => {
      const content = message.content.trim()
      if (!content) return false
      if (content.includes('[Attached local files]')) return false
      if (content.includes('[Local file context]')) return false
      if (content.includes('[Local file context error]')) return false
      if (/@(?:"[^"]+"|'[^']+'|[^\s]+)/.test(content)) return false
      if (/^\[Tool result for read_doc\]/i.test(content)) return false
      return content.length <= maxCharsPerMessage
    })
    .slice(-maxMessages)
    .map((message) => ({
      role: message.role,
      content: message.content,
    }))
}

function isSpanish(text: string): boolean {
  return /\b(me|puedes|podr[ií]as|decir|dime|qu[eé]|dice|trata|sobre|archivo|documento|resumen|resume|espa[nñ]ol|hola|gracias|por favor|porfa|cu[aá]l|c[oó]mo|d[oó]nde|qui[eé]n)\b/i.test(text)
}

function addLineNumbers(lines: string[], firstLineNumber = 1): string {
  const lastLineNumber = firstLineNumber + Math.max(0, lines.length - 1)
  const width = String(lastLineNumber).length
  return lines
    .map((line, index) => `${String(firstLineNumber + index).padStart(width, ' ')} | ${line}`)
    .join('\n')
}

function countLines(text: string): number {
  if (text.length === 0) return 0
  return text.split(/\r?\n/).length
}

function extractRequestedLine(input: string): number | null {
  const match = input.match(/\b(?:l[ií]nea|line)\s+(\d{1,7})\b/i)
  if (!match) return null
  const line = Number.parseInt(match[1], 10)
  return Number.isFinite(line) && line > 0 ? line : null
}

interface NumberedSegment {
  startLine: number
  lines: string[]
}

interface TextSelection {
  numberedText: string
  includedChars: number
  includedLines: number
  extractedLines: number
  truncated: boolean
  kind: DocumentSelectionKind
  firstLineNumber?: number
  windowStartLine?: number
  windowEndLine?: number
}

function selectDocumentText(
  text: string,
  query: string,
  limit: number,
  requestedLine: number | null,
): TextSelection {
  if (requestedLine) {
    return selectLineWindow(text, requestedLine, limit)
  }

  if (text.length <= limit && text.length <= SMALL_FILE_MAX_CHARS) {
    return selectAllText(text)
  }

  const keywords = extractQueryKeywords(stripDocumentRefs(query))
  if (isGeneralFileQuestion(query)) {
    return selectOverviewText(text, limit, keywords)
  }

  return selectSemanticWindows(text, limit, keywords)
}

function selectAllText(text: string): TextSelection {
  const lines = text.split(/\r?\n/)
  return {
    numberedText: addLineNumbers(lines, 1),
    includedChars: text.length,
    includedLines: countLines(text),
    extractedLines: countLines(text),
    truncated: false,
    kind: 'full',
    firstLineNumber: 1,
  }
}

function selectLineWindow(text: string, targetLine: number, limit: number): TextSelection {
  const lines = text.split(/\r?\n/)
  if (targetLine > lines.length) {
    return selectOverviewText(text, limit, [])
  }

  let startIndex = Math.max(0, targetLine - 1 - LINE_WINDOW_RADIUS)
  let endIndex = Math.min(lines.length, targetLine + LINE_WINDOW_RADIUS)
  let selected = lines.slice(startIndex, endIndex).join('\n')

  while (selected.length > limit && endIndex - startIndex > 1) {
    const removeBefore = (targetLine - 1) - startIndex > endIndex - targetLine
    if (removeBefore) {
      startIndex++
    } else {
      endIndex--
    }
    selected = lines.slice(startIndex, endIndex).join('\n')
  }

  const selectedLines = lines.slice(startIndex, endIndex)
  return {
    numberedText: addLineNumbers(selectedLines, startIndex + 1),
    includedChars: selected.slice(0, limit).length,
    includedLines: selectedLines.length,
    extractedLines: lines.length,
    firstLineNumber: startIndex + 1,
    truncated: selected.length > limit || startIndex > 0 || endIndex < lines.length,
    kind: 'line_window',
    windowStartLine: startIndex + 1,
    windowEndLine: endIndex,
  }
}

function selectOverviewText(text: string, limit: number, keywords: string[]): TextSelection {
  const lines = text.split(/\r?\n/)
  const overviewEnd = Math.min(lines.length, OVERVIEW_LINE_LIMIT)
  const segments: NumberedSegment[] = [{ startLine: 1, lines: lines.slice(0, overviewEnd) }]
  const remainingLimit = Math.max(0, limit - segmentsToText(segments).length)

  if (remainingLimit > 600 && keywords.length > 0) {
    const semantic = buildRelevantSegments(lines, keywords, remainingLimit)
    segments.push(...semantic.filter((segment) => segment.startLine > overviewEnd))
  }

  return buildSegmentSelection(text, lines, segments, limit, 'overview')
}

function selectSemanticWindows(text: string, limit: number, keywords: string[]): TextSelection {
  const lines = text.split(/\r?\n/)
  const segments = buildRelevantSegments(lines, keywords, limit)
  if (segments.length === 0) {
    return selectOverviewText(text, limit, keywords)
  }
  return buildSegmentSelection(text, lines, segments, limit, 'semantic')
}

function buildRelevantSegments(lines: string[], keywords: string[], limit: number): NumberedSegment[] {
  if (keywords.length === 0) return []

  const scored = lines
    .map((line, index) => ({
      index,
      score: keywords.reduce((sum, keyword) => {
        const re = new RegExp(escapeRegExp(keyword), 'ig')
        return sum + (line.match(re)?.length ?? 0)
      }, 0),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)

  const intervals: Array<{ start: number; end: number }> = []
  for (const item of scored.slice(0, 12)) {
    intervals.push({
      start: Math.max(0, item.index - SEMANTIC_WINDOW_RADIUS),
      end: Math.min(lines.length, item.index + SEMANTIC_WINDOW_RADIUS + 1),
    })
  }

  intervals.sort((a, b) => a.start - b.start)
  const merged: Array<{ start: number; end: number }> = []
  for (const interval of intervals) {
    const last = merged[merged.length - 1]
    if (last && interval.start <= last.end + 1) {
      last.end = Math.max(last.end, interval.end)
    } else {
      merged.push({ ...interval })
    }
  }

  const segments: NumberedSegment[] = []
  let used = 0
  for (const interval of merged) {
    const segmentLines = lines.slice(interval.start, interval.end)
    const segmentChars = segmentLines.join('\n').length
    if (used + segmentChars > limit && segments.length > 0) break
    segments.push({ startLine: interval.start + 1, lines: segmentLines })
    used += segmentChars
  }

  return segments
}

function buildSegmentSelection(
  fullText: string,
  allLines: string[],
  segments: NumberedSegment[],
  limit: number,
  kind: DocumentSelectionKind,
): TextSelection {
  const normalized = trimSegmentsToLimit(segments, limit)
  const numberedText = segmentsToText(normalized)
  const includedChars = normalized.reduce((sum, segment) => sum + segment.lines.join('\n').length, 0)
  const includedLines = normalized.reduce((sum, segment) => sum + segment.lines.length, 0)
  const first = normalized[0]
  const last = normalized[normalized.length - 1]

  return {
    numberedText,
    includedChars,
    includedLines,
    extractedLines: allLines.length,
    truncated: fullText.length > includedChars,
    kind,
    firstLineNumber: first?.startLine,
    windowStartLine: normalized.length === 1 ? first?.startLine : undefined,
    windowEndLine: normalized.length === 1 && last ? last.startLine + last.lines.length - 1 : undefined,
  }
}

function trimSegmentsToLimit(segments: NumberedSegment[], limit: number): NumberedSegment[] {
  const result: NumberedSegment[] = []
  let used = 0

  for (const segment of segments) {
    const kept: string[] = []
    for (const line of segment.lines) {
      const nextUsed = used + line.length + 1
      if (nextUsed > limit && kept.length > 0) break
      if (nextUsed > limit && result.length > 0) break
      if (nextUsed > limit) {
        const remaining = Math.max(0, limit - used)
        if (remaining > 0) {
          kept.push(line.slice(0, remaining))
          used += remaining
        }
        break
      }
      kept.push(line)
      used = nextUsed
      if (used >= limit) break
    }
    if (kept.length > 0) {
      result.push({ startLine: segment.startLine, lines: kept })
    }
    if (used >= limit) break
  }

  return result
}

function segmentsToText(segments: NumberedSegment[]): string {
  return segments
    .map((segment) => addLineNumbers(segment.lines, segment.startLine))
    .join('\n\n--- excerpt break ---\n\n')
}

function isGeneralFileQuestion(input: string): boolean {
  return /\b(resume|resumen|summari[sz]e|summary|qu[eé]\s+dice|de\s+qu[eé]\s+trata|what\s+(does|is)|about|overview|explica|describe)\b/i.test(input)
}

function extractQueryKeywords(input: string): string[] {
  const stopwords = new Set([
    'que', 'qué', 'dice', 'hay', 'linea', 'línea', 'archivo', 'documento', 'resume', 'resumen',
    'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'en', 'por', 'para', 'con', 'and', 'the',
    'what', 'does', 'this', 'file', 'document', 'about', 'summarize', 'summary', 'line',
  ])

  const words = input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .match(/[a-z0-9_.$/-]{3,}/g) ?? []

  return [...new Set(words.filter((word) => !stopwords.has(word) && !word.includes('/')))].slice(0, 12)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

async function extractFileText(filePath: string, ext: string): Promise<ExtractResult> {
  try {
    const stat = await fs.stat(filePath)
    if (!stat.isFile()) {
      return { ok: false, error: 'Local attachment is not a file.' }
    }

    const parser = PARSERS.find((p) => p.canParse(ext))
    if (!parser) {
      return { ok: false, error: `Unsupported local attachment type "${ext || 'unknown'}". Supported formats are text-like files, PDF, DOCX, XLSX, and CSV.` }
    }

    const text = await parser.parse(filePath)
    return { ok: true, text }
  } catch (err) {
    return { ok: false, error: `Could not read local attachment: ${err instanceof Error ? err.message : String(err)}` }
  }
}

function errorPart(filePath: string, filename: string, mime: string, message: string): DocumentPart {
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
    metadata: { readStatus: 'ERROR', error: message },
  }
}
