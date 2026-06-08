import fs from 'fs'

let mammoth: { extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }> } | null = null

async function getParser() {
  if (!mammoth) {
    const mod = await import('mammoth')
    mammoth = mod
  }
  return mammoth
}

export function canParse(ext: string): boolean {
  return ext === '.docx'
}

export async function parse(filePath: string): Promise<string> {
  const buffer = fs.readFileSync(filePath)
  const parser = await getParser()
  const result = await parser.extractRawText({ buffer })
  return result.value
}
