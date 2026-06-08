export const CHUNK_SIZE = 512
export const CHUNK_OVERLAP = 64

export interface Chunk {
  index: number
  content: string
  tokenCount: number
}

function countTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function splitIntoParagraphs(text: string): string[] {
  const paragraphs: string[] = []
  let current = ''
  for (const line of text.split('\n')) {
    if (line.trim() === '' && current.length > 0) {
      paragraphs.push(current)
      current = ''
    } else {
      current += (current ? '\n' : '') + line
    }
  }
  if (current) paragraphs.push(current)
  if (paragraphs.length === 0 && text.trim()) paragraphs.push(text)
  return paragraphs
}

export function chunkText(text: string): Chunk[] {
  const paragraphs = splitIntoParagraphs(text)
  const chunks: Chunk[] = []
  let current = ''
  let chunkIndex = 0

  function flush() {
    if (!current.trim()) return
    chunks.push({
      index: chunkIndex++,
      content: current,
      tokenCount: countTokens(current),
    })
  }

  for (const para of paragraphs) {
    const paraTokens = countTokens(para)
    const currentTokens = countTokens(current)

    if (currentTokens + paraTokens <= CHUNK_SIZE) {
      current += (current ? '\n\n' : '') + para
    } else {
      if (currentTokens >= CHUNK_OVERLAP) {
        flush()
        // Carry overlap: last ~CHUNK_OVERLAP tokens of current
        const words = current.split(/\s+/)
        const overlapWords = words.slice(-CHUNK_OVERLAP * 4).join(' ')
        current = overlapWords + '\n\n' + para
      } else {
        current += '\n\n' + para
      }
    }
  }

  flush()
  if (chunks.length === 0 && text.trim()) {
    chunks.push({
      index: 0,
      content: text,
      tokenCount: countTokens(text),
    })
  }
  return chunks
}
