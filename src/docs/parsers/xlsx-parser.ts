import fs from 'fs'

type XLSXModule = {
  read: (data: Buffer, opts: { type: string }) => {
    SheetNames: string[]
    Sheets: Record<string, Record<string, unknown>>
  }
}

let XLSX: XLSXModule | null = null

async function getParser() {
  if (!XLSX) {
    const mod = await import('xlsx')
    XLSX = mod as unknown as XLSXModule
  }
  return XLSX
}

export function canParse(ext: string): boolean {
  return ext === '.xlsx' || ext === '.xls'
}

export async function parse(filePath: string): Promise<string> {
  const buffer = fs.readFileSync(filePath)
  const parser = await getParser()
  const workbook = parser.read(buffer, { type: 'buffer' })
  const lines: string[] = []
  for (const sheetName of workbook.SheetNames) {
    lines.push(`[Sheet: ${sheetName}]`)
    const sheet = workbook.Sheets[sheetName]
    const ref = sheet['!ref']
    if (typeof ref !== 'string') continue
    const range = ref.split(':')
    const startCol = range[0].match(/[A-Z]+/)?.[0] || 'A'
    const startRow = parseInt(range[0].match(/\d+/)?.[0] || '1', 10)
    const endCol = range[1]?.match(/[A-Z]+/)?.[0] || 'A'
    const endRow = parseInt(range[1]?.match(/\d+/)?.[0] || '1', 10)
    const colToIndex = (col: string) => col.charCodeAt(0) - 65

    const startCi = colToIndex(startCol)
    const endCi = colToIndex(endCol)

    for (let r = startRow; r <= endRow; r++) {
      const row: string[] = []
      for (let ci = startCi; ci <= endCi; ci++) {
        const cellKey = `${String.fromCharCode(65 + ci)}${r}`
        const cell = sheet[cellKey]
        const val = typeof cell === 'object' && cell !== null ? (cell as { v?: string | number }).v : cell
        row.push(val !== undefined ? String(val) : '')
      }
      lines.push(row.join('\t'))
    }
  }
  return lines.join('\n')
}
