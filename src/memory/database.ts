import Database from 'better-sqlite3'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { createRequire } from 'module'

const _require = createRequire(import.meta.url)

const DATA_DIR = path.join(os.homedir(), '.null-cli')
const DB_PATH = path.join(DATA_DIR, 'null.db')

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }

  db = new Database(DB_PATH)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // ── Core conversation tables ────────────────────────────────────────────────

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS session_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL UNIQUE,
      summary TEXT NOT NULL,
      message_count INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_session_summaries_session_id ON session_summaries(session_id);

    -- ── Cache tables ─────────────────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS search_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      query_key TEXT NOT NULL UNIQUE,
      result TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      ttl_seconds INTEGER NOT NULL DEFAULT 300
    );

    CREATE TABLE IF NOT EXISTS espn_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cache_key TEXT NOT NULL UNIQUE,
      result TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      ttl_seconds INTEGER NOT NULL DEFAULT 86400
    );

    CREATE INDEX IF NOT EXISTS idx_espn_cache_key ON espn_cache(cache_key);

    -- ── Legacy preferences table (kept for backward compat, data migrated below) ──

    CREATE TABLE IF NOT EXISTS user_preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      value TEXT NOT NULL,
      label TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(category, value)
    );

    CREATE INDEX IF NOT EXISTS idx_user_preferences_category ON user_preferences(category);

    -- ── Memory system ─────────────────────────────────────────────────────────

    -- Central memory store. One row per unique (type, value).
    CREATE TABLE IF NOT EXISTS memories (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      type        TEXT NOT NULL,   -- preference|tech_stack|occupation|project|goal|behavior|dislike|relationship|location|alias_self
      value       TEXT NOT NULL,   -- canonical, normalized (lowercase, trimmed)
      raw_value   TEXT,            -- how the user originally said it
      confidence  REAL NOT NULL DEFAULT 0.7,
      source      TEXT NOT NULL DEFAULT 'extracted' CHECK (source IN ('explicit', 'extracted', 'inferred')),
      expires_at  TEXT,            -- NULL = never expires
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(type, value)
    );

    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);

    -- Mutable score — updated on every mention, decayed over time.
    -- Kept separate from memories so score updates don't touch the main row's updated_at.
    CREATE TABLE IF NOT EXISTS memory_scores (
      memory_id    INTEGER PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
      score        REAL NOT NULL DEFAULT 0.7,
      recurrence   INTEGER NOT NULL DEFAULT 1,
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Alias/synonym table for deduplication and normalization.
    -- alias → (canonical, type): "zorros" → "atlas", type="preference"
    CREATE TABLE IF NOT EXISTS memory_aliases (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      alias     TEXT NOT NULL,
      canonical TEXT NOT NULL,
      type      TEXT NOT NULL,
      UNIQUE(alias, type)
    );

    CREATE INDEX IF NOT EXISTS idx_memory_aliases_alias ON memory_aliases(alias);

    -- Directional relations between memories (phase 2 — created empty now).
    CREATE TABLE IF NOT EXISTS memory_relations (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id    INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      to_id      INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      relation   TEXT NOT NULL,  -- 'part_of' | 'related_to' | 'contradicts'
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Log of every time a memory was mentioned in a session.
    CREATE TABLE IF NOT EXISTS memory_events (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      memory_id    INTEGER NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      session_id   TEXT,
      mentioned_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_memory_events_memory_id ON memory_events(memory_id);

    -- Log of retrieval calls (phase 2 — created empty now).
    CREATE TABLE IF NOT EXISTS retrieval_logs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      query      TEXT NOT NULL,
      memory_ids TEXT NOT NULL DEFAULT '[]',  -- JSON array of IDs
      was_useful INTEGER,                      -- 1/0/NULL
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ── ESPN catalog tables ───────────────────────────────────────────────────
    -- These replace static in-code maps in espn.ts.
    -- Editable at runtime: INSERT/UPDATE rows without recompiling.

    -- League aliases → ESPN API slug + sport (replaces LEAGUE_MAP + LEAGUE_SPORT_MAP)
    CREATE TABLE IF NOT EXISTS espn_leagues (
      alias        TEXT PRIMARY KEY,   -- normalized lowercase: 'liga mx', 'epl', 'laliga'
      league_slug  TEXT NOT NULL,      -- ESPN API slug: 'mex.1', 'eng.1', 'nba'
      sport        TEXT NOT NULL       -- ESPN sport path: 'soccer', 'basketball', 'football', 'baseball', 'hockey'
    );

    CREATE INDEX IF NOT EXISTS idx_espn_leagues_slug ON espn_leagues(league_slug);

    -- Team aliases → league slug + ESPN team ID (replaces TEAM_LEAGUE_MAP + TEAM_ID_MAP)
    CREATE TABLE IF NOT EXISTS espn_teams (
      alias        TEXT PRIMARY KEY,   -- normalized lowercase: 'atlas', 'zorros', 'man city'
      canonical    TEXT NOT NULL,      -- canonical team name: 'atlas', 'manchester city'
      league_slug  TEXT NOT NULL,      -- ESPN league slug: 'mex.1', 'eng.1'
      espn_id      TEXT               -- ESPN team ID (nullable — not all teams have one yet)
    );

    CREATE INDEX IF NOT EXISTS idx_espn_teams_canonical ON espn_teams(canonical);
    CREATE INDEX IF NOT EXISTS idx_espn_teams_league ON espn_teams(league_slug);

    -- ── Mexico News Digest tables ─────────────────────────────────────────────

    CREATE TABLE IF NOT EXISTS news_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      url TEXT NOT NULL,
      feed_url TEXT,
      bias_base REAL NOT NULL,
      reliability REAL NOT NULL,
      type TEXT NOT NULL,
      scope_json TEXT NOT NULL,
      anchor INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_checked_at TEXT,
      last_error TEXT,
      failure_count INTEGER NOT NULL DEFAULT 0,
      unavailable_reason TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS news_articles_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      title TEXT NOT NULL,
      snippet TEXT,
      published_at TEXT,
      fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      normalized_title TEXT,
      content_hash TEXT,
      category TEXT,
      raw_json TEXT,
      UNIQUE(source_id, url)
    );

    CREATE INDEX IF NOT EXISTS idx_news_articles_source ON news_articles_cache(source_id);
    CREATE INDEX IF NOT EXISTS idx_news_articles_published ON news_articles_cache(published_at);

    CREATE TABLE IF NOT EXISTS news_digest_cache (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scope TEXT NOT NULL,
      query TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL,
      UNIQUE(scope, query)
    );
  `)

  // ── Schema migrations ──────────────────────────────────────────────────────

  const sessionCols = db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]
  if (!sessionCols.some((c) => c.name === 'status')) {
    db.exec("ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
  }

  // ── Seed memory_aliases from canonical maps ────────────────────────────────

  seedAliases(db)

  // ── Seed ESPN catalog tables ───────────────────────────────────────────────

  seedEspnLeagues(db)
  seedEspnTeams(db)

  // ── Seed news sources ──────────────────────────────────────────────────────

  seedNewsSources(db)

  // ── Migrate user_preferences → memories ───────────────────────────────────

  migratePreferences(db)

  return db
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}

// ── Seed aliases ──────────────────────────────────────────────────────────────
//
// Loaded from src/seeds/aliases.json — edit the JSON to add new aliases
// without touching TypeScript source. INSERT OR IGNORE — safe on every startup.

type AliasSeedRow = { alias: string; canonical: string; type: string }

function seedAliases(database: Database.Database): void {
  const seedPath = path.resolve(path.dirname(_require.resolve('../memory/database.js')), '../seeds/aliases.json')
  let rows: AliasSeedRow[] = []
  try {
    rows = JSON.parse(fs.readFileSync(seedPath, 'utf-8')) as AliasSeedRow[]
  } catch {
    // File not found or parse error — skip seeding gracefully
    return
  }
  const insert = database.prepare(
    'INSERT OR IGNORE INTO memory_aliases (alias, canonical, type) VALUES (?, ?, ?)',
  )
  const insertMany = database.transaction((data: AliasSeedRow[]) => {
    for (const row of data) {
      insert.run(row.alias.toLowerCase(), row.canonical.toLowerCase(), row.type)
    }
  })
  insertMany(rows)
}

// ── ESPN leagues seed ─────────────────────────────────────────────────────────
//
// Replaces LEAGUE_MAP + LEAGUE_SPORT_MAP in espn.ts.
// INSERT OR IGNORE — safe to run on every startup. Add new leagues here only.

const ESPN_LEAGUES_SEED: { alias: string; league_slug: string; sport: string }[] = [
  // Liga MX
  { alias: 'liga mx', league_slug: 'mex.1', sport: 'soccer' },
  { alias: 'ligamx', league_slug: 'mex.1', sport: 'soccer' },
  { alias: 'liga mexicana', league_slug: 'mex.1', sport: 'soccer' },
  { alias: 'primera división de mexico', league_slug: 'mex.1', sport: 'soccer' },
  { alias: 'primera division de mexico', league_slug: 'mex.1', sport: 'soccer' },
  { alias: 'mexico', league_slug: 'mex.1', sport: 'soccer' },
  // MLS
  { alias: 'mls', league_slug: 'usa.1', sport: 'soccer' },
  { alias: 'major league soccer', league_slug: 'usa.1', sport: 'soccer' },
  { alias: 'liga americana', league_slug: 'usa.1', sport: 'soccer' },
  // Premier League
  { alias: 'premier league', league_slug: 'eng.1', sport: 'soccer' },
  { alias: 'premier', league_slug: 'eng.1', sport: 'soccer' },
  { alias: 'epl', league_slug: 'eng.1', sport: 'soccer' },
  { alias: 'liga inglesa', league_slug: 'eng.1', sport: 'soccer' },
  { alias: 'england', league_slug: 'eng.1', sport: 'soccer' },
  { alias: 'inglaterra', league_slug: 'eng.1', sport: 'soccer' },
  // La Liga
  { alias: 'la liga', league_slug: 'esp.1', sport: 'soccer' },
  { alias: 'laliga', league_slug: 'esp.1', sport: 'soccer' },
  { alias: 'liga española', league_slug: 'esp.1', sport: 'soccer' },
  { alias: 'liga espanola', league_slug: 'esp.1', sport: 'soccer' },
  { alias: 'españa', league_slug: 'esp.1', sport: 'soccer' },
  { alias: 'spain', league_slug: 'esp.1', sport: 'soccer' },
  // Serie A
  { alias: 'serie a', league_slug: 'ita.1', sport: 'soccer' },
  { alias: 'liga italiana', league_slug: 'ita.1', sport: 'soccer' },
  { alias: 'italia', league_slug: 'ita.1', sport: 'soccer' },
  { alias: 'italy', league_slug: 'ita.1', sport: 'soccer' },
  // Bundesliga
  { alias: 'bundesliga', league_slug: 'ger.1', sport: 'soccer' },
  { alias: 'liga alemana', league_slug: 'ger.1', sport: 'soccer' },
  { alias: 'alemania', league_slug: 'ger.1', sport: 'soccer' },
  { alias: 'germany', league_slug: 'ger.1', sport: 'soccer' },
  // Ligue 1
  { alias: 'ligue 1', league_slug: 'fra.1', sport: 'soccer' },
  { alias: 'ligue1', league_slug: 'fra.1', sport: 'soccer' },
  { alias: 'liga francesa', league_slug: 'fra.1', sport: 'soccer' },
  { alias: 'francia', league_slug: 'fra.1', sport: 'soccer' },
  { alias: 'france', league_slug: 'fra.1', sport: 'soccer' },
  // Champions League
  { alias: 'champions league', league_slug: 'uefa.champions', sport: 'soccer' },
  { alias: 'champions', league_slug: 'uefa.champions', sport: 'soccer' },
  { alias: 'ucl', league_slug: 'uefa.champions', sport: 'soccer' },
  { alias: 'liga de campeones', league_slug: 'uefa.champions', sport: 'soccer' },
  { alias: 'champions league europea', league_slug: 'uefa.champions', sport: 'soccer' },
  // Copa Libertadores
  { alias: 'libertadores', league_slug: 'conmebol.libertadores', sport: 'soccer' },
  { alias: 'copa libertadores', league_slug: 'conmebol.libertadores', sport: 'soccer' },
  { alias: 'conmebol libertadores', league_slug: 'conmebol.libertadores', sport: 'soccer' },
  // Liga Argentina
  { alias: 'liga argentina', league_slug: 'arg.1', sport: 'soccer' },
  { alias: 'argentina', league_slug: 'arg.1', sport: 'soccer' },
  { alias: 'primera argentina', league_slug: 'arg.1', sport: 'soccer' },
  // NBA
  { alias: 'nba', league_slug: 'nba', sport: 'basketball' },
  { alias: 'basketball', league_slug: 'nba', sport: 'basketball' },
  { alias: 'basquetbol', league_slug: 'nba', sport: 'basketball' },
  { alias: 'basquetball', league_slug: 'nba', sport: 'basketball' },
  // NFL
  { alias: 'nfl', league_slug: 'nfl', sport: 'football' },
  { alias: 'football americano', league_slug: 'nfl', sport: 'football' },
  { alias: 'futbol americano', league_slug: 'nfl', sport: 'football' },
  // MLB
  { alias: 'mlb', league_slug: 'mlb', sport: 'baseball' },
  { alias: 'baseball', league_slug: 'mlb', sport: 'baseball' },
  { alias: 'beisbol', league_slug: 'mlb', sport: 'baseball' },
  { alias: 'béisbol', league_slug: 'mlb', sport: 'baseball' },
  // NHL
  { alias: 'nhl', league_slug: 'nhl', sport: 'hockey' },
  { alias: 'hockey', league_slug: 'nhl', sport: 'hockey' },
]

function seedEspnLeagues(database: Database.Database): void {
  const insert = database.prepare(
    'INSERT OR IGNORE INTO espn_leagues (alias, league_slug, sport) VALUES (?, ?, ?)',
  )
  const insertMany = database.transaction((rows: typeof ESPN_LEAGUES_SEED) => {
    for (const row of rows) {
      insert.run(row.alias.toLowerCase(), row.league_slug, row.sport)
    }
  })
  insertMany(ESPN_LEAGUES_SEED)
}

// ── ESPN teams seed ───────────────────────────────────────────────────────────
//
// Replaces TEAM_LEAGUE_MAP + TEAM_ID_MAP in espn.ts.
// canonical = the canonical team name used by ESPN (used to group aliases).
// espn_id = numeric ESPN team ID (NULL for leagues/teams not yet mapped).

const ESPN_TEAMS_SEED: { alias: string; canonical: string; league_slug: string; espn_id: string | null }[] = [
  // ── Liga MX ──────────────────────────────────────────────────────────────
  { alias: 'america', canonical: 'america', league_slug: 'mex.1', espn_id: '227' },
  { alias: 'águilas', canonical: 'america', league_slug: 'mex.1', espn_id: '227' },
  { alias: 'aguilas', canonical: 'america', league_slug: 'mex.1', espn_id: '227' },
  { alias: 'club america', canonical: 'america', league_slug: 'mex.1', espn_id: '227' },
  { alias: 'atlas', canonical: 'atlas', league_slug: 'mex.1', espn_id: '216' },
  { alias: 'zorros', canonical: 'atlas', league_slug: 'mex.1', espn_id: '216' },
  { alias: 'chivas', canonical: 'chivas', league_slug: 'mex.1', espn_id: '219' },
  { alias: 'guadalajara', canonical: 'chivas', league_slug: 'mex.1', espn_id: '219' },
  { alias: 'rebaño', canonical: 'chivas', league_slug: 'mex.1', espn_id: '219' },
  { alias: 'rebano', canonical: 'chivas', league_slug: 'mex.1', espn_id: '219' },
  { alias: 'cruz azul', canonical: 'cruz azul', league_slug: 'mex.1', espn_id: '218' },
  { alias: 'la maquina', canonical: 'cruz azul', league_slug: 'mex.1', espn_id: '218' },
  { alias: 'la máquina', canonical: 'cruz azul', league_slug: 'mex.1', espn_id: '218' },
  { alias: 'pumas', canonical: 'pumas', league_slug: 'mex.1', espn_id: '233' },
  { alias: 'pumas unam', canonical: 'pumas', league_slug: 'mex.1', espn_id: '233' },
  { alias: 'tigres', canonical: 'tigres', league_slug: 'mex.1', espn_id: '232' },
  { alias: 'tigres uanl', canonical: 'tigres', league_slug: 'mex.1', espn_id: '232' },
  { alias: 'monterrey', canonical: 'monterrey', league_slug: 'mex.1', espn_id: '220' },
  { alias: 'rayados', canonical: 'monterrey', league_slug: 'mex.1', espn_id: '220' },
  { alias: 'toluca', canonical: 'toluca', league_slug: 'mex.1', espn_id: '223' },
  { alias: 'diablos rojos', canonical: 'toluca', league_slug: 'mex.1', espn_id: '223' },
  { alias: 'pachuca', canonical: 'pachuca', league_slug: 'mex.1', espn_id: '234' },
  { alias: 'tuzos', canonical: 'pachuca', league_slug: 'mex.1', espn_id: '234' },
  { alias: 'santos', canonical: 'santos laguna', league_slug: 'mex.1', espn_id: '225' },
  { alias: 'santos laguna', canonical: 'santos laguna', league_slug: 'mex.1', espn_id: '225' },
  { alias: 'guerreros', canonical: 'santos laguna', league_slug: 'mex.1', espn_id: '225' },
  { alias: 'leon', canonical: 'leon', league_slug: 'mex.1', espn_id: '228' },
  { alias: 'león', canonical: 'leon', league_slug: 'mex.1', espn_id: '228' },
  { alias: 'necaxa', canonical: 'necaxa', league_slug: 'mex.1', espn_id: '229' },
  { alias: 'rayos', canonical: 'necaxa', league_slug: 'mex.1', espn_id: '229' },
  { alias: 'puebla', canonical: 'puebla', league_slug: 'mex.1', espn_id: '231' },
  { alias: 'camoteros', canonical: 'puebla', league_slug: 'mex.1', espn_id: '231' },
  { alias: 'queretaro', canonical: 'queretaro', league_slug: 'mex.1', espn_id: '222' },
  { alias: 'querétaro', canonical: 'queretaro', league_slug: 'mex.1', espn_id: '222' },
  { alias: 'gallos', canonical: 'queretaro', league_slug: 'mex.1', espn_id: '222' },
  { alias: 'tijuana', canonical: 'tijuana', league_slug: 'mex.1', espn_id: '10125' },
  { alias: 'xolos', canonical: 'tijuana', league_slug: 'mex.1', espn_id: '10125' },
  { alias: 'juarez', canonical: 'juarez', league_slug: 'mex.1', espn_id: '17851' },
  { alias: 'juárez', canonical: 'juarez', league_slug: 'mex.1', espn_id: '17851' },
  { alias: 'bravos', canonical: 'juarez', league_slug: 'mex.1', espn_id: '17851' },
  { alias: 'mazatlan', canonical: 'mazatlan', league_slug: 'mex.1', espn_id: '20702' },
  { alias: 'mazatlán', canonical: 'mazatlan', league_slug: 'mex.1', espn_id: '20702' },
  { alias: 'san luis', canonical: 'atletico san luis', league_slug: 'mex.1', espn_id: '15720' },
  { alias: 'atletico san luis', canonical: 'atletico san luis', league_slug: 'mex.1', espn_id: '15720' },
  { alias: 'atlético san luis', canonical: 'atletico san luis', league_slug: 'mex.1', espn_id: '15720' },
  // ── La Liga ───────────────────────────────────────────────────────────────
  { alias: 'barcelona', canonical: 'barcelona', league_slug: 'esp.1', espn_id: null },
  { alias: 'real madrid', canonical: 'real madrid', league_slug: 'esp.1', espn_id: null },
  { alias: 'atletico madrid', canonical: 'atletico madrid', league_slug: 'esp.1', espn_id: null },
  { alias: 'atlético madrid', canonical: 'atletico madrid', league_slug: 'esp.1', espn_id: null },
  { alias: 'sevilla', canonical: 'sevilla', league_slug: 'esp.1', espn_id: null },
  { alias: 'valencia', canonical: 'valencia', league_slug: 'esp.1', espn_id: null },
  { alias: 'villarreal', canonical: 'villarreal', league_slug: 'esp.1', espn_id: null },
  { alias: 'athletic club', canonical: 'athletic club', league_slug: 'esp.1', espn_id: null },
  { alias: 'real sociedad', canonical: 'real sociedad', league_slug: 'esp.1', espn_id: null },
  // ── Premier League ────────────────────────────────────────────────────────
  { alias: 'manchester city', canonical: 'manchester city', league_slug: 'eng.1', espn_id: null },
  { alias: 'man city', canonical: 'manchester city', league_slug: 'eng.1', espn_id: null },
  { alias: 'arsenal', canonical: 'arsenal', league_slug: 'eng.1', espn_id: null },
  { alias: 'liverpool', canonical: 'liverpool', league_slug: 'eng.1', espn_id: null },
  { alias: 'chelsea', canonical: 'chelsea', league_slug: 'eng.1', espn_id: null },
  { alias: 'manchester united', canonical: 'manchester united', league_slug: 'eng.1', espn_id: null },
  { alias: 'man united', canonical: 'manchester united', league_slug: 'eng.1', espn_id: null },
  { alias: 'tottenham', canonical: 'tottenham', league_slug: 'eng.1', espn_id: null },
  { alias: 'spurs', canonical: 'tottenham', league_slug: 'eng.1', espn_id: null },
  { alias: 'newcastle', canonical: 'newcastle', league_slug: 'eng.1', espn_id: null },
  { alias: 'aston villa', canonical: 'aston villa', league_slug: 'eng.1', espn_id: null },
  // ── Serie A ───────────────────────────────────────────────────────────────
  { alias: 'juventus', canonical: 'juventus', league_slug: 'ita.1', espn_id: null },
  { alias: 'inter', canonical: 'inter', league_slug: 'ita.1', espn_id: null },
  { alias: 'milan', canonical: 'milan', league_slug: 'ita.1', espn_id: null },
  { alias: 'napoli', canonical: 'napoli', league_slug: 'ita.1', espn_id: null },
  { alias: 'roma', canonical: 'roma', league_slug: 'ita.1', espn_id: null },
  { alias: 'lazio', canonical: 'lazio', league_slug: 'ita.1', espn_id: null },
  // ── Bundesliga ────────────────────────────────────────────────────────────
  { alias: 'bayern', canonical: 'bayern munich', league_slug: 'ger.1', espn_id: null },
  { alias: 'bayern munich', canonical: 'bayern munich', league_slug: 'ger.1', espn_id: null },
  { alias: 'dortmund', canonical: 'borussia dortmund', league_slug: 'ger.1', espn_id: null },
  { alias: 'borussia dortmund', canonical: 'borussia dortmund', league_slug: 'ger.1', espn_id: null },
  { alias: 'bayer leverkusen', canonical: 'bayer leverkusen', league_slug: 'ger.1', espn_id: null },
  // ── NBA ───────────────────────────────────────────────────────────────────
  { alias: 'lakers', canonical: 'los angeles lakers', league_slug: 'nba', espn_id: null },
  { alias: 'los angeles lakers', canonical: 'los angeles lakers', league_slug: 'nba', espn_id: null },
  { alias: 'celtics', canonical: 'celtics', league_slug: 'nba', espn_id: null },
  { alias: 'warriors', canonical: 'warriors', league_slug: 'nba', espn_id: null },
  { alias: 'bulls', canonical: 'bulls', league_slug: 'nba', espn_id: null },
  { alias: 'heat', canonical: 'heat', league_slug: 'nba', espn_id: null },
  { alias: 'nets', canonical: 'nets', league_slug: 'nba', espn_id: null },
  { alias: 'knicks', canonical: 'knicks', league_slug: 'nba', espn_id: null },
  { alias: 'san antonio spurs', canonical: 'san antonio spurs', league_slug: 'nba', espn_id: null },
  { alias: 'suns', canonical: 'suns', league_slug: 'nba', espn_id: null },
]

function seedEspnTeams(database: Database.Database): void {
  const insert = database.prepare(
    'INSERT OR IGNORE INTO espn_teams (alias, canonical, league_slug, espn_id) VALUES (?, ?, ?, ?)',
  )
  const insertMany = database.transaction((rows: typeof ESPN_TEAMS_SEED) => {
    for (const row of rows) {
      insert.run(row.alias.toLowerCase(), row.canonical.toLowerCase(), row.league_slug, row.espn_id)
    }
  })
  insertMany(ESPN_TEAMS_SEED)
}

// ── Migrate user_preferences → memories ──────────────────────────────────────
//
// Runs once on startup. Existing preferences become memories with:
//   type = 'preference', source = 'explicit', score = 0.9 (high — user stated them)
// INSERT OR IGNORE ensures idempotency.

function migratePreferences(database: Database.Database): void {
  const prefs = database
    .prepare('SELECT category, value, label FROM user_preferences')
    .all() as { category: string; value: string; label: string | null }[]

  if (prefs.length === 0) return

  const insertMemory = database.prepare(`
    INSERT OR IGNORE INTO memories (type, value, raw_value, confidence, source)
    VALUES ('preference', ?, ?, 0.9, 'explicit')
  `)

  const getMemoryId = database.prepare(
    "SELECT id FROM memories WHERE type = 'preference' AND value = ?",
  )

  const insertScore = database.prepare(`
    INSERT OR IGNORE INTO memory_scores (memory_id, score, recurrence, last_seen_at)
    VALUES (?, 0.9, 1, datetime('now'))
  `)

  const migrate = database.transaction(() => {
    for (const pref of prefs) {
      insertMemory.run(pref.value, pref.label ?? pref.value)
      const row = getMemoryId.get(pref.value) as { id: number } | undefined
      if (row) {
        insertScore.run(row.id)
      }
    }
  })

  migrate()
}

// ── News sources seed ─────────────────────────────────────────────────────────
//
// INSERT OR IGNORE — safe on every startup. Existing rows are never overwritten.

interface NewsSourceSeed {
  name: string
  url: string
  feed_url: string | null
  bias_base: number
  reliability: number
  type: string
  scope_json: string
  anchor: number
}

const NEWS_SOURCES_SEED: NewsSourceSeed[] = [
  // ── Anclas (international wire / reference outlets) ─────────────────────
  // BBC Mundo is the most reliable news feed currently working in our
  // verification. It serves as the primary anchor for international coverage.
  {
    name: 'BBC Mundo',
    url: 'https://www.bbc.com/mundo',
    feed_url: 'https://feeds.bbci.co.uk/mundo/rss.xml',
    bias_base: 5.0, reliability: 0.92, type: 'international-news',
    scope_json: JSON.stringify(['mexico-impact', 'latin-america', 'world']),
    anchor: 1,
  },
  // ── Cobertura nacional ────────────────────────────────────────────────────
  {
    name: 'Quadratín México',
    url: 'https://mexico.quadratin.com.mx',
    feed_url: 'https://mexico.quadratin.com.mx/feed/atom/',
    bias_base: 5.0, reliability: 0.82, type: 'mexican-wire',
    scope_json: JSON.stringify(['mexico', 'states', 'politics']),
    anchor: 0,
  },
  // ── Centro / Nacional ────────────────────────────────────────────────────
  {
    name: 'Excélsior',
    url: 'https://www.excelsior.com.mx',
    feed_url: 'https://www.excelsior.com.mx/rss',
    bias_base: 5.5, reliability: 0.81, type: 'national-news',
    scope_json: JSON.stringify(['mexico', 'politics', 'economy', 'security']),
    anchor: 0,
  },
  // ── Economía / Negocios ──────────────────────────────────────────────────
  {
    name: 'El Financiero',
    url: 'https://www.elfinanciero.com.mx',
    feed_url: 'https://www.elfinanciero.com.mx/rss/feed.xml',
    bias_base: 6.0, reliability: 0.86, type: 'business-news',
    scope_json: JSON.stringify(['mexico', 'economy', 'business', 'mexico-impact']),
    anchor: 0,
  },
  {
    name: 'El Financiero Nacional',
    url: 'https://www.elfinanciero.com.mx/nacional',
    feed_url: 'https://www.elfinanciero.com.mx/nacional/rss',
    bias_base: 6.0, reliability: 0.86, type: 'business-news',
    scope_json: JSON.stringify(['mexico', 'politics', 'security']),
    anchor: 0,
  },
  {
    name: 'El Financiero Internacional',
    url: 'https://www.elfinanciero.com.mx/internacional',
    feed_url: 'https://www.elfinanciero.com.mx/internacional/rss',
    bias_base: 5.5, reliability: 0.85, type: 'business-news',
    scope_json: JSON.stringify(['mexico-impact', 'world']),
    anchor: 0,
  },
  // ── Izquierda ─────────────────────────────────────────────────────────────
  {
    name: 'La Jornada',
    url: 'https://www.jornada.com.mx',
    feed_url: 'https://www.jornada.com.mx/rss/edicion.xml',
    bias_base: 2.5, reliability: 0.82, type: 'national-news',
    scope_json: JSON.stringify(['mexico', 'politics', 'security', 'economy']),
    anchor: 0,
  },
  {
    name: 'La Jornada Política',
    url: 'https://www.jornada.com.mx/politica',
    feed_url: 'https://www.jornada.com.mx/rss/politica.xml',
    bias_base: 2.5, reliability: 0.82, type: 'national-news',
    scope_json: JSON.stringify(['mexico', 'politics']),
    anchor: 0,
  },
  {
    name: 'La Jornada Economía',
    url: 'https://www.jornada.com.mx/economia',
    feed_url: 'https://www.jornada.com.mx/rss/economia.xml',
    bias_base: 2.5, reliability: 0.82, type: 'national-news',
    scope_json: JSON.stringify(['mexico', 'economy', 'business']),
    anchor: 0,
  },
  {
    name: 'La Jornada Estados',
    url: 'https://www.jornada.com.mx/estados',
    feed_url: 'https://www.jornada.com.mx/rss/estados.xml',
    bias_base: 2.5, reliability: 0.82, type: 'national-news',
    scope_json: JSON.stringify(['mexico', 'states', 'security']),
    anchor: 0,
  },
  // ── Internacionales ───────────────────────────────────────────────────────
  {
    name: 'El País México',
    url: 'https://elpais.com/mexico',
    feed_url: 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/mexico/portada',
    bias_base: 4.5, reliability: 0.89, type: 'international-news',
    scope_json: JSON.stringify(['mexico', 'mexico-impact', 'latin-america']),
    anchor: 0,
  },
]

function seedNewsSources(database: Database.Database): void {
  // Use ON CONFLICT to UPSERT on name (which is UNIQUE) so that
  // feed_url/bias/etc. stay in sync with the seed when the list changes,
  // while preserving the source `id` so FK references in
  // news_articles_cache / news_digest_cache remain valid.
  const upsert = database.prepare(`
    INSERT INTO news_sources
      (name, url, feed_url, bias_base, reliability, type, scope_json, anchor)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      url = excluded.url,
      feed_url = excluded.feed_url,
      bias_base = excluded.bias_base,
      reliability = excluded.reliability,
      type = excluded.type,
      scope_json = excluded.scope_json,
      anchor = excluded.anchor,
      updated_at = datetime('now')
  `)
  const insertMany = database.transaction((rows: NewsSourceSeed[]) => {
    for (const row of rows) {
      upsert.run(row.name, row.url, row.feed_url, row.bias_base, row.reliability, row.type, row.scope_json, row.anchor)
    }
  })
  insertMany(NEWS_SOURCES_SEED)

  // Disable any sources that are no longer in the seed (e.g. a feed went
  // dead). We don't delete them so historical FK references stay valid.
  const seedNames = NEWS_SOURCES_SEED.map((r) => r.name)
  if (seedNames.length > 0) {
    const placeholders = seedNames.map(() => '?').join(',')
    database.prepare(`
      UPDATE news_sources
      SET enabled = 0, updated_at = datetime('now')
      WHERE name NOT IN (${placeholders})
    `).run(...seedNames)
  }
}

export function cleanCaches(): number {
  const db = getDb()
  let total = 0

  for (const table of ['search_cache', 'espn_cache', 'news_digest_cache', 'news_articles_cache']) {
    const count = db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number }
    db.prepare(`DELETE FROM ${table}`).run()
    total += count.c
  }

  return total
}
