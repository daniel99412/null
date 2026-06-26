# Soccer Lineup TUI — Implementation Spec

## Context

This is part of **Jarvis**, a local-first CLI personal AI assistant built with TypeScript.
The Sports Agent module fetches match data from the **ESPN public API** and needs to render
soccer lineups in the terminal using **Ink** (React for CLIs) and **Chalk** for colors.

---

## Goal

Implement a `<SoccerLineup>` Ink component that:

1. Receives raw ESPN boxscore JSON as a prop
2. Parses both rosters (home + away) and their formations
3. Generates player `(x, y)` positions algorithmically from the formation string
4. Renders a terminal field with both teams using a character canvas approach

---

## File Structure to Create

```
src/
  agents/
    sports/
      components/
        SoccerLineup.tsx        ← main Ink component
      utils/
        formation.ts            ← algorithmic position generator
        espn-mapper.ts          ← ESPN JSON → internal types mapper
      types/
        lineup.ts               ← shared types
```

---

## Types (`types/lineup.ts`)

```ts
export interface LineupPlayer {
  name: string;          // shortName from ESPN e.g. "G. Plata"
  number: number;        // jersey number
  pos: string;           // normalized position e.g. "CM", "RB", "GK"
  x: number;             // 0–1 relative to field width
  y: number;             // 0–1 relative to field height
  yellowCard: boolean;
  redCard: boolean;
  subbedOut: boolean;
  subbedIn: boolean;
}

export interface LineupTeam {
  name: string;
  abbreviation: string;
  color: string;         // hex from ESPN e.g. "ffdd00"
  formation: string;     // e.g. "4-4-2"
  homeAway: 'home' | 'away';
  players: LineupPlayer[];
}

export interface MatchLineup {
  home: LineupTeam;
  away: LineupTeam;
  score: { home: number; away: number };
  competition: string;
  venue?: string;
}
```

---

## Formation Generator (`utils/formation.ts`)

Parse the formation string and compute x/y positions algorithmically.
**No hardcoded dictionaries per formation.**

```ts
export function generatePositions(
  formation: string,  // e.g. "4-3-3", "3-4-2-1"
  flipY = false       // true for away team (bottom of field)
): Array<{ x: number; y: number; pos: string }>
```

### Algorithm

```
formation "4-3-3" → lines = [4, 3, 3]

1. Goalkeeper: always x=0.5, y=0.05 (or 0.95 if flipY)

2. For each line (index i, count n):
   - yRaw = (i + 1) / (lines.length + 1)        → evenly spaced 0–1
   - y = 0.20 + yRaw * 0.65                      → constrained to [0.20, 0.85]
   - yFinal = flipY ? (1 - y) : y

   - For each player j in line:
     - x = (j + 1) / (n + 1)                     → evenly spaced across width

3. Infer position label based on:
   - isDefense  = lineIdx === 0
   - isAttack   = lineIdx === lines.length - 1
   - isMidfield = everything else
   - isWide     = playerIdx === 0 || playerIdx === n - 1
   - isCenter   = playerIdx === Math.floor(n / 2) && n % 2 !== 0
```

### Position label inference table

| Zone      | Wide left | Center | Wide right |
|-----------|-----------|--------|------------|
| Defense   | RB        | CB     | LB         |
| Midfield  | RM        | CM/CDM | LM         |
| Attack    | RW        | ST     | LW         |

CDM only when: midfield line AND isCenter AND it's the deepest midfield line.

### Important edge cases

- `"4-2-3-1"` → lines = [4, 2, 3, 1]: each parsed segment is its own line
- `"5-3-2"` → 5 defenders: positions[0] and positions[4] are wingbacks (WB), not RB/LB
- Formation line with 1 player → ST or CAM depending on position in stack

---

## ESPN Mapper (`utils/espn-mapper.ts`)

Map the raw ESPN boxscore response to `MatchLineup`.

### Input: ESPN `boxscore.rosters[]`

Each roster has:
```json
{
  "homeAway": "home",
  "formation": "4-4-2",
  "team": { "displayName": "Ecuador", "abbreviation": "ECU", "color": "ffdd00" },
  "roster": [
    {
      "starter": true,
      "jersey": "1",
      "formationPlace": "1",
      "athlete": { "displayName": "Hernán Galíndez", "shortName": "H. Galíndez" },
      "position": { "abbreviation": "G" },
      "subbedOut": false,
      "subbedIn": false,
      "plays": [{ "yellowCard": true, "scoringPlay": false }]
    }
  ]
}
```

### Mapping rules

- Filter `roster[]` to `starter === true && formationPlace !== "0"`
- Sort by `Number(formationPlace)` ascending (1 = GK, 2–11 = outfield)
- `formationPlace "1"` always maps to GK slot (index 0 in generatePositions)
- Normalize `position.abbreviation`: strip `-L`/`-R` suffix → `"CM-L"` → `"CM"`, `"CD-R"` → `"CD"`
- `yellowCard`: check `plays[].yellowCard === true`
- `redCard`: check `plays[].redCard === true`
- `subbedOut/subbedIn`: direct from roster fields

### Score extraction

From `boxscore.header.competitions[0].competitors[]`:
```ts
const home = competitors.find(c => c.homeAway === 'home');
const away = competitors.find(c => c.homeAway === 'away');
score = { home: Number(home.score), away: Number(away.score) }
```

---

## Character Canvas Renderer

The field is rendered as a 2D array of `Cell = { char: string; style: (s: string) => string }`.

### Field dimensions

```ts
const FIELD_COLS = 52;
const FIELD_ROWS = 26;
```

### Field lines (box-drawing characters)

Use Unicode box-drawing chars — NOT `+`, `-`, `|`:

