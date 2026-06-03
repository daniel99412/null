# Tool System Refactor Plan

## Goal
Unify tool definitions into a single source of truth, add slash menu discovery, and clean up dead code.

## Current Problems
- Triple maintenance: `toolAction.ts` (types) + `tools.ts` (handlers) + `null-tools.ts` (schemas)
- Two execution paths with inconsistent tool availability
- Dead code: `execute.ts`, legacy `parseMaybeToolCall`
- No tool discovery for the user
- `/search` as magic prefix instead of unified slash command

## Phases

### Phase 1: Create `src/core/tool-definitions.ts`
Single source of truth with all tool definitions in an `as const` array.
Each entry: `{ name, description, inputSchema, handler, aliases[], showInSlashMenu, slashArgHint? }`
Derived: `ToolName`, `ToolAction`, `OllamaToolFormat[]`

### Phase 2: Simplify intermediate layers
- `null-tools.ts` → re-export from `tool-definitions`
- Remove `toolAction.ts` → type derived from definitions
- Remove `execute.ts` → dead shim
- `tools.ts` → thin re-export or remove
- `agent.ts` → replace `tools.*` calls with direct imports

### Phase 3: Registry additions
- Add `getSlashCommands(): SlashCommand[]` to `MCPRegistry`
- Derives from tool definitions with `showInSlashMenu: true`

### Phase 4: Agent cleanup
- Remove legacy `parseMaybeToolCall` and `isToolAction`
- Unify dispatch: routing + ReAct use same registry

### Phase 5: TUI — Ctrl+P + SlashMenu
- Add `tools` to `COMMANDS` array in App.tsx
- Create `SlashMenu.tsx` component
- Integrate into App.tsx: layout + `useInput` handler
- `/tools` as meta-command listing all slash commands

### Phase 6: Typecheck + Build + Regression
- `npx tsc --noEmit`
- `pnpm build`
- Manual regression: basic query, sports, weather, ReAct, Ctrl+P, slash menu
