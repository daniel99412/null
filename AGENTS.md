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
- **Database:** SQLite (for memory/conversations)
- **TUI:** Ink (React-based, planned)
- **Package Manager:** pnpm

---

## Project Structure

```
src/
├── index.ts          # Entry point
├── tools/            # Tool system (filesystem, web search, etc.)
├── llm/              # Ollama integration
├── memory/           # SQLite-based conversation storage
└── utils/            # Helpers
```

---

## Commands

| Action | Command | Notes |
|--------|---------|-------|
| Development | `pnpm dev` | Uses tsx for hot reload |
| Build | `pnpm build` | Compiles to `dist/` |
| Start | `pnpm start` | Runs compiled JS |
| Commit | `pnpm commit` | Interactive commitizen |
| Lint | (not configured) | Run before PRs |
| Typecheck | `pnpm tsc --noEmit` | Verify types |

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

## Tool System

Null uses a tool-based architecture. Tools are functions the LLM can call to perform actions:

### Existing Tools
- `bash` — Execute shell commands
- `read` — Read file contents
- `write` — Write files to disk
- `grep` — Search file contents
- `glob` — Find files by pattern
- `graphify` — Knowledge graph from codebase (`/graphify <path>`) — installed as `graphifyy` Python package

### Planned Tools
- Web search/fetch
- Google Calendar integration
- Jira integration
- API calls

When adding new tools:
1. Define tool schema with name, description, parameters
2. Register in tool registry
3. Add to LLM system prompt
4. Document here

---

## LLM Integration

- Ollama runs locally (default: `http://localhost:11434`)
- Uses JSON structured output for tool calls
- Model: configurable (default: `qwen2.5-coder:7b`)

### Prompt Structure
```
1. System prompt with capabilities and constraints
2. Available tools with schemas
3. Conversation history
4. User request
```

---

## Memory System

- SQLite database for persistent storage
- Sessions track conversation context
- Old conversations are summarized to save tokens
- TTL for casual conversations (configurable)

---

## Boundaries

**NEVER**
- Commit secrets, API keys, or `.env` files
- Send data to external APIs (unless explicitly configured)
- Execute destructive commands without confirmation
- Modify files outside the project without explicit permission

**ALWAYS**
- Run typecheck after changes: `npx tsc --noEmit`
- Test changes before committing
- Follow existing code patterns

---

## Git Workflow

- Commit messages follow conventional commits (`feat:`, `fix:`, `docs:`, etc.)
- Use `pnpm commit` for interactive commits
- Husky pre-commit hooks enabled

---

## Context for AI Agents

**IMPORTANT: Always check graphify-out first**
- Before reading the entire codebase, check `graphify-out/GRAPH_REPORT.md` for architecture context
- Use the knowledge graph in `graphify-out/graph.json` to understand code relationships
- Run `/graphify` (or `graphify .`) after code changes to update the graph

When working on Null:

1. **Understand the goal first** — This is a virtual secretary, not just a code generator
2. **Think about tools** — Can existing tools handle this? Should a new tool be added?
3. **Consider the user** — The output should be useful in a terminal context
4. **Preserve context** — Memory and conversation history are important
5. **Be helpful** — Answer questions thoroughly, including web research when needed

---

## Verification

After any code change:
```bash
pnpm build && pnpm tsc --noEmit
```

---

## Notes

- This project prioritizes local-first, privacy-preserving design
- Ollama must be running locally for full functionality
- The CLI should feel fast and responsive
