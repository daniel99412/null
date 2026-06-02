const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/**
 * Fetch a web page and extract readable text content.
 * Strips HTML tags, scripts, styles, and excess whitespace.
 * Preserves table structure as formatted text.
 */
export async function fetchPageText(
  url: string,
  options?: {
    maxChars?: number
    signal?: AbortSignal
  },
): Promise<string> {
  const maxChars = options?.maxChars ?? 8000
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 4000)

  // If an external signal is provided, forward its abort
  const externalSignal = options?.signal
  const onExternalAbort = () => controller.abort()
  externalSignal?.addEventListener('abort', onExternalAbort)

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': 'text/html,application/xhtml+xml,text/plain',
      },
      signal: controller.signal,
      redirect: 'follow',
    })

    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: ${res.status}`)
    }

    const contentType = res.headers.get('content-type') || ''

    // If it's plain text or JSON, return directly
    if (contentType.includes('text/plain') || contentType.includes('application/json')) {
      const text = await res.text()
      return text.slice(0, maxChars)
    }

    const html = await res.text()
    return extractText(html, maxChars)
  } finally {
    clearTimeout(timeout)
    externalSignal?.removeEventListener('abort', onExternalAbort)
  }
}

/**
 * Decode common HTML entities.
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&oacute;/g, 'ó')
    .replace(/&aacute;/g, 'á')
    .replace(/&eacute;/g, 'é')
    .replace(/&iacute;/g, 'í')
    .replace(/&uacute;/g, 'ú')
    .replace(/&ntilde;/g, 'ñ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
}

/**
 * Strip HTML tags from a string.
 */
function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').trim()
}

/**
 * Parse an HTML table into a formatted text representation.
 * Returns rows separated by newlines, cells separated by " | ".
 */
function parseTable(tableHtml: string): string {
  const rows = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
  if (rows.length === 0) return ''

  const parsedRows: string[][] = []

  for (const row of rows) {
    const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
    const rowData = cells
      .map((c) => decodeEntities(stripTags(c[1])).replace(/\s+/g, ' ').trim())
      .filter((cell) => cell.length > 0)
    // Skip empty rows or rows with only garbage (like "-->")
    const cleanRow = rowData.filter((cell) => !cell.match(/^-*>*$/))
    if (cleanRow.length > 0) {
      parsedRows.push(cleanRow)
    }
  }

  if (parsedRows.length === 0) return ''

  // Format as aligned text table
  const lines = parsedRows.map((row) => row.join(' | '))
  return lines.join('\n')
}

/**
 * Extract all HTML tables and convert them to readable text.
 * Returns tables separated by double newlines.
 */
function extractTables(html: string): string {
  const tables = [...html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)]
  if (tables.length === 0) return ''

  const results: string[] = []

  for (const table of tables) {
    const parsed = parseTable(table[1])
    // Only include tables with meaningful data (at least 2 rows, some cells)
    const lines = parsed.split('\n').filter((l) => l.trim().length > 0)
    if (lines.length >= 2) {
      results.push(parsed)
    }
  }

  return results.join('\n\n')
}

/**
 * Try to extract the main content area from HTML using common semantic tags.
 * Uses greedy matching and picks the largest match.
 */
function extractMainContent(html: string): string | null {
  const patterns = [
    /<article[^>]*>([\s\S]+)<\/article>/i,
    /<main[^>]*>([\s\S]+)<\/main>/i,
    /<div[^>]*class="[^"]*(?:article-body|entry-content|post-content|story-body|article-content)[^"]*"[^>]*>([\s\S]+?)<\/div>\s*(?:<div|<\/section|<\/main|<footer)/i,
  ]

  let bestMatch: string | null = null
  let bestLength = 0

  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match && match[1].length > bestLength) {
      bestMatch = match[1]
      bestLength = match[1].length
    }
  }

  if (bestMatch) {
    const stripped = bestMatch.replace(/<[^>]+>/g, '').trim()
    if (stripped.length > 200) {
      return bestMatch
    }
  }

  return null
}

/**
 * Extract readable text from HTML by stripping tags, scripts, and styles.
 * Tables are extracted separately and formatted as structured text.
 */
function extractText(html: string, maxChars: number): string {
  let text = html

  // Remove script and style blocks entirely
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
  text = text.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')

  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, '')

  // Remove nav, header, footer elements (navigation noise)
  text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
  text = text.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
  text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
  text = text.replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')

  // Extract tables BEFORE stripping tags (preserve structure)
  const tableText = extractTables(text)

  // Remove tables from the HTML so they don't get double-counted
  text = text.replace(/<table[^>]*>[\s\S]*?<\/table>/gi, '')

  // Try to extract main content area
  const mainContent = extractMainContent(text)
  if (mainContent) {
    text = mainContent
  }

  // Replace block elements with newlines
  text = text.replace(/<(?:p|div|br|h[1-6]|li|tr|blockquote)[^>]*>/gi, '\n')

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, '')

  // Decode entities
  text = decodeEntities(text)

  // Remove CSS/Tailwind class noise that leaks through
  text = text.replace(/\[&>[^\]]*\][^\s]*/g, '')
  text = text.replace(/style="[^"]*"/g, '')
  text = text.replace(/--[\w-]+:\s*[^;]+;/g, '')

  // Collapse whitespace
  text = text.replace(/[ \t]+/g, ' ')
  text = text.replace(/\n[ \t]*/g, '\n')
  text = text.replace(/\n{3,}/g, '\n\n')
  text = text.trim()

  // Remove very short lines (likely nav/menu items) and CSS noise
  const lines = text.split('\n').filter((line) => {
    const trimmed = line.trim()
    if (trimmed.length === 0) return true
    if (trimmed.length <= 15) return false
    // Filter out CSS/Tailwind noise
    if (/^\[?[\w&>[\].:%-]+\s*{?\s*$/.test(trimmed)) return false
    if (trimmed.includes('iframe]') || trimmed.includes('[&>')) return false
    return true
  })
  text = lines.join('\n').trim()
  text = text.replace(/\n{3,}/g, '\n\n')

  // Combine: tables first (structured data), then text content
  const parts: string[] = []
  if (tableText) {
    parts.push(tableText)
  }
  if (text) {
    parts.push(text)
  }

  return parts.join('\n\n').slice(0, maxChars)
}
