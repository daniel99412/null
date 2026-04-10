# ⚡ Forge CLI

A terminal-native AI CLI that turns natural language into real actions.

Forge is a lightweight, local-first developer tool that uses LLMs to understand your intent and execute tasks directly from your terminal — from generating files to automating workflows.

---

## 🚀 Features

* 🧠 Natural language → real actions
* ⚡ Fast, local-first (powered by Ollama)
* 📄 Generate files (PRDs, docs, code)
* 🔌 Extensible tool system (filesystem, APIs, etc.)
* 🗂️ Persistent memory (SQLite-based)
* 🛠️ Dev mode with full debugging visibility
* 🎯 Designed for developer workflows

---

## 🧰 Tech Stack

* **TypeScript**
* **CLI:** Commander
* **TUI:** Ink (planned)
* **LLM Runtime:** Ollama
* **Database:** SQLite

---

## 📦 Installation

```bash
git clone https://github.com/your-username/forge-cli.git
cd forge-cli
npm install
npm link
```

---

## 🧠 Requirements

* Node.js 18+
* Ollama installed and running locally

Pull a model:

```bash
ollama pull qwen2.5-coder:7b
```

---

## ⚡ Usage

```bash
forge "create a PRD for an inventory SaaS"
```

---

## 💡 Examples

### Generate a document

```bash
forge "create a product requirements document for a SaaS app"
```

### Continue a conversation

```bash
forge "continue the previous idea"
```

### (Planned) Create tickets

```bash
forge "generate Jira tickets from this idea"
```

---

## 🧠 How it works

1. You provide a natural language input
2. Forge sends context + prompt to a local LLM via Ollama
3. The model returns structured output (JSON)
4. Forge executes the corresponding action
5. Results are displayed in the terminal

---

## 🗂️ Memory System

* Conversations are stored locally using SQLite
* Supports session-based context
* Casual conversations expire after a defined time (TTL)
* Long-term project context is preserved
* Old conversations are summarized into lightweight memory

---

## 🛠️ Dev Mode

Enable debug mode to inspect internal behavior:

```bash
forge "create a PRD" --dev
```

Includes:

* Loaded context
* Generated prompts
* Execution steps
* Performance metrics

---

## 🧩 Roadmap

* [ ] JSON-based action system
* [ ] Filesystem tools (read/write)
* [ ] Google Calendar integration
* [ ] Jira integration
* [ ] Multi-step task execution
* [ ] Plugin system
* [ ] Interactive TUI (Ink)

---

## 🔒 Privacy

Forge is designed to run locally:

* No data is sent to external APIs (unless configured)
* Full control over your data and workflows
* Ideal for private codebases and sensitive environments

---

## 📄 License

MIT License

---

## ⚠️ Disclaimer

This project is experimental and under active development.
Use with caution when executing automated actions.

---

## 💥 Vision

Forge aims to become a developer-native AI interface:

* Not a chatbot
* Not a wrapper
* A real tool that understands intent and executes actions

---

## 🤝 Contributing

Contributions are welcome.
Feel free to open issues or submit pull requests.

---

## 🧠 Philosophy

> Less talking. More doing.

Forge is built around a simple idea:
AI should not just answer — it should act.

