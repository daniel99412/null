# ⚡ Null CLI

Your AI-powered virtual secretary that runs in the terminal.

Null is a personal assistant that understands what you need and gets it done — whether it's answering questions by researching online, generating code, automating tasks, or handling anything else you throw at it. All powered by local LLMs.

---

## 🚀 Features

- 🤖 Acts as your virtual secretary — understands what you need and does it
- 🧠 Answers questions by researching online or using LLM knowledge
- 💻 Generates and writes code directly
- 📄 Creates documents, files, and any content you need
- 🌐 Web research — fetches info, summarizes articles, answers questions
- 🔌 Extensible tool system (filesystem, APIs, web search, etc.)
- 🗂️ Persistent memory with SQLite — learns from past interactions
- 💬 Multi-turn conversations that feel natural
- ⚡ Fast and local-first (powered by Ollama)
- 🛠️ Dev mode with full debugging visibility

---

## 🧰 Tech Stack

- **TypeScript**
- **CLI:** Commander
- **TUI:** Ink (planned)
- **LLM Runtime:** Ollama
- **Database:** SQLite

---

## 📦 Installation

```bash
git clone https://github.com/your-username/Null-cli.git
cd Null-cli
npm install
npm link
```

---

## 🧠 Requirements

- Node.js 18+
- Ollama installed and running locally

Pull a model:

```bash
ollama pull qwen2.5-coder:7b
```

---

## ⚡ Usage

```bash
Null "create a PRD for an inventory SaaS"
```

---

## 💡 Examples

### Answer questions (web research)

```bash
Null "what are the latest developments in AI agents?"
Null "summarize this article: https://example.com/article"
```

### Generate code

```bash
Null "write a Python script to backup my database"
Null "create a React component for a login form"
```

### Generate documents

```bash
Null "create a product requirements document for a SaaS app"
Null "write a README for my project"
```

### Continue a conversation

```bash
Null "continue the previous idea"
```

### (Planned) Create tickets

```bash
Null "generate Jira tickets from this idea"
```

---

## 🧠 How it works

1. You describe what you need in plain language
2. Null understands your intent and decides how to help
3. If needed, it researches online or uses LLM knowledge
4. It executes the appropriate action (code, files, web search, etc.)
5. Results are delivered directly in your terminal

---

## 🗂️ Memory System

- Conversations are stored locally using SQLite
- Supports session-based context
- Casual conversations expire after a defined time (TTL)
- Long-term project context is preserved
- Old conversations are summarized into lightweight memory

---

## 🛠️ Dev Mode

Enable debug mode to inspect internal behavior:

```bash
Null "create a PRD" --dev
```

Includes:

- Loaded context
- Generated prompts
- Execution steps
- Performance metrics

---

## 🧩 Roadmap

- [ ] JSON-based action system
- [ ] Filesystem tools (read/write)
- [ ] Google Calendar integration
- [ ] Jira integration
- [ ] Multi-step task execution
- [ ] Plugin system
- [ ] Interactive TUI (Ink)

---

## 🔒 Privacy

Null is designed to run locally:

- No data is sent to external APIs (unless configured)
- Full control over your data and workflows
- Ideal for private codebases and sensitive environments

---

## 📄 License

MIT License

---

## ⚠️ Disclaimer

This project is experimental and under active development.
Use with caution when executing automated actions.

---

## 💥 Vision

Null aims to be your go-to virtual secretary:

- Not just a chatbot
- Not just a code generator
- A capable assistant that handles whatever you need

---

## 🤝 Contributing

Contributions are welcome.
Feel free to open issues or submit pull requests.

---

## 🧠 Philosophy

> Your AI secretary. Your terminal. Infinite possibilities.

Null is built around a simple idea:

AI should understand what you mean and get things done.
