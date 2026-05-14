# AGENTS.md

> **Project:** Null CLI - Your AI-powered virtual secretary that runs in the terminal.
> **Core purpose:** Act as a personal assistant that understands what you need and gets it done — answering questions, generating code, automating tasks, and more.

---

## Stack

- **Language:** TypeScript 5.x (strict mode)
- **Runtime:** Node.js 18+
- **Module:** ESM (`"type": "module"`)
- **CLI Framework:** Commander
- **LLM Runtime:** Ollama (local)
- **Database:** SQLite (`better-sqlite3`) at `~/.null-cli/null.db`
- **TUI:** Ink (React-based, active)
- **Package Manager:** pnpm

---

## Project Structure

```
src/
├── index.ts                  # Entry point
├── config/
│   └── index.ts              # NullConfig, DEFAULT_OLLAMA_URL, routerModel
├── core/
│   ├── agent.ts              # Main query pipeline (routing → tools → LLM)
│   ├── intent-classifier.ts  # CLLM: semantic intent classification with cache
│   ├── llm-client.ts         # getDefaultClient() / getRouterClient()
│   ├── ollama.ts             # streamChat() with DEFAULT_SYSTEM_PROMPT
│   └── router.ts             # Heuristic scorer + CLLM fallback → RoutingDecision
├── memory/
│   ├── database.ts           # SQLite schema, getDb(), seedAliases()
│   ├── memory-extractor.ts   # Extract memories from user messages (LLM-based)
│   ├── memory-gate.ts        # Decide if a message is worth extracting from
│   ├── memory-retrieval.ts   # retrieveMemories(), buildMemoryContext(), buildGeneralMemoryContext()
│   ├── memory-store.ts       # upsertMemory(), getMemoriesByType(), searchMemories()
│   ├── preferences.ts        # extractPreferencesFromQuery() (reads DB)
│   └── search-cache.ts       # TTL-based search result cache
├── seeds/
│   └── aliases.json          # ~104 sports alias seeds (copied to dist/seeds/ at build)
├── tools/
│   └── espn.ts               # ESPN API: scores, standings, news; detectLeague/detectTeam from DB
├── tui/
│   ├── App.tsx               # Main TUI app, routing dispatch, streamChat calls
│   ├── components/
│   │   ├── Input.tsx         # Dynamic-height input box (grows with text wrap)
│   │   └── ...               # Header, Footer, MessageList, CommandPalette, etc.
│   ├── context/
│   │   └── ThemeContext.tsx  # Accent color theme
│   └── hooks/                # useInput, useSession, etc.
└── utils/
    ├── debug.ts              # debugLog() — writes to stderr when NULL_DEBUG=1
    └── normalize.ts          # normalizeQuery()
```

---

## Commands

| Action | Command | Notes |
|--------|---------|-------|
| Development | `pnpm dev` | Uses tsx for hot reload |
| Build | `pnpm build` | `tsc && cp -r src/seeds dist/seeds` |
| Start | `pnpm start` | Runs compiled JS |
| Commit | `pnpm commit` | Interactive commitizen |
| Lint | (not configured) | Run before PRs |
| Typecheck | `npx tsc --noEmit` | Verify types |
| Debug | `NULL_DEBUG=1 pnpm start 2>debug.log` | Logs to stderr without polluting TUI |

---

## Conventions

### TypeScript
- Strict mode enabled — no `any` types
- Use explicit types for function parameters and returns
- Prefer interfaces over type aliases for object shapes
- Named exports over default exports

### File Naming
- kebab-case for files: `conversation-memory.ts`
- PascalCase for React components: `Spinner.tsx`

### Code Style
- No semicolons (ESM standard)
- Single quotes for strings
- Trailing commas
- 2-space indentation

### Error Handling
- Always handle errors gracefully with meaningful messages
- Use custom error classes for domain-specific errors

---

## Routing System

Queries go through a two-stage router before reaching the LLM:

### Stage 1 — Heuristic scorer (`router.ts`)
Weighted regex signals accumulate scores per `RoutingDecision`. Thresholds:
- `score >= 8` → confidence 1.0, decide immediately
- `score >= 5` → confidence 0.85, decide immediately
- `score < 5` → fall back to CLLM

### Stage 2 — CLLM (`intent-classifier.ts`)
Small model (`qwen2.5:3b`) classifies into `{ category, intent, anchor }`.
- In-memory cache: key = `sha1(last 4 msgs + query)`, TTL 5 min
- Returns up to 2 intents for mixed queries
- `mapCLLMToDecision()` translates to `RoutingDecision`

### RoutingDecision values
| Decision | Trigger |
|----------|---------|
| `sportsQuery` | scores, standings, fixtures → ESPN |
| `webSearch` | news, current events, transfers |
| `getDateTime` | time/date questions |
| `getWeather` | weather queries |
| `savePreference` | "soy del Atlas", "me gusta..." |
| `none` | conversation, factual, code → ReAct loop |

### Key routing rules
- Greetings, "cómo estás", "quién eres", "cómo me llamo" → always `none` (weight 12–20)
- Sports news/transfers → `webSearch` (weight 14–18), not `sportsQuery`
- CLLM low-confidence `webSearch` (< 0.6) → downgraded to `none` (ReAct decides)
- `none` + recency signal → overridden to `webSearch`

