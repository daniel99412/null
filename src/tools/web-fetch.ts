import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/**
 * Strip basic Markdown formatting from a string while preserving text content.
 * Handles links, bold, italic, images, headings, code blocks, lists, blockquotes.
 */
function stripMarkdownFormatting(raw: string): string {
  // Remove reference-style link definitions: [label]: url
  let s = raw.replace(/^\[[^\]]+\]:\s+\S+.*$/gm, '')
  // Strip image markdown FIRST — must run before the link regex,
  // otherwise the `[` inside `![alt](url)` gets consumed as a link
  // leaving orphaned `!alt text` in the output.
  s = s.replace(/!\[([^\]]*)\]\(((?:[^()]|\([^()]*\))*)\)/g, '')
  // Strip inline HTML images
  s = s.replace(/<img[^>]+>/gi, '')
  // Strip markdown links: [text](url) → text (handle nested parens in URL)
  s = s.replace(/\[([^\]]+)\]\(((?:[^()]|\([^()]*\))*)\)/g, '$1')
  // Strip bold/italic markers
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1')
  s = s.replace(/__([^_]+)__/g, '$1')
  s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1')
  s = s.replace(/_(?!_)([^_]+)_(?!_)/g, '$1')
  // Strip inline HTML images (catch any remaining)
  s = s.replace(/<img[^>]+>/gi, '')
  // Strip heading markers
  s = s.replace(/^#{1,6}\s+/gm, '')
  // Strip horizontal rules
  s = s.replace(/^---+\s*$/gm, '')
  s = s.replace(/^\*{3,}\s*$/gm, '')
  // Strip code blocks / inline code
  s = s.replace(/```[\s\S]*?```/g, '')
  s = s.replace(/`([^`]+)`/g, '$1')
  // Strip blockquote markers
  s = s.replace(/^>\s+/gm, '')
  // Strip list markers
  s = s.replace(/^[\s]*[-*+]\s+/gm, '')
  s = s.replace(/^\s*\d+\.\s+/gm, '')
  // Collapse multiple blank lines
  s = s.replace(/\n{3,}/g, '\n\n')
  return s.trim()
}

/**
 * Extract the main article body from cleaned Jina markdown output.
 * Uses paragraph-level heuristics to identify actual article content
 * and discard navigation, related-article sections, comments, footer, etc.
 */
function extractArticleBody(text: string): string {
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  if (paragraphs.length <= 3) return paragraphs.join('\n\n')

  // Section headers that introduce garbage blocks — if a paragraph
  // matches, everything after it (including the header) is discarded.
  const garbageSectionHeaders = [
    /^(más leídas?|lo más visto|more popular|most read|most watched|trending|tendencias)/i,
    /^(related|relacionadas?|también te puede interesar|you may also like|read next|más información)/i,
    /^(comentarios?|comments?|discusión|discussion|deja tu comentario)/i,
    /^(síguenos|follow us|suscríbete|subscribe|newsletter|boletín)/i,
    /^(compartir|share this|envía esta|imprimir|print)/i,
    /^(publicidad|advertisement|anuncio|sponsored|patrocinado)/i,
    /^(noticias? de|más noticias?|últimas noticias|última hora|lo +último)/i,
    /^(edición (impresa|digital|electrónica))/i,
    /^(ver (comentarios|más)|en (esta|la misma) nota|tags|etiquetas)/i,
    /^recibe (nuestras|las) (noticias|alertas|promociones)/i,
    /^get (our|the) (news|alerts|updates)/i,
    /^final( de)?\s+(más leídas|lo más visto|más noticias|related)/i,
    /^(nuevo podcast|el (nuevo )?podcast|escucha (el |nuestro )?podcast|listen to)/i,
    /^(episodios?|episodes?|suscríbete al podcast)/i,
  ]

  // Score each paragraph for article-likeness
  const scored = paragraphs.map((p) => {
    const wordCount = p.split(/\s+/).length
    const charLen = p.length
    const hasSentenceEnding = /[a-záéíóúñ].*[.!?]$/.test(p)
    const lowerCount = (p.match(/[a-záéíóúñ]/g) || []).length
    const lowerRatio = lowerCount / Math.max(charLen, 1)
    const hasArticleWords = /\b(de|la|el|en|que|los|las|del|por|con|para|the|and|for|that|this|with|from)\s/i.test(p)
    const isGarbage = garbageSectionHeaders.some(re => re.test(p))

    return {
      text: p,
      score: (hasSentenceEnding ? 3 : 0)
        + (lowerRatio > 0.3 ? 2 : 0)
        + (hasArticleWords ? 2 : 0)
        + Math.min(wordCount / 15, 2),
      isGarbage,
      wordCount,
    }
  })

  // Find article start: skip leading low-score / short paragraphs
  let bodyStart = 0
  while (bodyStart < scored.length && scored[bodyStart].score < 2 && scored[bodyStart].wordCount < 20) {
    bodyStart++
  }
  if (bodyStart >= scored.length) return text

  // Find article end: stop at garbage section header
  let bodyEnd = scored.length
  for (let i = bodyStart; i < scored.length; i++) {
    if (scored[i].isGarbage) {
      bodyEnd = i
      break
    }
  }

  const body = scored.slice(bodyStart, bodyEnd)
  // Drop trailing low-quality paragraphs (metadata, short CTAs, etc.)
  while (body.length > 1 && body[body.length - 1].score < 2 && body[body.length - 1].wordCount < 15) {
    body.pop()
  }

  return body.map(p => p.text).join('\n\n')
}

/**
 * Fallback: fetch an article via r.jina.ai (free reader-mode proxy) when the
 * direct fetch is blocked (403, 40x). Jina returns clean markdown text.
 * Returns `` if the proxy itself fails.
 */
async function fetchViaJinaProxy(
  url: string,
  maxChars: number,
  signal: AbortSignal,
): Promise<string> {
  try {
    const proxyUrl = `https://r.jina.ai/${encodeURI(url)}`
    const res = await fetch(proxyUrl, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': 'text/plain,text/markdown',
      },
      signal,
      redirect: 'follow',
    })
    if (!res.ok) return ''
    const text = await res.text()

    const marker = 'Markdown Content:\n'
    const mdIdx = text.indexOf(marker)
    if (mdIdx === -1) return ''

    let clean = stripMarkdownFormatting(text.slice(mdIdx + marker.length).trim())
    clean = dropBoilerplateLines(clean)
    clean = extractArticleBody(clean)
    return clean.slice(0, maxChars)
  } catch {
    return ''
  }
}

