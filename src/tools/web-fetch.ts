/**
 * Fetch a web page and extract readable text content.
 * Strips HTML tags, scripts, styles, and excess whitespace.
 */
export async function fetchPageText(url: string, maxChars: number = 5000): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10000)

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'NullCLI/0.1 (local AI assistant)',
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
  }
}

/**
 * Extract readable text from HTML by stripping tags, scripts, and styles.
 */
function extractText(html: string, maxChars: number): string {
  let text = html

  // Remove script and style blocks entirely
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
  text = text.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '')

  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, '')

  // Try to extract main content areas first
  const mainMatch = text.match(
    /<(?:main|article|div[^>]*(?:content|article|post|entry)[^>]*)>([\s\S]*?)<\/(?:main|article|div)>/i,
  )
  if (mainMatch) {
    text = mainMatch[1]
  }

  // Replace block elements with newlines
  text = text.replace(/<(?:p|div|br|h[1-6]|li|tr|blockquote)[^>]*>/gi, '\n')

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, '')

  // Decode common HTML entities
  text = text.replace(/&amp;/g, '&')
  text = text.replace(/&lt;/g, '<')
  text = text.replace(/&gt;/g, '>')
  text = text.replace(/&quot;/g, '"')
  text = text.replace(/&#39;/g, "'")
  text = text.replace(/&nbsp;/g, ' ')
  text = text.replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))

  // Collapse whitespace
  text = text.replace(/[ \t]+/g, ' ')
  text = text.replace(/\n\s*\n/g, '\n\n')
  text = text.trim()

  // Remove very short lines (likely nav/menu items)
  const lines = text.split('\n').filter((line) => line.trim().length > 20 || line.trim() === '')
  text = lines.join('\n').trim()

  return text.slice(0, maxChars)
}
