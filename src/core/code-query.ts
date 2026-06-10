const CODE_PATTERNS: RegExp[] = [
  /\b(code|coding|programming|programar|programación|programacion)\b/i,
  /\b(function|class|interface|type|enum|const|let|var|async|await|promise)\b/i,
  /\b(debug|debuggear|bug|error|stack trace|exception|compile|compilar|typecheck|lint)\b/i,
  /\b(refactor|refactorizar|implementa|implementar|fix|arregla|corrige)\b/i,
  /\b(api|endpoint|schema|database|sql|sqlite|postgres|react|typescript|javascript|node|tsx|jsx)\b/i,
  /\b(archivo|file)\b.*\.(ts|tsx|js|jsx|json|md|py|go|rs|java|c|cpp|cs|sql)\b/i,
  /```[\s\S]*```/,
]

const NON_CODE_PATTERNS: RegExp[] = [
  /\b(clima|weather|temperatura|noticias?|news|hora|fecha)\b/i,
]

export function isCodeQuery(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false

  const codeScore = CODE_PATTERNS.reduce((score, pattern) => (
    pattern.test(trimmed) ? score + 1 : score
  ), 0)
  if (codeScore === 0) return false

  const nonCodeScore = NON_CODE_PATTERNS.reduce((score, pattern) => (
    pattern.test(trimmed) ? score + 1 : score
  ), 0)

  return codeScore > nonCodeScore
}