/**
 * Fallback: fetch via curl_cffi Python script to bypass Cloudflare JS challenges.
 * Calls scripts/fetch-via-curl-cffi.py as a subprocess.
 * Returns `` if the script fails or times out.
 */
async function fetchViaCurlCffi(
  url: string,
  maxChars: number,
  signal: AbortSignal,
): Promise<string> {
  const scriptPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../scripts/fetch-via-curl-cffi.py',
  )
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve('')
      return
    }

    const child = spawn('python3', [scriptPath, url], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const chunks: Buffer[] = []
    let settled = false

    const finish = (value: string) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal.removeEventListener('abort', onAbort)
      resolve(value)
    }

    const onAbort = () => {
      child.kill('SIGTERM')
      finish('')
    }

    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      finish('')
    }, 20000)

    signal.addEventListener('abort', onAbort, { once: true })

    child.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      const total = chunks.reduce((sum, c) => sum + c.length, 0)
      if (total > 1024 * 1024) {
        child.kill('SIGTERM')
        finish('')
      }
    })

    child.on('error', () => finish(''))
    child.on('close', (code) => {
      if (code !== 0) {
        finish('')
        return
      }
      const output = Buffer.concat(chunks).toString()
      finish(output && output.length >= 100 ? extractText(output, maxChars) : '')
    })
  })
}

