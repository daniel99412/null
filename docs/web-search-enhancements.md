# Web Search Enhancements — Trusted Sources System

> Status: **Planned** — not yet implemented
> Date: April 17, 2026
> Branch: `develop`

---

## Overview

Implement a "Trusted Sources" system that prioritizes official documentation and user-preferred websites when performing web searches. The system learns from user behavior and allows natural language management of sources.

---

## Current State

- Web search works via **DuckDuckGo HTML lite** scraping (no API key, free)
- `src/tools/web-search.ts` — parses DDG HTML, extracts results (title, URL, snippet)
- `src/tools/web-fetch.ts` — fetches any URL and extracts text from HTML
- If a top result is from Wikipedia, grabs the intro extract for richer context
- Search intent is auto-detected via regex keyword matching in `App.tsx`

---

## Planned Architecture

### Trusted Sources Table (SQLite)

```sql
CREATE TABLE trusted_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL UNIQUE,
  name TEXT,
  category TEXT NOT NULL,
  priority INTEGER DEFAULT 5,
  added_by TEXT DEFAULT 'system',  -- 'system' | 'user' | 'learned'
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
)
```

### Predefined Categories

```typescript
const CATEGORIES = [
  'programming',
  'news',
  'science',
  'technology',
  'entertainment',
  'education',
  'finance',
  'health',
  'sports',
  'legal',
  'general',
] as const
```

### Default Seeds

| Domain                | Category      | Priority |
|-----------------------|---------------|----------|
| wikipedia.org         | education     | 10       |
| stackoverflow.com     | programming   | 9        |
| github.com            | programming   | 9        |
| developer.mozilla.org | programming   | 9        |
| reddit.com            | general       | 6        |
| medium.com            | technology    | 5        |
| arxiv.org             | science       | 8        |
| news.ycombinator.com  | technology    | 7        |

---

## Search Flow — Priority Layers

```
1. User asks a question (e.g. "what's new in React 19?")

2. DDG HTML lite search → returns 10-15 results

3. Classify results (LLM via Ollama):
   - Which result is the OFFICIAL documentation?
   - What category is this query?

4. Scrape by priority layers:

   LAYER 1 — Official docs (ALWAYS, 100%)
   → LLM identifies which result is official
   → web_fetch that URL

   LAYER 2 — Trusted sources (by category from DB)
   → Match results against trusted_sources WHERE category = detected_category
   → Scrape top 1-2 by priority

   LAYER 3 — Other DDG results
   → Include snippets only (no scraping)

5. Inject into LLM with source labels:
   [OFFICIAL DOCS — react.dev]
   ...scraped content...

   [TRUSTED SOURCE — stackoverflow.com]
   ...scraped content...

   [WEB RESULT — blog.example.com]
   ...snippet from DDG...

   Based on the above sources (prioritize official docs), answer the user's question. Cite sources.
```

### Parallelization Strategy (Option C)

To minimize latency, run classification and initial scraping in parallel:

```
DDG search → results
  ├─ (parallel) Ollama classifies (category + official doc)
  └─ (parallel) web_fetch result #1 (usually the official doc)

When both complete:
  - If LLM says #1 was official → already have it
  - If LLM says #3 was official → scrape #3 too
  - Scrape 1-2 trusted sources matching category
  
Total scraping: max 3 pages per search
```

---

## Source Management — Natural Language (no commands)

Everything is managed conversationally. No `/sources` commands.

### Adding sources

```
User: "para temas de programacion siempre busca en dev.to"
→ LLM detects "add source" intent
→ Saves dev.to with category programming
→ Responds: "Listo, voy a priorizar dev.to para temas de programacion"

User: "when searching for tech news use ars technica and the verge"
→ Saves both with category technology
→ Responds: "Saved Ars Technica and The Verge as trusted sources for technology"
```

### Viewing sources

```
User: "que sitios tienes guardados?"
User: "what are my trusted sources?"
→ Lists trusted sources by category
```

### Removing sources

```
User: "ya no uses medium para nada"
→ Removes medium.com from trusted_sources
→ Responds: "Elimine Medium de tus fuentes de confianza"
```

### Intent Detection (regex)

```typescript
const isSourceManagement = /\b(siempre\s+(busca|usa|consulta)|prioriza|usa\s+(como|de)\s+fuente|no\s+uses|quita|elimina|que\s+sitios|fuentes\s+de\s+confianza|trusted\s+sources|favorite\s+sites|always\s+use|stop\s+using|remove\s+source)\b/i.test(txt)
```

---

## Passive URL Learning

When a user shares a link in conversation:

```
User: "revisa esto https://techcrunch.com/2025/04/ai-news..."
→ LLM processes the content
→ Background: extract domain, classify via LLM, save to DB
→ Subtle message: "(Saved techcrunch.com as a trusted source for technology)"

Next time user asks about tech news:
→ techcrunch.com appears as a trusted source automatically
```

---

## First-Time Search Prompt

On the first web search ever, after showing results:

> "Do you have any favorite websites you'd like me to prioritize for future searches? (e.g. dev.to, reddit.com)"

User's response is parsed, categorized via LLM, and saved with `added_by = 'user'`.

---

## Command Palette Integration

Add "Manage Sources" to ctrl+p menu:
- View all trusted sources by category
- Add new source (prompts for domain)
- Remove source (select from list)

This gives power users a quick visual way to manage sources without typing.

---

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/memory/database.ts` | Add `trusted_sources` table + default seeds |
| `src/memory/sources.ts` | **NEW** — CRUD for trusted sources |
| `src/tools/search-classifier.ts` | **NEW** — LLM classification (category + official doc) |
| `src/tools/web-search.ts` | Rewrite: priority layers + trusted source filtering |
| `src/tools/web-fetch.ts` | Improve scraping (smart truncation) |
| `src/core/tools.ts` | Update tools registry |
| `src/core/ollama.ts` | Update system prompt with categories |
| `src/tui/App.tsx` | URL learning + first-time prompt + source management intent |

---

## Design Decisions

1. **No SerpApi / no API keys** — DuckDuckGo HTML lite is free, works, zero dependencies
2. **LLM classifies (Option B)** — no hardcoded `Record<string, string>` of official docs; works for any domain (programming, law, education, etc.)
3. **Parallel execution (Option C)** — LLM classification runs in parallel with initial scraping to minimize latency
4. **Natural language management** — no `/source` commands; everything is conversational
5. **Hybrid UX** — natural language as primary, ctrl+p command palette as power-user shortcut
6. **Max 3 pages scraped per search** — 1 official + 2 trusted sources for speed

---

## SerpApi Alternative

If in the future we want more reliable/richer results, SerpApi can replace DDG:
- Free tier: 100 searches/month
- `engine=google` for Google results
- JSON response (no HTML parsing)
- Would require `SERPAPI_KEY` in env var or `~/.null-cli/config.json`
- The rest of the architecture (trusted sources, classification, scraping layers) stays identical
