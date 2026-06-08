import fs from 'fs'

let PDFParse: { new (opts: { data: Buffer }): { getText: () => Promise<{ text: string }>; destroy: () => Promise<void> } } | null = null

async function getParser() {
  if (!PDFParse) {
    const mod = await import('pdf-parse')
    PDFParse = mod.PDFParse
  }
  return PDFParse
}

export function canParse(ext: string): boolean {
  return ext === '.pdf'
}

export async function parse(filePath: string): Promise<string> {
  const buffer = fs.readFileSync(filePath)
  const ParserClass = await getParser()
  const parser = new ParserClass({ data: buffer })
  try {
    const result = await parser.getText()
    return result.text
  } finally {
    await parser.destroy()
  }
}
