# Commit Standards

Null uses Conventional Commits so history stays readable, searchable, and useful during reviews.

## Format

```text
<type>(<scope>): <clear summary>

<body with context, impact, and important implementation notes>
```

The subject must be short, specific, and written in imperative style. The body is required when the change affects behavior, architecture, data, prompts, tests, or user experience.

## Types

- `feat`: Adds a new user-visible capability.
- `fix`: Corrects a bug or regression.
- `docs`: Updates documentation only.
- `test`: Adds or updates tests without changing production behavior.
- `refactor`: Changes structure without changing behavior.
- `chore`: Updates tooling, dependencies, generated files, or maintenance tasks.
- `perf`: Improves performance.
- `build`: Changes build or packaging behavior.

## Scopes

Prefer the smallest meaningful subsystem scope:

- `agent`
- `router`
- `memory`
- `docs`
- `documents`
- `tui`
- `tools`
- `config`
- `tests`

Examples:

```text
fix(tui): close file autocomplete after selecting an attachment
feat(documents): isolate attached file context from prior document turns
docs(commits): document professional commit message standards
```

## Body Checklist

Use the body to explain:

- What changed.
- Why it changed.
- User-visible behavior or compatibility impact.
- Any tests, build, or manual verification performed.
- Known limitations or follow-up work when relevant.

## Good Examples

```text
fix(tui): prevent file autocomplete from capturing send

Limit @file suggestions to the reference currently under the cursor and hide
the menu once the selected path exactly matches a file. This prevents Enter
from being captured by the file menu after the user has already chosen an
attachment.

Verified with:
- npx tsc --noEmit
- pnpm build
```

```text
feat(documents): add isolated attachment mode

Read @file references through the direct document-context path and build a
file-scoped prompt that prioritizes the current attachment over prior turns.
The prompt now includes read status, file metadata, line counts, truncation
state, and numbered content windows for line-specific questions.

This keeps answers about @b.md from being contaminated by previous answers
about @a.md.

Verified with:
- pnpm test tests/document-context.test.ts
- pnpm build
- npx tsc --noEmit
```

## Avoid

- Vague subjects like `fix stuff`, `updates`, or `changes`.
- Mixing unrelated features in one commit.
- Hiding user-visible behavior changes in a `chore` commit.
- Omitting verification details for risky code changes.
- Committing secrets, `.env` files, debug logs, or private tokens.
