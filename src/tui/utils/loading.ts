const LOADING_BAR_WIDTH = 12

export function renderLoadingBar(pos: number, dir: number): string {
  const chars: string[] = Array(LOADING_BAR_WIDTH).fill('·')
  if (dir >= 0) {
    // → gradient ░▒▓█, head (█) at pos, extending left
    for (let i = 0; i < 4; i++) {
      const idx = pos - (3 - i)
      if (idx >= 0 && idx < LOADING_BAR_WIDTH) chars[idx] = ['░', '▒', '▓', '█'][i]
    }
  } else {
    // ← gradient █▓▒░, head (█) at pos, extending right
    for (let i = 0; i < 4; i++) {
      const idx = pos + i
      if (idx >= 0 && idx < LOADING_BAR_WIDTH) chars[idx] = ['█', '▓', '▒', '░'][i]
    }
  }
  return `[${chars.join('')}]`
}

export { LOADING_BAR_WIDTH }
