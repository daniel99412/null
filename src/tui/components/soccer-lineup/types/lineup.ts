export interface RawRosterPlayer {
  jersey: string
  shortName: string
  position: string
  starter: boolean
  formationPlace: string
  yellowCard: boolean
  redCard: boolean
  subbedOut: boolean
  subbedIn: boolean
}

export interface RawFormation {
  teamName: string
  abbreviation: string
  color: string
  formation: string
  homeAway: 'home' | 'away'
  roster: RawRosterPlayer[]
}
