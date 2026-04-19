# Null CLI Project Documentation

## 1. Project Overview
Null CLI is an AI-powered virtual secretary designed to run in the terminal. Its core purpose is to act as a personal assistant that understands user needs and executes them through various actions like answering questions (via web research or LLM knowledge), generating code, automating tasks, and creating documents. It prioritizes a local-first, privacy-preserving design.

-   **Core Purpose:** Act as a personal assistant that understands what you need and gets it done — answering questions, generating code, automating tasks, and more.
-   **Features:**
    -   Virtual secretary capabilities
    -   Answers questions via online research or LLM knowledge
    -   Generates and writes code
    -   Creates documents and files
    -   Web research (fetches info, summarizes articles)
    -   Extensible tool system (filesystem, APIs, web search)
    -   Persistent memory with SQLite for learning from past interactions
    -   Multi-turn natural conversations
    -   Fast and local-first, powered by Ollama
    -   Dev mode with debugging visibility
-   **Vision:** Null aims to be a capable assistant that handles whatever the user needs, going beyond a simple chatbot or code generator.

## 2. Tech Stack
The project is built with a focus on modern TypeScript development and local AI integration.

-   **Language:** TypeScript 5.x (strict mode)
-   **Runtime:** Node.js 18+
-   **Module:** ESM (`"type": "module"`)
-   **CLI Framework:** Commander
-   **LLM Runtime:** Ollama (local, default model: `qwen2.5-coder:7b`)
-   **Database:** SQLite (for memory/conversations)
-   **TUI:** Ink (React-based, planned for interactive UI)
-   **Package Manager:** npm

## 3. Project Structure
The `src/` directory is organized into logical modules:

```
src/
├── index.ts          # Entry point
├── cli/              # Command Line Interface logic
├── core/             # Core functionalities (LLM, tools, execution)
├── tools/            # Tool system (filesystem, web search, etc.)
├── llm/              # (Implicitly handled within core/ollama.ts for now)
├── memory/           # SQLite-based conversation storage
├── tui/              # Terminal User Interface components and logic
└── utils/            # General helpers
```

-   **Key Files:**
    -   `src/index.ts`: Main entry point for the CLI application.
    -   `src/cli/index.ts`: Commander.js setup for CLI arguments and actions, including TUI initialization and direct prompt execution.
    -   `src/config/index.ts`: Manages application configuration, including accent colors, stored in `~/.null-cli/config.json`.
    -   `src/core/ollama.ts`: Handles integration with the local Ollama LLM, streaming chat responses.
    -   `src/core/tools.ts`: Defines the available tools for the LLM.
    -   `src/core/execute.ts`: Executes actions based on LLM tool calls.
    -   `src/core/toolAction.ts`: Defines types for tool actions.
    -   `src/memory/database.ts`: Initializes and manages the SQLite database (`~/.null-cli/null.db`).
    -   `src/memory/sessions.ts`: Provides CRUD operations for chat sessions and messages.
    -   `src/memory/cleanup.ts`: Handles summarization and archiving of old chat sessions.
    -   `src/tools/web-search.ts`: Implements web search using DuckDuckGo HTML lite parsing, including Wikipedia extract fetching.
    -   `src/tools/web-fetch.ts`: Fetches and extracts readable text content from web pages.
    -   `src/tui/App.tsx`: The main React component for the interactive Terminal User Interface.
    -   `src/utils/markdown.ts`: Renders markdown strings for terminal output using `marked` and `marked-terminal`.
    -   `AGENTS.md`: Internal documentation for AI agents, detailing conventions, workflows, and operational guidelines.
    -   `README.md`: Public-facing project README.

## 4. Core Functionality

### 4.1. CLI Entry Point
The CLI is initiated through `src/index.ts`, which calls `runCLI` from `src/cli/index.ts`.
-   **`src/cli/index.ts`**:
    -   Uses Commander.js to define CLI commands and options (e.g., direct prompt execution, debug mode, session resumption).
    -   If no prompt is provided, it launches the interactive TUI.
    -   Direct prompts are streamed from Ollama, with output rendered as styled markdown.
    -   Includes basic error handling for Ollama connection issues.

