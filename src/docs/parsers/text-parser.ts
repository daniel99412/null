import fs from 'fs'

const TEXT_EXTS = new Set([
  '.txt', '.md', '.json', '.xml', '.html', '.yaml', '.yml', '.log',
  '.env', '.toml', '.ini', '.cfg', '.conf', '.csv', '.tsv',
  '.js', '.ts', '.jsx', '.tsx', '.css', '.scss', '.less',
  '.sh', '.bash', '.zsh', '.py', '.rb', '.go', '.rs', '.java',
  '.c', '.cpp', '.h', '.hpp', '.sql', '.svg', '.mjs', '.cjs',
])

export function canParse(ext: string): boolean {
  return TEXT_EXTS.has(ext) || ext === '.csv'
}

export async function parse(filePath: string): Promise<string> {
  const content = fs.readFileSync(filePath, 'utf-8')
  return content
}