```
Outer border:  ┌ ─ ┐ │ └ ┘
Boxes:         ┌ ─ ┐ │ └ ┘
Halfway line:  ┄ (U+2504)
Center spot:   ◉ (U+25C9)
Goal mouths:   ▐ ▌ on the top/bottom border
```

### Zones to draw

- Outer border (full perimeter)
- Halfway line at `row = Math.floor(FIELD_ROWS / 2)`
- Center spot at `col = Math.floor(FIELD_COLS / 2)`
- Top penalty box: cols 16–35, rows 1–5
- Bottom penalty box: cols 16–35, rows 20–24
- Top goal mouth: cols 22–29 on row 0
- Bottom goal mouth: cols 22–29 on row 25

### Player rendering

For each player at `(x, y)` in 0–1:
```ts
const col = Math.round(p.x * (FIELD_COLS - 4)) + 1;
const row = Math.round(p.y * (FIELD_ROWS - 4)) + 1;
```

Draw on canvas:
- `col`     → `●` in team chalk color
- `col+1`   → jersey number (2 chars, padded)
- `row+1`   → position label (3 chars, e.g. `"CM "`)

For yellow card: append `🟨` or use `chalk.yellow('!')` after the number if emoji not supported.
For red card: use `chalk.red('R')`.
For subbed out: use `chalk.dim`.

### Team color mapping

ESPN provides `color` as hex string without `#` (e.g. `"ffdd00"`).
Map to the nearest Chalk color:

```ts
function hexToChalkColor(hex: string): chalk.ForegroundColor {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  // use chalk.rgb(r, g, b) — Chalk 4+ supports this directly
  return chalk.rgb(r, g, b) as any;
}
```

White jerseys (`"FFFFFF"`) need a visible outline: use `chalk.bgWhite.black` or add border chars.

---

## Ink Component (`SoccerLineup.tsx`)

```tsx
interface SoccerLineupProps {
  espnBoxscore: any;   // raw ESPN JSON
}

export default function SoccerLineup({ espnBoxscore }: SoccerLineupProps)
```

### Layout

```
┌─────────────────────────────────────────────────────┐
│  Header: ECU 2–1 GER  |  MetLife Stadium  |  FT     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  [character canvas field — 52×26 chars]             │
│                                                     │
├─────────────────────────────────────────────────────┤
│  ECU 4-4-2    ←→ keys    GER 3-4-2-1               │
│  [formation badges]      [formation badges]          │
└─────────────────────────────────────────────────────┘
```

### Keyboard controls

Use `useInput` from Ink:

| Key      | Action                          |
|----------|---------------------------------|
| `q`      | Exit / close component          |
| `Tab`    | Toggle focus: home ↔ away       |
| `← / h`  | Previous formation (cycle)      |
| `→ / l`  | Next formation (cycle)          |
| `Enter`  | Confirm formation               |

Formation override is local state — it doesn't re-fetch, just re-runs `generatePositions`.

### Rendering flow

```ts
// 1. Parse ESPN data
const lineup: MatchLineup = mapESPNBoxscore(espnBoxscore);

// 2. Apply any local formation overrides (from keyboard)
const homeFormation = localOverride.home ?? lineup.home.formation;
const awayFormation = localOverride.away ?? lineup.away.formation;

// 3. Re-generate positions if overridden
const homePlayers = applyFormationOverride(lineup.home.players, homeFormation, false);
const awayPlayers = applyFormationOverride(lineup.away.players, awayFormation, true);

// 4. Build canvas
const canvas = makeCanvas();
drawField(canvas);
drawTeam(canvas, homePlayers, lineup.home.color);
drawTeam(canvas, awayPlayers, lineup.away.color);

// 5. Render rows
return (
  <Box flexDirection="column">
    {renderHeader(lineup)}
    {canvas.map((row, i) => <Text key={i}>{renderRow(row)}</Text>)}
    {renderControls(lineup, localOverride)}
  </Box>
);
```

---

## Usage in Sports Agent

```ts
// In the sports agent tool handler:
import { render } from 'ink';
import SoccerLineup from './components/SoccerLineup';

async function handleLineupRequest(gameId: string) {
  const boxscore = await fetchESPNBoxscore(gameId);
  render(<SoccerLineup espnBoxscore={boxscore} />);
}
```

ESPN boxscore endpoint:
```
https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/summary?event={gameId}
```

Where `{league}` is e.g. `fifa.world`, `esp.1`, `usa.1`, `mex.1`.

---

## Dependencies

Already available in the project:
- `ink` — React for CLIs
- `chalk` — terminal colors (use v4+ for `chalk.rgb()`)
- `react` — peer dep of ink

No new dependencies needed.

---

## What NOT to do

- Do NOT hardcode a formation dictionary (e.g. `{ "4-3-3": [...positions] }`). Use the algorithmic generator.
- Do NOT use `console.log` — use Ink's `<Text>` components exclusively.
- Do NOT use `localStorage`, `sessionStorage`, or any browser APIs.
- Do NOT use `position: absolute` CSS — this is a terminal app.
- Do NOT call `process.exit()` directly — use `useApp().exit()` from Ink.
- Do NOT use emoji unless Chalk fallback is provided (terminal compatibility varies).

---

## Testing the Component

To test manually without the full agent:

```ts
// test-lineup.tsx
import { render } from 'ink';
import SoccerLineup from './src/agents/sports/components/SoccerLineup';
import sampleData from './fixtures/espn-ecuador-germany.json';

render(<SoccerLineup espnBoxscore={sampleData} />);
```

Run with:
```bash
npx tsx test-lineup.tsx
```

The ESPN fixture JSON for Ecuador vs Germany (gameId `760468`) is the sample data
referenced throughout this spec.