### 4.2. Terminal User Interface (TUI)
The interactive TUI is built with React and Ink, providing a rich terminal experience.
-   **`src/tui/App.tsx` (Main TUI Application):**
    -   Manages application state: input, messages, active session, scroll offset, and overlay components (command palette, session list, color picker).
    -   Handles user input for navigation, commands (e.g., `/search`, `/new-session`, `ctrl+p` for command palette), and chat interactions.
    -   Integrates with Ollama for chat streaming, displaying loading indicators.
    -   Incorporates web search functionality (triggered by `/search` or automatically for certain queries) before sending to LLM.
    -   Manages session loading, saving messages, and auto-titling sessions.
    -   Initiates session cleanup on startup.
-   **Components:**
    -   `src/tui/components/Header.tsx`: Displays model name and current session ID.
    -   `src/tui/components/Input.tsx`: The chat input field, showing cursor and loading state.
    -   `src/tui/components/MessageList.tsx`: Renders chat messages, handling markdown and line wrapping.
    -   `src/tui/components/Splash.tsx`: An animated splash screen with the "null" logo on startup.
    -   `src/tui/components/CommandPalette.tsx`: An interactive overlay for selecting commands (sessions, new session, search, theme, clear, exit).
    -   `src/tui/components/SessionList.tsx`: An overlay for browsing, resuming, and deleting chat sessions.
    -   `src/tui/components/ColorPicker.tsx`: An overlay for changing the TUI accent color.
    -   `src/tui/components/Footer.tsx`: Displays status (loading bar, version), and keybind hints.
    -   `src/tui/components/Goodbye.tsx`: Displays an exit message with session details.
-   **Context:**
    -   `src/tui/context/ThemeContext.tsx`: Provides theme (accent color) context to TUI components, allowing dynamic color changes.
-   **Hooks:**
    -   `src/tui/hooks/useCursor.ts`: Manages blinking cursor visibility.
    -   `src/tui/hooks/useLoading.ts`: Controls loading state and animated loading bar position.
    -   `src/tui/hooks/useScroll.ts`: Manages scrolling behavior for message lists.
-   **Utilities:**
    -   `src/tui/utils/loading.ts`: Helper for rendering the loading bar.
    -   `src/tui/utils/text.ts`: Text wrapping and formatting utilities.