/**
 * Extract the article ID from an ESPN story URL.
 * ESPN URLs follow the pattern: /id/{digits}/
 * e.g. https://www.espn.com/soccer/story/_/id/48960694/article-slug
 */
function extractESPNArticleId(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.hostname.endsWith('espn.com')) {
      const match = parsed.pathname.match(/\/id\/(\d+)\//)
      if (match) return match[1]
    }
    return null
  } catch {
    return null
  }
}

/**
 * Fetch an ESPN article via the content.core.api.espn.com API.
 * This bypasses the client-side rendering issue of ESPN's web pages.
 * Returns plain text extracted from the story HTML, or '' on failure.
 */
async function fetchViaESPNContentAPI(
  url: string,
  maxChars: number,
  signal: AbortSignal,
): Promise<string> {
  const articleId = extractESPNArticleId(url)
  if (!articleId) return ''

  try {
    const apiUrl = `https://content.core.api.espn.com/v1/sports/news/${articleId}`
    const res = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Null CLI sports agent',
        'Accept': 'application/json',
      },
      signal,
      redirect: 'follow',
    })
    if (!res.ok) return ''

    const data = (await res.json()) as { headlines?: Array<{ story?: string }> }
    const story = data?.headlines?.[0]?.story
    if (!story) return ''

    // Strip HTML tags, collapse whitespace, decode entities
    let text = story
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    text = decodeEntities(text)
    return text.slice(0, maxChars)
  } catch {
    return ''
  }
}

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
  const externalSignal = options?.signal

  // ---- Attempt 0: ESPN content API (bypasses JS-rendered pages) ----
  const apiController = new AbortController()
  const apiTimeout = setTimeout(() => apiController.abort(), 5000)
  const onApiAbort = () => apiController.abort()
  externalSignal?.addEventListener('abort', onApiAbort)
  try {
    const apiText = await fetchViaESPNContentAPI(url, maxChars, apiController.signal)
    if (apiText) return apiText
  } finally {
    clearTimeout(apiTimeout)
    externalSignal?.removeEventListener('abort', onApiAbort)
  }

  // ---- Attempt 1: direct fetch ----
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 4000)
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
  } catch {
    // Direct fetch failed — fall through to proxy attempt
  }

  // ---- Attempt 2: r.jina.ai proxy fallback ----
  const proxyController = new AbortController()
  const proxyTimeout = setTimeout(() => proxyController.abort(), 8000)
  const onProxyAbort = () => proxyController.abort()
  externalSignal?.addEventListener('abort', onProxyAbort)
  try {
    const proxyText = await fetchViaJinaProxy(url, maxChars, proxyController.signal)
    if (proxyText) return proxyText
  } finally {
    clearTimeout(proxyTimeout)
    externalSignal?.removeEventListener('abort', onProxyAbort)
  }

  // ---- Attempt 3: curl_cffi (Python) for Cloudflare-bypass ----
  const cfController = new AbortController()
  const cfTimeout = setTimeout(() => cfController.abort(), 25000)
  const onCfAbort = () => cfController.abort()
  externalSignal?.addEventListener('abort', onCfAbort)
  try {
    const cfText = await fetchViaCurlCffi(url, maxChars, cfController.signal)
    if (cfText) return cfText
  } finally {
    clearTimeout(cfTimeout)
    externalSignal?.removeEventListener('abort', onCfAbort)
  }

  throw new Error(`Failed to fetch ${url}: direct, proxy, and curl_cffi all returned empty`)
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
    if (lines.length < 2) continue

    // Drop tables that look like nav menus: 1-2 rows with many pipe-
    // separated cells (La Jornada, El Universal, Excélsior wrap top-nav
    // in a 1-2 row <table>). Real data tables have 3+ rows of data.
    if (lines.length <= 2) {
      const allText = lines.join(' ')
      const cellCount = (allText.match(/\s\|\s/g) || []).length + 1
      if (cellCount >= 4) continue
    }

    results.push(parsed)
  }

  return results.join('\n\n')
}

/**
 * Try to extract the main content area from HTML using common semantic tags
 * and class/id patterns found across news sites (US, MX, EU outlets).
 * Picks the largest match whose stripped text is >200 chars.
 */
