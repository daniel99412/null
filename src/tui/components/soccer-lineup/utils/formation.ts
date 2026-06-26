export interface GeneratedPlayer {
  x: number
  y: number
  pos: string
}

function inferPosition(
  lineIdx: number,
  playerIdx: number,
  n: number,
  totalLines: number,
): string {
  const isDefense = lineIdx === 0
  const isAttack = lineIdx === totalLines - 1
  const isWideLeft = playerIdx === 0
  const isWideRight = playerIdx === n - 1
  const isCenter = n % 2 === 1 && playerIdx === Math.floor(n / 2)
  const midfieldLineCount = totalLines - 2
  const isDeepestMidfield = midfieldLineCount > 1 && lineIdx === 1

  if (isDefense) {
    if (isWideLeft) return 'RB'
    if (isWideRight) return 'LB'
    return 'CB'
  }

  if (isAttack) {
    if (isWideLeft) return 'RW'
    if (isWideRight) return 'LW'
    return 'ST'
  }

  if (isWideLeft) return 'RM'
  if (isWideRight) return 'LM'
  if (isCenter && isDeepestMidfield) return 'CDM'
  return 'CM'
}

export function generatePositions(
  formation: string,
  flipY = false,
): GeneratedPlayer[] {
  const lines = formation.split('-').map(Number)
  if (lines.length === 0 || lines.some(isNaN)) return []

  const result: GeneratedPlayer[] = []

  const gkY = flipY ? 0.97 : 0.03
  result.push({ x: 0.5, y: gkY, pos: 'GK' })

  for (let li = 0; li < lines.length; li++) {
    const n = lines[li]
    const yRaw = (li + 1) / (lines.length + 1)
    let y = 0.07 + yRaw * 0.38
    if (flipY) y = 1 - y

    for (let pj = 0; pj < n; pj++) {
      const x = (pj + 1) / (n + 1)
      const pos = inferPosition(li, pj, n, lines.length)
      result.push({ x, y, pos })
    }
  }

  return result
}
