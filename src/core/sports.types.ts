export interface ProviderIds {
  espn?: string
  fotmob?: string
}

export interface UnifiedPlayer {
  jersey: string
  name: string
  position: string
  captain?: boolean
}

export interface Coach {
  name: string
}

export interface InjuredPlayer {
  name: string
  position: string
  reason?: string
  status?: string
  expectedReturn?: string
}

export interface H2hMatch {
  home: string
  away: string
  score: string
  date: string
  tournament?: string
}

const POSITION_NAMES: Record<number, string> = {
  0: 'GC',
  1: 'DEF',
  2: 'MED',
  3: 'DEL',
  11: 'GC',
  25: 'GC',
  32: 'LD',
  34: 'CB',
  36: 'CB',
  38: 'LI',
  64: 'MCD',
  66: 'MC',
  73: 'MCO',
  75: 'MC',
  77: 'MC',
  83: 'ED',
  85: 'MCO',
  87: 'EI',
  103: 'ED',
  105: 'DC',
  107: 'MCO',
  115: 'EI',
}

export function mapPosition(posId: number): string {
  if (posId in POSITION_NAMES) return POSITION_NAMES[posId]
  const usual = Math.floor(posId / 10)
  if (usual === 0) return 'GC'
  if (usual === 1) return 'DEF'
  if (usual === 2) return 'MED'
  if (usual === 3) return 'DEL'
  return '?'
}