function extractMainContent(html: string): string | null {
  const patterns: RegExp[] = [
    // Schema.org microdata
    /<div[^>]*itemprop="articleBody"[^>]*>([\s\S]+?)<\/div>/i,
    /<section[^>]*itemprop="articleBody"[^>]*>([\s\S]+?)<\/section>/i,
    // Common news-site class names
    /<div[^>]*class="[^"]*(?:article-body|article-body__content|entry-content|post-content|story-body|article-content|article__body|article__content|news-body|content-body|main-content|page-content|nota-contenido|nota-cuerpo|cuerpo-nota|article-text|article__text|article-wrapper|post-body|article-inner)[^"]*"[^>]*>([\s\S]+?)<\/div>/i,
    /<section[^>]*class="[^"]*(?:article-body|entry-content|post-content|story-body|article-content|article__body|article__content|news-body|content-body|main-content)[^"]*"[^>]*>([\s\S]+?)<\/section>/i,
    // Semantic <article> and <main>
    /<article[^>]*>([\s\S]+?)<\/article>/i,
    /<main[^>]*role="main"[^>]*>([\s\S]+?)<\/main>/i,
    /<main[^>]*>([\s\S]+?)<\/main>/i,
  ]

  let bestMatch: string | null = null
  let bestTextLength = 0

  for (const pattern of patterns) {
    // For the <article>/<main> greedy patterns, use a non-greedy variant that
    // stops at the first nested </article> or </main>.
    const match = html.match(pattern)
    if (match && match[1]) {
      const stripped = match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      if (stripped.length > bestTextLength) {
        bestMatch = match[1]
        bestTextLength = stripped.length
      }
    }
  }

  if (bestMatch && bestTextLength > 200) {
    return bestMatch
  }

  return null
}

/**
 * Boilerplate line prefixes/phrases to drop from extracted article text.
 * These appear as inline metadata, CTAs, or chrome that bleeds into articles
 * from news sites (esp. BBC, CNN, La Jornada, Excélsior) and never represent
 * the article body itself. Matched case-insensitively as a leading substring
 * of the trimmed line.
 */