### 4.3. LLM Integration
The project integrates with Ollama, a local LLM runtime, to provide AI capabilities.
-   **`src/core/ollama.ts`**:
    -   Handles communication with the Ollama API (http://localhost:11434/api/chat).
    -   Supports streaming chat responses for a real-time typing effect.
    -   Uses a `DEFAULT_SYSTEM_PROMPT` to define the AI's persona and behavior.
    -   Allows custom messages and system prompts for specific contexts (e.g., session recall, tool use).
-   **System Prompt:** Guides the LLM to act as a concise, accurate, and helpful AI assistant, using natural language and incorporating recall context without explicitly mentioning the system.
-   **Model:** Currently configured to use `qwen2.5-coder:7b`.

### 4.4. Tool System
Null CLI has a tool-based architecture, allowing the LLM to perform actions.
-   **`src/core/tools.ts`**: Central registry for all callable tools.
-   **`src/core/execute.ts`**: Contains logic to execute tool actions based on the LLM's directives.
-   **`src/core/toolAction.ts`**: Defines the TypeScript types for various tool actions.
-   **Existing Tools:**
    -   `get_time()`: Returns current ISO time, local time, and date.
    -   `web_search(query: string)`: Performs a web search (using DuckDuckGo) and returns structured results, including a Wikipedia extract if available.
        -   **`src/tools/web-search.ts`**: Handles DuckDuckGo HTML parsing, result extraction (title, snippet, URL), and Wikipedia API calls for richer context.
    -   `web_fetch(url: string)`: Fetches a given URL and extracts clean, readable text content.
        -   **`src/tools/web-fetch.ts`**: Responsible for fetching web pages, stripping HTML, scripts, styles, and extracting main content areas.
-   **Planned Tools:** Web search/fetch (with enhancements), Google Calendar integration, Jira integration, generic API calls, filesystem tools (read/write, grep, glob, bash).

### 4.5. Memory System
A persistent memory system using SQLite allows Null to maintain conversation context across sessions.
-   **`src/memory/database.ts`**:
    -   Initializes and connects to the SQLite database located at `~/.null-cli/null.db`.
    -   Creates `sessions`, `messages`, and `session_summaries` tables if they don't exist.
    -   Enables WAL mode for better performance.
-   **`src/memory/sessions.ts`**:
    -   Provides functions for creating, retrieving, updating (title, timestamp), listing, and deleting chat sessions.
    -   Handles saving and retrieving individual chat messages within sessions.
    -   Supports archiving and reactivating sessions.
    -   Manages session summaries.
-   **`src/memory/cleanup.ts`**:
    -   Automatically identifies and processes "stale" sessions (e.g., older than 30 days).
    -   Summarizes long conversations using the LLM (via a separate non-streaming Ollama call) to save tokens.
    -   Archives summarized sessions and deletes old messages to optimize storage and performance.

### 4.6. Configuration
Application settings are stored in a JSON file in the user's home directory.
-   **`src/config/index.ts`**:
    -   Defines the configuration directory (`~/.null-cli`) and file (`config.json`).
    -   Manages `AccentColor` (e.g., cyan, green, blue) for the TUI.
    -   Provides functions to load, save, and update the application configuration.

### 4.7. Utilities
General helper functions.
-   **`src/utils/markdown.ts`**: Uses `marked` and `marked-terminal` to render markdown text into ANSI-styled terminal output.

## 5. Development Workflow
The project uses standard Node.js/TypeScript development practices.

-   **Commands:**
    -   `npm run dev`: Starts the application with `tsx` for hot reloading.
    -   `npm run build`: Compiles TypeScript to JavaScript in the `dist/` directory.
    -   `npm run start`: Runs the compiled JavaScript application.
    -   `npm run commit`: Initiates an interactive Commitizen commit flow.
    -   `npm run prepare`: Installs Husky hooks (e.g., `pre-commit`).
    -   `npx tsc --noEmit`: Verifies TypeScript types without compiling.
-   **Typechecking:** Strict TypeScript mode is enabled, and `npx tsc --noEmit` is used to verify types after changes.
-   **Git Workflow:**
    -   Commit messages follow conventional commits (e.g., `feat:`, `fix:`, `docs:`).
    -   Uses `npm run commit` for interactive commits.
    -   Husky pre-commit hooks are enabled.
-   **Verification:** After any code change, it's recommended to run `npm run build && npx tsc --noEmit`.

## 6. Conventions
The project adheres to specific coding and file naming conventions for consistency.

-   **TypeScript:**
    -   Strict mode enabled (no `any` types).
    -   Explicit types for function parameters and returns.
    -   Prefers interfaces over type aliases for object shapes.
    -   Named exports over default exports.
-   **File Naming:**
    -   kebab-case for files (e.g., `conversation-memory.ts`).
    -   PascalCase for React components (e.g., `Spinner.tsx`).
-   **Code Style:**
    -   No semicolons (ESM standard).
    -   Single quotes for strings.
    -   Trailing commas.
    -   2-space indentation.
-   **Error Handling:**
    -   Always handle errors gracefully with meaningful messages.
    -   Uses custom error classes for domain-specific errors.

## 7. Roadmap & Future Enhancements

### General Roadmap (from README.md)
-   JSON-based action system
-   Filesystem tools (read/write)
-   Google Calendar integration
-   Jira integration
-   Multi-step task execution
-   Plugin system
-   Interactive TUI (Ink) - *Note: Basic TUI already implemented, likely refers to further enhancements.*

### Web Search Enhancements (Planned, from `docs/web-search-enhancements.md`)
This is a detailed planned feature to improve web search capabilities:

-   **Overview:** Implement a "Trusted Sources" system that prioritizes official documentation and user-preferred websites. The system will learn from user behavior and allow natural language management of sources.
-   **Current State:** Uses DuckDuckGo HTML lite scraping, `web-search.ts` parses results, `web-fetch.ts` extracts text. Wikipedia extracts are fetched for top results.
-   **Planned Architecture:**
    -   **Trusted Sources Table (SQLite):** `trusted_sources` table to store domains, names, categories, and priorities.
    -   **Predefined Categories:** `programming`, `news`, `science`, `technology`, `entertainment`, `education`, `finance`, `health`, `sports`, `legal`, `general`.
    -   **Default Seeds:** Wikipedia, Stack Overflow, GitHub, MDN, Reddit, Medium, ArXiv, Hacker News will be default trusted sources.
-   **Search Flow — Priority Layers:**
    1.  DDG search.
    2.  LLM classifies results (official documentation, category).
    3.  Scrape by priority: Layer 1 (Official docs), Layer 2 (Trusted sources by category), Layer 3 (Other DDG results snippets). Max 3 pages scraped per search for speed.
    4.  Inject content into LLM with source labels for citing.
    -   **Parallelization Strategy:** LLM classification and initial web fetching run in parallel to minimize latency.
-   **Source Management — Natural Language:**
    -   Users can add, view, and remove sources conversationally (e.g., "always search dev.to for programming").
    -   Intent detection via regex on user input.
-   **Passive URL Learning:** When users share links, the system will optionally extract the domain, classify its category, and save it as a trusted source in the background.
-   **First-Time Search Prompt:** After the first web search, the user will be prompted to add favorite websites.
-   **Command Palette Integration:** "Manage Sources" option in the `ctrl+p` menu for power users.
-   **Design Decisions:** No external API keys (DuckDuckGo HTML lite), LLM-based classification (no hardcoded lists), parallel execution, natural language management, hybrid UX, limited scraping (max 3 pages).
-   **SerpApi Alternative:** A future consideration for richer results, requiring an API key.

## 8. Privacy & Disclaimer

-   **Privacy:** Null is designed for local execution. No data is sent to external APIs unless explicitly configured by the user. Users retain full control over their data and workflows, making it suitable for private codebases and sensitive environments.
-   **Disclaimer:** The project is experimental and under active development. Users should exercise caution when executing automated actions.

## 9. Notes for AI Agents (from AGENTS.md)
This section provides specific guidelines for AI agents working on the Null project:

1.  **Understand the goal first:** Focus on Null's purpose as a virtual secretary, not just a code generator.
2.  **Think about tools:** Evaluate if existing tools can handle a task or if a new tool is needed.
3.  **Consider the user:** Ensure output is useful in a terminal context.
4.  **Preserve context:** Maintain memory and conversation history.
5.  **Be helpful:** Answer questions thoroughly, including web research when needed.

**Operational Guidelines:**
-   **Tone & Style (CLI Interaction):** Concise, direct, minimal output, GitHub-flavored Markdown.
-   **Security and Safety:** Explain critical `bash` commands, never commit secrets, prioritize security best practices.
-   **Tool Usage:** Use absolute paths, execute independent tool calls in parallel, avoid interactive `bash` commands, respect user cancellations.
-   **Conventions:** Adhere to project conventions (TypeScript strict mode, kebab-case for files, no semicolons, single quotes, 2-space indentation, graceful error handling).
-   **Verification:** Always run `npm run build && npx tsc --noEmit` after code changes.
-   **Do Not revert changes:** Unless asked to by the user, or if they resulted in an error.
-   **Commit messages:** Follow conventional commits (`feat:`, `fix:`, `docs:`, etc.) and use `npm run commit`.
-   **Pull Requests:** Create PRs using `gh pr create`, providing a detailed summary.
-   **Todo List Tool:** Use `todowrite` for complex multi-step tasks to track progress.

**Boundaries:**
-   **NEVER:** Commit secrets, send data to external APIs (unless configured), execute destructive commands without confirmation, modify files outside the project without explicit permission.
-   **ALWAYS:** Run typecheck, test changes, follow existing code patterns.