---

## Memory System

### Database tables
- `memories` — type, value (normalized), raw_value, confidence, source, expires_at
- `memory_scores` — recurrence scoring (+0.05 per repeat, capped 1.0)
- `memory_aliases` — canonical alias resolution (e.g. "ligamx" → "liga mx")
- `memory_relations`, `memory_events`, `retrieval_logs`
- `espn_leagues`, `espn_teams` — ESPN catalog (seeded at DB init)

### Memory types
| Type | Permanent | Weight |
|------|-----------|--------|
| `alias_self` | yes | 1.0 |
| `preference` | yes | 0.9 |
| `occupation` | yes | 0.85 |
| `tech_stack` | yes | 0.8 |
| `behavior` | yes | 0.75 |
| `dislike` | yes | 0.75 |
| `location` | yes | 0.75 |
| `relationship` | yes | 0.75 |
| `goal` | 180 days | 0.7 |
| `project` | 90 days | 0.6 |

### Memory injection
- `buildGeneralMemoryContext(query)` called in `processQueryWithReAct()` before building messages
- Injected as a system message with header: `[Known facts about the user you are talking to. Use this to answer personal questions about them, NOT about yourself.]`
- Sports queries use `buildSportsMemoryContext()` (only `preference` type)
- `src/seeds/aliases.json` seeded at DB init; must be copied to `dist/seeds/` at build

---

## LLM Integration

- Ollama runs locally (default: `http://localhost:11434`)
- Default model: `qwen2.5:3b` (router + CLLM); larger model for user responses
- Temperature: 0.3 when grounding on external data; default (0.8) for free conversation

### Prompt layers
```
1. DEFAULT_SYSTEM_PROMPT (ollama.ts) — identity "You are Null", tool list, grounding rules
2. Memory context block — user facts injected when available
3. Conversation history (filtered: no system messages from prior turns)
4. Search/weather/sports context as system message (if tool was used)
5. User message
```

### ReAct loop (`processQueryWithReAct`)
- Up to 3 iterations; LLM emits JSON tool calls or plain-text final answer
- Auto-forces `web_search` if first response looks uncertain (`looksUncertain()`)
- Memory context injected into system prompt on every call

---

## TUI

- Built with Ink (React for CLI)
- `Input.tsx` — dynamic height: grows to fit wrapped text based on terminal width
- `App.tsx` — main dispatch: routes `AgentResult` to appropriate LLM call path
- Sports commentary path uses separate `commentaryClient` with `buildSportsCommentaryPrompt()`

---

## Boundaries

**NEVER**
- Commit secrets, API keys, or `.env` files
- Send data to external APIs (unless explicitly configured)
- Execute destructive commands without confirmation
- Modify files outside the project without explicit permission

**ALWAYS**
- Run typecheck after changes: `npx tsc --noEmit`
- Build before testing: `pnpm build` (`tsc && cp -r src/seeds dist/seeds`)
- Follow existing code patterns
- Commit on branch `develop`

---

## Git Workflow

- All work on branch `develop`
- Commit messages follow conventional commits (`feat:`, `fix:`, `docs:`, etc.)
- Use `pnpm commit` for interactive commits
- Husky pre-commit hooks enabled

### Recent commits (develop)
| Hash | Description |
|------|-------------|
| `3fbdd80` | fix(memory): clarify user context header to avoid LLM perspective confusion |
| `6e759fe` | fix(router): add greeting/identity signals and fix CLLM low-confidence rule |
| `c0afba9` | fix(agent): inject memory context into ReAct system prompt + dynamic input height |
| `ddca311` | feat(router): replace LLM fallback with CLLM intent-classifier |

---

## Context for AI Agents

**IMPORTANT: Always check graphify-out first**
- Before reading the entire codebase, check `graphify-out/GRAPH_REPORT.md` for architecture context
- Use the knowledge graph in `graphify-out/graph.json` to understand code relationships
- Run `/graphify` (or `graphify .`) after code changes to update the graph

When working on Null:

1. **Understand the goal first** — This is a virtual secretary, not just a code generator
2. **Think about routing** — Every query goes through heuristic → CLLM → decision
3. **Memory is personal** — Facts about the user, not the assistant
4. **Consider the user** — The output should be useful in a terminal context
5. **Preserve context** — Memory and conversation history are important
6. **Be helpful** — Answer questions thoroughly, including web research when needed

---

## Known Behaviors & Gotchas

- ESPN `teams/{id}/news` returns `{}` for Liga MX — workaround: filter `leagueNews` by team name
- `src/seeds/aliases.json` must be in `dist/seeds/` at runtime — build copies it
- `NULL_DEBUG=1` activates debug logs to stderr without contaminating TUI stdout
- `PERMANENT_TYPES` memories never decay: `preference, tech_stack, occupation, behavior, dislike, location, alias_self`
- Small model (`qwen2.5:3b`) is unreliable for classifying greetings/personal questions — handle via heuristic signals
- Memory context header must say "about the user you are talking to" — otherwise LLM adopts user's name as its own

---

## Verification

After any code change:
```bash
pnpm build && npx tsc --noEmit
```