const BOILERPLATE_LINE_PATTERNS: RegExp[] = [
  // Image / photo metadata
  /^fuente de la imagen[\s,:]/i,
  /^fuente[\s,:].*imagen/i,
  /^image source[\s,:]/i,
  /^getty images?$/i,
  /^shutterstock$/i,
  /^reuters$/i,
  /^afp$/i,
  /^pixabay/i,
  /^unsplash/i,
  /^pie de (foto|imagen|gr[aá]fico)/i,
  /^photo caption[\s,:]/i,
  /^image caption[\s,:]/i,
  /^caption[\s,:]/i,
  /^cr[eé]dito(s)?[\s,:]/i,
  /^credit[\s,:]/i,
  // Author / date / reading-time metadata
  /^informaci[oó]n del art[ií]culo/i,
  /^article info/i,
  /^sobre (este|el|la) (art[ií]culo|reportaje|nota)/i,
  /^about (this|the) (article|story|report)/i,
  /^autor[\s,:]/i,
  /^author[\s,:]/i,
  /^por\s+[A-Z][a-záéíóúñ]+/i, // "Por Juan Pérez" (bylines)
  /^t[ií]tulo del autor/i,
  /^author title/i,
  /^fecha de publicaci[oó]n/i,
  /^fecha de (actualizaci[oó]n|modificaci[oó]n)/i,
  /^published[\s,:]/i,
  /^updated[\s,:]/i,
  /^tiempo de lectura[\s,:]/i,
  /^reading time[\s,:]/i,
  /^minutos? de lectura/i,
  /^minutes? read/i,
  // Skip-to-content / continue-reading CTAs
  /^saltar .* y continuar (leyendo|lectura)/i,
  /^skip .* and (continue|read more)/i,
  /^saltar (m[aá]s le[ií]das|contenido)/i,
  /^skip (most read|content)/i,
  /^continuar leyendo/i,
  /^continue reading/i,
  /^read (more|full)/i,
  /^leer m[aá]s/i,
  // Social follow CTAs
  /^s[ií]guenos en/i,
  /^follow us on/i,
  /^s[ií]guenos[\s.,]/i,
  /^follow us[\s.,]/i,
  /^s[ií]gueme en/i,
  /^follow me on/i,
  /^comparte en/i,
  /^share on/i,
  /^comparte (esta|este) (nota|art[ií]culo|historia)/i,
  // Newsletter / subscription prompts
  /^suscr[ií]bete/i,
  /^subscribe/i,
  /^newsletter/i,
  /^bolet[ií]n/i,
  /^recibe (nuestras|las) (noticias|alertas)/i,
  /^get (our|the) (news|alerts|updates)/i,
  // Most-read / trending widgets
  /^m[aá]s le[ií]das?$/i,
  /^m[aá]s vistos?$/i,
  /^most read$/i,
  /^most watched$/i,
  /^lo m[aá]s (visto|le[ií]do)$/i,
  /^tendencias?$/i,
  /^trending$/i,
  /^related (stories|articles|coverage)$/i,
  /^tambi[eé]n (te puede|le puede) interesar/i,
  /^you may also like/i,
  /^read next/i,
  // Comments / share counts
  /^comentarios?\s*\d*$/i,
  /^comments?\s*\d*$/i,
  /^compartir\s*$/i,
  /^share\s*$/i,
  /^publicado (por|hace)/i,
  /^posted (by|ago)/i,
  // Inline photo credits & La Jornada-style captions
  /^[▲▼◀▶■□●○◆◇★☆]\s+/, // black/geometric bullets often used to mark captions
  /^foto\s+[A-ZÁÉÍÓÚÑa-záéíóúñ\s.\-']+$/i, // "Foto Cristina Rodríguez"
  /^fotograf[ií]a[\s:]/i,
  /^imagen[\s:]/i,
  /^gr[aá]fico[\s:]/i,
  /^archivo[\s:]/i,
  // Print-edition metadata
  /^peri[oó]dico\s+[a-záéíóúñ\s]+$/i,
  /^edici[oó]n (impresa|electr[oó]nica|digital)/i,
  // Podcast / promo inserts (BBC, NPR, etc.)
  /^el nuevo podcast/i,
  /^nuevo podcast/i,
  /^escucha (este|el|la)/i,
  /^listen to (this|the)/i,
  /^podcast[\s:]/i,
  /^suscr[ií]bete (al|al nuestro)/i,
  /^suscr[ií]bete a (nuestro|este|el)/i,
  // Watch / listen inline CTAs
  /^mira (este|el|la) (v[ií]deo|video)/i,
  /^watch (this|the) video/i,
  /^mira tambi[eé]n/i,
  /^watch also/i,
  // Pipe-separated nav menus ("Inicio | Editorial | El Correo Ilustrado | …").
  // Match: 3+ ` | ` separators, mostly short capitalized words, no period
  // (periods signal real sentences, not nav links). Anchored to whole line.
  /^(?=\s*\S)(?:[^|]*\s\|\s){2,}[^|.]+$/,
  // Date / edition / page metadata (La Jornada, Excélsior, El Universal)
  /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+\s+\d{1,2}\s+de\s+\w+\s+de\s+\d{4}/i, // "Miércoles 3 de junio de 2026"
  /^\d{1,2}\s+de\s+\w+\s+de\s+\d{4}/i, // "3 de junio de 2026"
  /^[A-Z][a-záéíóúñ]+\s+\d{1,2},\s*\d{4}/i, // "Junio 3, 2026"
  /^p[aá]g(ina)?\.?\s*\d+/i, // "p. 5", "página 12"
  /,\s*p\.\s*\d+/i, // ", p. 5"
  /^secci[oó]n[\s:]/i, // "Sección: Política"
  // Social media follow / share blocks
  /^(@[A-Za-z0-9_]+)(\s+@[A-Za-z0-9_]+)+$/, // "@bbcmundo @el_pais @cnn"
  /^(@[A-Za-z0-9_]+)\s*$/, // single @handle
  // Cookie / privacy notices
  /^aceptar (todas? )?las? cookies/i,
  /^accept (all )?cookies/i,
  /^usamos cookies/i,
  /^we use cookies/i,
  /^pol[ií]tica de (cookies|privacidad)/i,
  /^privacy policy/i,
  // Ad / sponsored content markers
  /^publicidad/i,
  /^anuncio/i,
  /^advertisement/i,
  /^sponsored/i,
  /^contenido patrocinado/i,
  /^patrocinado por/i,
  // Related-article headers (El País, El Mundo, etc.)
  /^m[aá]s informaci[oó]n/i,
  /^noticias?\s+(de\s+|sobre\s+)/i,
  /^tamb[ié]n\s+en\s+/i,
  /^en\s+(esta\s+)?nota/i,
  // Topic tags / breadcrumbs (all-caps short words)
  /^[A-ZÁÉÍÓÚÑ]{2,}(?:\s+[A-ZÁÉÍÓÚÑ]{2,}){0,2}$/,
  // Source attribution in parens: "(Reuters)", "(EFE)", "(AP)"
  /^\([A-ZÁÉÍÓÚÑ][A-Za-záéíóúñ\s]+\)$/,
  /^\(foto:?.*\)$/i,
  /^\(fotograf[ií]a:?.*\)$/i,
  /^\(imagen:?.*\)$/i,
  /^\(cr[eé]dito:?.*\)$/i,
  // URL-only lines
  /^https?:\/\/\S+$/i,
  // Share / follow CTAs (inline)
  /^compartir\s+en\s+/i,
  /^env[ií]a\s+(esta|tu)\s+/i,
  /^sigue\s+los\s+temas/i,
  /^sigue\s+a\s+/i,
  /^ver\s+comentarios/i,
  /^x\s+comentarios/i,
  /^lectores?\s+comentaron/i,
  // Lo más visto/leído
  /^lo\s+m[aá]s\s+(visto|le[ií]do|compartido)/i,
  /^lo\s+[uú]ltimo/i,
  /^edici[oó]n\s+(de|del|en)/i,
  // Video / multimedia CTAs
  /^ver\s+(el\s+)?v[ií]deo/i,
  /^ver\s+(la\s+)?galer[ií]a/i,
  /^escucha\s+(el\s+)?podcast/i,
  /^mira\s+(el\s+)?v[ií]deo/i,
  // Lines that are just a number (page indicators, e.g. "1", "2")
  /^\d{1,2}\s*$/,
  // Lines starting with "Image X:" or "!Image" from poorly-stripped markdown
  /^!?(image\s+\d+|img\s+\d+)/i,
  /^!\[.*/,
  // Author bio / "periodista especializado en"
  /^periodista\s+(especializado|con\s+\d+|titular)/i,
  /^redactor[\s,:]/i,
  /^colaborador[\s,:]/i,
  /^corresponsal[\s,:]/i,
  // Generic separator / divider lines
  /^[-—=_*•·]{3,}$/,
  // El País / Jina consent wall (English & Spanish)
  /^(free browsing|this will involve|that advertising|we and (our|\d+)|storage and access|sharing data|precise geolocation|personalized advertising|audience research|you can remove|accept and continue|subscribe and decline|this option will allow|if you decide|you can set|you can find|already a (subscriber|member))/i,
  /^(it offers|legal warning|cookies policy|know more)/i,
  // Nav / site chrome
  /^seleccione:/i,
  /^(us español|us english)$/i,
  /^(mi actividad|mi suscripci[oó]n|mis datos|mis newsletters|mis (comentarios|notificaciones))/i,
  /^(alto contraste|desconectar|cerrar|asistente|buscar)/i,
  /^(suscri[bp]ete|suscríbete)/i,
  /^(salir|iniciar sesi[oó]n|iniciar sesión)/i,
  /^(últimas noticias|última hora)$/i,
  /^(más información|archivado en|sobre la firma|comentarios|normas)/i,
  /^(rellena tu|ya tengo una suscripci[oó]n)/i,
  /^(si quieres seguir|únete a)/i,
  // Share / social CTAs
  /^(compartir|desplegar|copiar enlace)$/i,
  /^añadir .+/i,
  /^(enviar|imprimir|reportar)/i,
  /^(bluesky|linkedin)$/i,
  // Navigation / comment CTAs
  /^ir a los comentarios/i,
  // Single-word nav items (common on Spanish news sites)
  /^(internacional|m[eé]xico|opini[oó]n|econom[ií]a|ciencia|cultura|gente|tecnolog[ií]a|espect[aá]culos|pol[ií]tica|sociedad|salud|educaci[oó]n|justicia|seguridad|migraci[oó]n)$/i,
  // Author / metadata shortlines
  /^ver biograf[ií]a/i,
  /^ver todas las noticias de/i,
  /^recibe el bolet[ií]n/i,
  /^sigue los temas que te interesan/i,
  /^se adhiere a los criterios/i,
  /^si está interesado en licenciar/i,
  // Cookie / privacy (English)
  /^(we use cookies?|this (site|website) uses|cookie policy|privacy policy|terms and conditions)/i,
  // "---" separator lines (after horizontal rule strip)
  /^_{3,}$/,
  // Tags / categories — match all-capitalized or title-cased phrases without
  // any lowercase-word interruption, e.g. "Donald Trump", "T-MEC", "Estados
  // Unidos". Article paragraphs always contain at least one lowercase word
  // (e.g. "de", "el", "que", "y"), so they won't match.
  /^[A-ZÁÉÍÓÚÑ][A-Za-záéíóúñ-]*(?:\s+[A-ZÁÉÍÓÚÑ][A-Za-záéíóúñ-]*)*\s*$/,
  // Lines that are just a bullet followed by text
  /^\s*[-*•·]\s+.{1,40}$/,
  // Reference-style link definitions & image references
  /^\[[^\]]+\]:\s+\S+/,
  // Lines with raw image URLs
  /^(https?:\/\/\S+\.(?:jpg|jpeg|png|gif|webp|svg|avif|bmp|ico))/i,
  // Lines that are just a raw URL
  /^https?:\/\/\S+$/,
  // Lines with bare `src=`, `href=`, `class="` (HTML attr leakage)
  /^(src|href|class|alt|width|height|loading|data-)\s*=/i,
  // "View all ___" CTAs
  /^ver (todas|todos?|más)\s+(las|los|las noticias|el|la)/i,
  /^view all/i,
  // Video / podcast / gallery CTAs
  /^(vea|mire|escuche|lea)\s+(el|la|este|esta|nuestro)/i,
  /^(watch|listen|read)\s+(the|this|our)/i,
  // Cookie preferences / settings buttons
  /^(configurar|cookie settings|manage cookies)/i,
  // Social handles as lines
  /^(facebook|twitter|x\.com|instagram|tiktok|youtube|linkedin|bluesky|threads|whatsapp|telegram)(\s|$)/i,
  // Breadcrumb indicators
  /^(inicio|home|portada)\s*[>»]/i,
  /^[a-záéíóúñ]+\s*[>»]\s*[a-záéíóúñ]/i,
]

/**
 * Drop lines that are pure boilerplate / chrome from the extracted text.
 * Returns the cleaned text with paragraph breaks preserved.
 */
function dropBoilerplateLines(text: string): string {
  const lines = text.split('\n')
  const kept: string[] = []
  for (const raw of lines) {
    const line = raw.trim()
    if (line.length === 0) {
      kept.push('')
      continue
    }
    if (BOILERPLATE_LINE_PATTERNS.some((re) => re.test(line))) {
      continue
    }
    kept.push(raw)
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
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
  text = text.replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')

  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, '')

  // Drop social media embeds — their text is metadata noise
  // ("View this post on Instagram", fake author names, etc.) that bleeds
  // into the extracted article.
  text = text.replace(/<blockquote[^>]*class="[^"]*(instagram-media|twitter-tweet|tiktok-embed|fb-post|fb-video)[^"]*"[^>]*>[\s\S]*?<\/blockquote>/gi, '')
  text = text.replace(/<div[^>]*class="[^"]*(instagram-media|twitter-tweet|tiktok-embed|fb-post|fb-video)[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
  text = text.replace(/<iframe[^>]*(instagram\.com|platform\.twitter\.com|facebook\.com|embed\.tiktok\.com|player\.vimeo\.com|youtube\.com|youtu\.be)[^>]*>[\s\S]*?<\/iframe>/gi, '')
  text = text.replace(/<iframe[^>]*src="[^"]*(instagram\.com|platform\.twitter\.com|facebook\.com|embed\.tiktok\.com|player\.vimeo\.com)[^"]*"[^>]*\/?>/gi, '')

  // Remove nav, header, footer elements (navigation noise)
  text = text.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
  text = text.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
  text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
  text = text.replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, '')

  // Drop image captions and image credit markup before main-content
  // selection. <figcaption> holds photo captions, <cite> is often used
  // for image/photo credit lines (Reuters, Getty, etc.).
  text = text.replace(/<figcaption[^>]*>[\s\S]*?<\/figcaption>/gi, '')
  text = text.replace(/<cite[^>]*>[\s\S]*?<\/cite>/gi, '')

  // Drop elements with caption/credit/byline/metadata class hints
  const captionClassRe = /(?:image-?caption|photo-?caption|media-?caption|fig-?caption|figcaption|article-?credit|image-?credit|photo-?credit|article-?byline|article-?meta|article-?info|article-?header|post-?meta|entry-?meta|story-?meta|article-?metadata|info-?article)/
  text = text.replace(/<div[^>]*class="[^"]*"[^>]*>[\s\S]*?<\/div>/gi, (m) =>
    captionClassRe.test(m) ? '' : m
  )
  text = text.replace(/<span[^>]*class="[^"]*"[^>]*>[\s\S]*?<\/span>/gi, (m) =>
    captionClassRe.test(m) ? '' : m
  )
  text = text.replace(/<p[^>]*class="[^"]*"[^>]*>[\s\S]*?<\/p>/gi, (m) =>
    captionClassRe.test(m) ? '' : m
  )

  // Drop "related articles" / "more from" / "most read" sections
  // that mix content from other stories. Class-based filter for legacy
  // sites, data-e2e-based filter for modern frameworks (BBC uses
  // `data-e2e="recommendations"` and `data-e2e="recommendations-heading"`).
  const relatedClassRe = /(?:related|related-stories|related-articles|more-from|read-more|recommended|related-posts|you-may-also-like|also-read|teaser|recomendados|relacionadas|mas-de|te-puede-interesar|most-read|most-popular|trending|popular|top-stories)/
  const relatedDataAttrRe = /(?:^|\s)data-(?:e2e|testid)="(?:recommendations?|related|most-read|most-popular|trending|popular)/
  const isRelatedBlock = (m: string): boolean => {
    const openingEnd = m.indexOf('>')
    if (openingEnd === -1) return false
    const opening = m.slice(0, openingEnd)
    return relatedClassRe.test(opening) || relatedDataAttrRe.test(opening)
  }
  text = text.replace(/<div[^>]*>[\s\S]*?<\/div>/gi, (m) =>
    isRelatedBlock(m) ? '' : m
  )
  text = text.replace(/<section[^>]*>[\s\S]*?<\/section>/gi, (m) =>
    isRelatedBlock(m) ? '' : m
  )
  text = text.replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, (m) =>
    isRelatedBlock(m) ? '' : m
  )

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

  // Drop boilerplate lines (image captions, follow-us CTAs, byline metadata,
  // newsletter prompts, etc.) that survived the block-level filters.
  text = dropBoilerplateLines(text)

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
