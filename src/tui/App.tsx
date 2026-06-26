import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { render, Box, Text, useInput, useApp } from 'ink'
import { streamChat } from '../core/ollama.js'
import { useLoading } from './hooks/useLoading.js'
import { useCursor } from './hooks/useCursor.js'
import { Splash } from './components/Splash.js'

import { FileMenu } from './components/FileMenu.js'
import type { FileEntry } from './components/FileMenu.js'
import { searchFiles } from './utils/file-search.js'

import { MessageList, countRenderedLines } from './components/MessageList.js'
import type { ChatMessage } from './components/MessageList.js'
import { Input } from './components/Input.js'
import { Footer } from './components/Footer.js'
import { printGoodbye } from './components/Goodbye.js'
import { CommandPalette } from './components/CommandPalette.js'
import type { CommandItem } from './components/CommandPalette.js'
import { NewsList } from './components/NewsList.js'
import { MatchList } from './components/MatchList.js'
import { MatchDetail } from './components/MatchDetail.js'
import { SlashMenu } from './components/SlashMenu.js'
import type { SlashCommandEntry } from './components/SlashMenu.js'
import { getRegistry } from '../mcp/registry.js'
import { SessionList } from './components/SessionList.js'
import { ColorPicker } from './components/ColorPicker.js'
import { Keybindings } from './components/Keybindings.js'
import { FirstRunSetup } from './components/FirstRunSetup.js'
import { Sidebar, SIDEBAR_WIDTH } from './components/Sidebar.js'
import { ArticleReader } from './components/ArticleReader.js'
import type { DigestArticle, DigestMatch } from '../core/agent.types.js'
import { ThemeProvider } from './context/ThemeContext.js'
import {
  createSession,
  getSession,
  getSessionMessages,
  saveMessage,
  updateSessionTitle,
  getSummary,
  reactivateSession,
  deleteSession,
  deleteAllSessions,
  closeDb,
} from '../memory/sessions.js'
import type { Session } from '../memory/sessions.js'
import { runCleanup } from '../memory/cleanup.js'
import { loadConfig, isFirstRun } from '../config/index.js'
import { processQuery, processQueryWithReAct } from '../core/agent.js'
import { cleanCaches } from '../memory/database.js'
import {
  buildFileScopedHistory,
  buildDocumentContextMessage,
  buildDocumentResponseInstruction,
  resolveDocumentParts,
  stripDocumentRefs,
} from '../core/document-context.js'

const COMMANDS: CommandItem[] = [
  { id: 'sessions', label: 'Sessions', description: 'Browse and resume previous sessions', shortcut: '' },
  { id: 'theme', label: 'Theme', description: 'Change the accent color of the UI', shortcut: '' },
  { id: 'clear', label: 'Clear Messages', description: 'Clear the current chat display', shortcut: '' },
  { id: 'clean-caches', label: 'Clean Caches', description: 'Clear cached data (search, news, sports)', shortcut: '' },
  { id: 'tools', label: 'Tools', description: 'List all available tools', shortcut: '/' },
  { id: 'keybindings', label: 'Keybindings', description: 'Show available keyboard shortcuts', shortcut: 'ctrl+h' },
  { id: 'exit', label: 'Exit', description: 'Close null CLI', shortcut: 'ctrl+c' },
]

type Overlay = 'none' | 'command-palette' | 'sessions' | 'color-picker' | 'confirm-delete-session' | 'confirm-delete-all' | 'news-list' | 'article-reader' | 'keybindings' | 'match-list' | 'match-detail'

interface ChatProps {
  resumeSessionId?: string
  onExit: (sessionId: string, sessionDate: string, hasMessages: boolean, messageCount: number) => void
}

interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}

function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }: ConfirmDialogProps) {
  useInput((char, key) => {
    if (key.escape || char?.toLowerCase() === 'n') {
      onCancel()
      return
    }

    if (key.return || char?.toLowerCase() === 'y') {
      onConfirm()
    }
  })

  const cols = process.stdout?.columns || 80
  const rows = process.stdout?.rows || 24
  const width = Math.min(64, cols - 4)

  return (
    <Box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
    >
      <Box
        flexDirection="column"
        width={width}
        borderStyle="round"
        borderColor="red"
        paddingX={1}
        backgroundColor="black"
      >
        <Box marginBottom={1}>
          <Text color="red" bold>{title}</Text>
        </Box>
        <Box marginBottom={1}>
          <Text color="white">{message}</Text>
        </Box>
        <Box>
          <Text color="gray">enter/y </Text>
          <Text color="red">{confirmLabel}</Text>
          <Text color="gray">  n/esc cancel</Text>
        </Box>
      </Box>
    </Box>
  )
}

function deleteWordBefore(text: string, pos: number): { text: string; pos: number } {
  if (pos === 0) return { text, pos: 0 }
  let end = pos
  while (end > 0 && /\s/.test(text[end - 1])) end--
  let start = end
  while (start > 0 && !/\s/.test(text[start - 1])) start--
  return {
    text: text.slice(0, start) + text.slice(pos),
    pos: start,
  }
}

function getActiveFileReference(input: string, cursorPos: number): { atIndex: number; pattern: string } | null {
  const beforeCursor = input.slice(0, cursorPos)
  const atIndex = beforeCursor.lastIndexOf('@')
  if (atIndex < 0) return null

  const tokenBeforeCursor = input.slice(atIndex, cursorPos)
  if (/\s/.test(tokenBeforeCursor)) return null

  const afterAt = input.slice(atIndex + 1)
  const pattern = afterAt.split(/\s/)[0]
  if (!pattern.trim()) return null

  return { atIndex, pattern }
}

function Chat({ resumeSessionId, onExit }: ChatProps) {
  const { exit } = useApp()

  const terminalWidth = process.stdout?.columns || 80
  const terminalHeight = process.stdout?.rows || 24
  const mainContentWidth = terminalWidth - SIDEBAR_WIDTH
  const inputHeight = 3
  const footerHeight = 3
  const contentHeight = terminalHeight - inputHeight - footerHeight - 1

  const [input, setInput] = useState('')
  const [cursorPos, setCursorPos] = useState(0)
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0)

  const [statusText, setStatusText] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const messagesRef = useRef<ChatMessage[]>([])

  // Keep ref in sync with state
  const updateMessages = useCallback((updater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
    setMessages((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater
      messagesRef.current = next
      return next
    })
  }, [])
  const [session, setSession] = useState<Session>(() => {
    if (resumeSessionId) {
      const existing = getSession(resumeSessionId)
      if (existing) return existing
    }
    return createSession()
  })
  const [scrollOffset, setScrollOffset] = useState(0)
  const [overlay, setOverlay] = useState<Overlay>('none')
  const [pendingDeleteSessionId, setPendingDeleteSessionId] = useState<string | null>(null)
  const [digestArticles, setDigestArticles] = useState<Array<{ position: number; title: string; url: string; source: string; category: string }>>([])
  const [digestMatches, setDigestMatches] = useState<DigestMatch[]>([])
  const [newsKeySequence, setNewsKeySequence] = useState<'idle' | 'awaiting-down'>('idle')
  const [matchKeySequence, setMatchKeySequence] = useState<'idle' | 'awaiting-down'>('idle')
  const [readingArticle, setReadingArticle] = useState<DigestArticle | null>(null)
  const [articleReaderReturnOverlay, setArticleReaderReturnOverlay] = useState<Overlay | null>(null)
  const [selectedMatch, setSelectedMatch] = useState<DigestMatch | null>(null)
  const [matchDetailReturnOverlay, setMatchDetailReturnOverlay] = useState<Overlay | null>(null)
  const [fileMatches, setFileMatches] = useState<FileEntry[]>([])
  const [fileSelectedIndex, setFileSelectedIndex] = useState(0)
  const messageCountRef = useRef(0)
  const welcomeDoneRef = useRef(false)

  // Welcome greeting: when Chat mounts fresh (not resumed), greet the user warmly
  useEffect(() => {
    if (resumeSessionId || welcomeDoneRef.current) return
    welcomeDoneRef.current = true

    const config = loadConfig()
    const name = config.userName

    const welcomePrompt = name
      ? `Warmly greet ${name} and ask how you can help today. Reply in Spanish because this is the app's default welcome language. Maximum 2 lines. Do not use emojis.`
      : `Warmly greet the user and offer help. Reply in Spanish because this is the app's default welcome language. Maximum 2 lines. Do not use emojis.`

    let buffer = ''
    startLoading()

    streamChat(
      '',
      (token) => {
        buffer += token
        updateMessages([{ role: 'assistant', content: buffer }])
      },
      [{ role: 'user', content: welcomePrompt }],
      'You are Null, a friendly and helpful personal AI assistant. Reply in the language requested by the user prompt.',
      { temperature: 0.7 },
    ).then(() => {
      stopLoading()
    }).catch(() => {
      stopLoading()
    })
  }, [resumeSessionId])

  // Load existing messages when resuming a session
  useEffect(() => {
    if (resumeSessionId) {
      const s = getSession(resumeSessionId)
      if (s && s.status === 'archived') {
        // Archived session: show recall message
        reactivateSession(resumeSessionId)
        const summary = getSummary(resumeSessionId)
        if (summary) {
          updateMessages([{ role: 'recall', content: summary.summary }])
        }
        messageCountRef.current = 0
      } else {
        const existing = getSessionMessages(resumeSessionId)
        if (existing.length > 0) {
          updateMessages(existing)
          messageCountRef.current = existing.length
        }
      }
    }
  }, [resumeSessionId])

  const { isLoading, loadingPos, loadingDir, startLoading, stopLoading } = useLoading()
  const { isVisible: cursorVisible } = useCursor(isLoading)

  // ── Slash menu ──────────────────────────────────────────────────────────
  const slashActive = input.startsWith('/') && !isLoading

  const slashCommands = useMemo(() => getRegistry().getSlashCommands(), [])

  const filteredSlashCommands = useMemo(() => {
    if (!slashActive) return []
    const filter = input.slice(1).toLowerCase()
    if (!filter) return slashCommands
    return slashCommands.filter((c) => c.alias.toLowerCase().startsWith(filter))
  }, [slashCommands, slashActive, input])

  // Reset selection when filter changes
  useEffect(() => {
    setSlashSelectedIndex(0)
  }, [filteredSlashCommands.length])

  const executeSlashCommand = useCallback((alias: string) => {
    if (alias === 'tools') {
      const registry = getRegistry()
      const toolList = registry.listTools()
      const formatted = toolList.map(t => `  ${t.name.padEnd(28)} ${t.description.split('.')[0]}`).join('\n')
      const msg = `Available tools:\n${formatted}`
      saveMessage(session.id, 'user', '/tools')
      updateMessages((m) => [...m, { role: 'user', content: '/tools' }, { role: 'assistant', content: msg } as ChatMessage])
      messageCountRef.current++
    }
  }, [session.id, updateMessages])

  const buffer = useRef('')

  // ── File reference (@file) detection ───────────────────────────────────
  useEffect(() => {
    const activeRef = getActiveFileReference(input, cursorPos)
    if (!activeRef || isLoading) {
      setFileMatches([])
      return
    }

    const matches = searchFiles(activeRef.pattern)
    const hasExactMatch = matches.some((file) => file.relativePath === activeRef.pattern)
    setFileMatches(hasExactMatch ? [] : matches)
    setFileSelectedIndex(0)
  }, [input, cursorPos, isLoading])

  const fileMenuActive = fileMatches.length > 0 && !isLoading && overlay === 'none'

  const totalLines = countRenderedLines(messages, terminalWidth)
  const hasMoreLines = totalLines > contentHeight
  const isAtBottom = scrollOffset === 0

  const handleUp = useCallback(() => {
    const maxScroll = Math.max(0, totalLines - contentHeight)
    setScrollOffset((s) => Math.min(s + 3, maxScroll))
  }, [totalLines, contentHeight])

  const handleDown = useCallback(() => {
    setScrollOffset((s) => Math.max(s - 3, 0))
  }, [])

  const handleExit = useCallback(() => {
    const hasMessages = messageCountRef.current > 0
    onExit(session.id, session.created_at, hasMessages, messageCountRef.current)
  }, [session.id, session.created_at, onExit, messageCountRef])

  const handleNewSession = useCallback(() => {
    const newSession = createSession()
    setSession(newSession)
    updateMessages([])
    setScrollOffset(0)
    messageCountRef.current = 0
    setOverlay('none')
  }, [])

  const replaceWithNewSession = useCallback(() => {
    const newSession = createSession()
    setSession(newSession)
    updateMessages([])
    setScrollOffset(0)
    messageCountRef.current = 0
  }, [updateMessages])

  const handleRequestDeleteSession = useCallback((sessionId: string) => {
    const isCurrent = sessionId === session.id
    deleteSession(sessionId)
    if (isCurrent) {
      replaceWithNewSession()
    }
    setOverlay('sessions')
  }, [session.id, replaceWithNewSession])

  const handleConfirmDeleteSession = useCallback(() => {
    if (!pendingDeleteSessionId) {
      setOverlay('sessions')
      return
    }

    const isCurrent = pendingDeleteSessionId === session.id
    deleteSession(pendingDeleteSessionId)
    setPendingDeleteSessionId(null)

    if (isCurrent) {
      replaceWithNewSession()
      setOverlay('none')
      return
    }

    setOverlay('sessions')
  }, [pendingDeleteSessionId, session.id, replaceWithNewSession])

  const handleDeleteAllSessions = useCallback(() => {
    deleteAllSessions()
    replaceWithNewSession()
    setOverlay('none')
  }, [replaceWithNewSession])

  const handleResumeSession = useCallback((sessionId: string) => {
    if (sessionId === session.id) {
      setOverlay('none')
      return
    }
    const existing = getSession(sessionId)
    if (!existing) {
      setOverlay('none')
      return
    }

    // If archived, reactivate and show recall message with summary
    if (existing.status === 'archived') {
      const summary = getSummary(sessionId)
      reactivateSession(sessionId)
      const reactivated = getSession(sessionId)
      if (reactivated) setSession(reactivated)

      if (summary) {
        const recallMessage: ChatMessage = {
          role: 'recall',
          content: summary.summary,
        }
        updateMessages([recallMessage])
        messageCountRef.current = 0
      } else {
        updateMessages([])
        messageCountRef.current = 0
      }
    } else {
      setSession(existing)
      const existingMessages = getSessionMessages(sessionId)
      updateMessages(existingMessages)
      messageCountRef.current = existingMessages.length
    }

    setScrollOffset(0)
    setOverlay('none')
  }, [session.id])

  const handleCommandSelect = useCallback((commandId: string) => {
    switch (commandId) {
      case 'sessions':
        setOverlay('sessions')
        break
      case 'clear':
        updateMessages([])
        setScrollOffset(0)
        setOverlay('none')
        break
      case 'theme':
        setOverlay('color-picker')
        break
      case 'clean-caches': {
        const deleted = cleanCaches()
        const confirmMsg = `Cleared ${deleted} cached entries.`
        updateMessages((m) => [...m, { role: 'assistant', content: confirmMsg } as ChatMessage])
        setOverlay('none')
        break
      }
      case 'tools': {
        const registry = getRegistry()
        const toolList = registry.listTools()
        const formatted = toolList.map(t => `  ${t.name.padEnd(28)} ${t.description.split('.')[0]}`).join('\n')
        const msg = `Available tools:\n${formatted}`
        updateMessages((m) => [...m, { role: 'assistant', content: msg } as ChatMessage])
        setOverlay('none')
        break
      }
      case 'keybindings':
        setOverlay('keybindings')
        break
      case 'exit':
        handleExit()
        break
      default:
        setOverlay('none')
    }
  }, [handleNewSession, handleExit])

  useInput((char, key) => {
    // Overlays handle their own input - only intercept ctrl+p and ctrl+c here
    if (overlay !== 'none') {
      // Let overlay components handle all input via their own useInput
      return
    }

    // ── File menu (@file) handling ──────────────────────────────────────
    if (fileMenuActive) {
      if (key.upArrow) {
        setFileSelectedIndex((i) => Math.max(0, i - 1))
        return
      }
      if (key.downArrow) {
        setFileSelectedIndex((i) => Math.min(fileMatches.length - 1, i + 1))
        return
      }
      if (key.escape) {
        setFileMatches([])
        return
      }
      if (key.return) {
        const selected = fileMatches[fileSelectedIndex]
        if (selected) {
          const activeRef = getActiveFileReference(input, cursorPos)
          if (activeRef) {
            const before = input.slice(0, activeRef.atIndex)
            const after = input.slice(activeRef.atIndex + 1 + activeRef.pattern.length)
            const spacer = after.length === 0 || /^\s/.test(after) ? '' : ' '
            const inserted = `@${selected.relativePath}`
            const replaced = before + inserted + spacer + after
            setInput(replaced)
            setCursorPos((before + inserted + spacer).length)
          }
        }
        setFileMatches([])
        return
      }
      // Any other key (except specials handled above) — let input update below
    }

    if (key.ctrl && char === 'c') {
      handleExit()
      return
    }

    if (key.ctrl && char === 'p') {
      if (!isLoading) {
        setOverlay('command-palette')
      }
      return
    }

    if (key.ctrl && char === 'h') {
      if (!isLoading) {
        setOverlay('keybindings')
      }
      return
    }

    // Clear key sequences on any unrelated keypress
    if (newsKeySequence === 'awaiting-down') {
      if (key.downArrow) {
        setNewsKeySequence('idle')
        if (!isLoading) {
          if (digestArticles.length > 0) {
            setOverlay('news-list')
          } else if (digestMatches.length > 0) {
            setOverlay('match-list')
          }
        }
        return
      }
      if (!(key.ctrl && char === 'x')) {
        setNewsKeySequence('idle')
      }
    }
    if (matchKeySequence === 'awaiting-down') {
      if (key.downArrow) {
        setMatchKeySequence('idle')
        if (!isLoading) {
          if (digestMatches.length > 0) {
            setOverlay('match-list')
          } else if (digestArticles.length > 0) {
            setOverlay('news-list')
          }
        }
        return
      }
      if (!(key.ctrl && char === 'x')) {
        setMatchKeySequence('idle')
      }
    }

    if (!isLoading && (digestArticles.length > 0 || digestMatches.length > 0) && key.ctrl && char === 'x') {
      const hasNews = digestArticles.length > 0
      const hasMatches = digestMatches.length > 0
      if (hasNews && hasMatches) {
        setMatchKeySequence('awaiting-down')
        setNewsKeySequence('idle')
      } else if (hasNews) {
        setNewsKeySequence('awaiting-down')
        setMatchKeySequence('idle')
      } else {
        setMatchKeySequence('awaiting-down')
        setNewsKeySequence('idle')
      }
      return
    }

    if (isLoading) return

    // ── Slash menu handling ─────────────────────────────────────────────────
    if (slashActive) {
      if (key.escape) {
        setInput('')
        setCursorPos(0)
        return
      }

      if (key.upArrow) {
        setSlashSelectedIndex((i) => Math.max(0, i - 1))
        return
      }

      if (key.downArrow) {
        setSlashSelectedIndex((i) => Math.min(filteredSlashCommands.length - 1, i + 1))
        return
      }

      if (key.return && filteredSlashCommands.length > 0) {
        const selected = filteredSlashCommands[slashSelectedIndex]
        if (selected.argHint === null) {
          executeSlashCommand(selected.alias)
          return
        }
        const newInput = '/' + selected.alias + ' '
        setInput(newInput)
        setCursorPos(newInput.length)
        return
      }
    }

    if (key.return) {
      if (!input.trim()) return
      if (input.trim().toLowerCase() === 'exit' || input.trim().toLowerCase() === '/exit') {
        handleExit()
        return
      }
      if (input.trim().toLowerCase() === '/tools') {
        const registry = getRegistry()
        const toolList = registry.listTools()
        const formatted = toolList.map(t => `  ${t.name.padEnd(28)} ${t.description.split('.')[0]}`).join('\n')
        const msg = `Available tools:\n${formatted}`
        saveMessage(session.id, 'user', '/tools')
        updateMessages((m) => [...m, { role: 'user', content: '/tools' }, { role: 'assistant', content: msg } as ChatMessage])
        messageCountRef.current++
        return
      }

      if (input.trim().toLowerCase() === '/help' || input.trim().toLowerCase() === '/keybindings') {
        setOverlay('keybindings')
        saveMessage(session.id, 'user', input.trim())
        messageCountRef.current++
        return
      }

      const txt = input

      // Save user message to DB
      saveMessage(session.id, 'user', txt)
      messageCountRef.current++

      // Auto-title session from first user message
      if (messageCountRef.current === 1) {
        const title = txt.length > 60 ? txt.slice(0, 57) + '...' : txt
        updateSessionTitle(session.id, title)
      }

      // Capture current messages BEFORE updating state, so history is always correct
      // even if React batches the setMessages updater.
      const currentMessages = messagesRef.current

      updateMessages((m) => [
        ...m,
        { role: 'user', content: txt },
        { role: 'assistant', content: '' },
      ])

      setInput('')
      setCursorPos(0)
      setScrollOffset(0)
      setDigestArticles([])
      setDigestMatches([])
      startLoading()
      buffer.current = ''

      const sendToLLM = async (): Promise<void> => {
        const documentParts = await resolveDocumentParts(txt)
        const resolvedTxt = documentParts.length > 0
          ? stripDocumentRefs(txt) || 'Resume el contenido de los archivos adjuntos.'
          : txt

        // Build conversation history from all previous turns.
        // Use currentMessages (captured before state update) to avoid React batching issues.
        if (process.env['NULL_DEBUG']) {
          console.error(`[null-debug] currentMessages length: ${currentMessages.length}`)
        }
        const history: { role: string; content: string }[] = currentMessages
          .filter((m) => {
            if (m.role === 'assistant' && !m.content.trim()) return false
            if (m.role === 'recall' && !m.content.trim()) return false
            return true
          })
          .map((m) => {
            if (m.role === 'recall') {
              return {
                role: 'system',
                content: `[Recall — summary of a previous conversation in this session]\n${m.content}\n\nUse this context if relevant to what the user asks next.`,
              }
            }
            return { role: m.role, content: m.content }
          })
        if (process.env['NULL_DEBUG']) {
          console.error(`[null-debug] history length after filter: ${history.length}`)
          history.forEach((m, i) => console.error(`  [${i}] ${m.role}: ${String(m.content).slice(0, 60)}`))
        }

        if (documentParts.length > 0) {
          const docContext = buildDocumentContextMessage(documentParts)
          const docInstruction = buildDocumentResponseInstruction(resolvedTxt)
          const fileScopedHistory = buildFileScopedHistory(history)
          const docMessages = [
            ...fileScopedHistory,
            { role: 'system', content: docContext },
            {
              role: 'user',
              content: `${resolvedTxt}\n\n${docInstruction}`,
            },
          ]

          setStatusText('')
          await streamChat('', (tok) => {
            buffer.current += tok
            updateMessages((m) => {
              const copy = [...m]
              const last = copy[copy.length - 1]
              if (last?.role === 'assistant') {
                last.content = buffer.current
              }
              return copy
            })
          }, docMessages, undefined, { temperature: 0.3 })
          return
        }

        const isExplicitSearch = /^\/search\s+/i.test(resolvedTxt)

        const agentResult = await processQuery(resolvedTxt, isExplicitSearch, () => {
          setStatusText('Thinking...')
        })

        setStatusText('')

        setDigestArticles(
          agentResult.digestArticles && agentResult.digestArticles.length > 0
            ? agentResult.digestArticles
            : [],
        )
        setDigestMatches(
          agentResult.digestMatches && agentResult.digestMatches.length > 0
            ? agentResult.digestMatches
            : [],
        )

        // Direct response — no LLM needed (e.g. preference saved confirmation)
        if (agentResult.directResponse) {
          updateMessages((m) => {
            const copy = [...m]
            const last = copy[copy.length - 1]
            if (last?.role === 'assistant') last.content = agentResult.directResponse!
            return copy
          })
          buffer.current = agentResult.directResponse
          return
        }

        // If router returned 'none', run the ReAct loop so the LLM can
        // self-direct tool usage if needed, rather than a blind streamChat.
        if (agentResult.useReAct && !isExplicitSearch) {
          const reactResult = await processQueryWithReAct(
            agentResult.userContent,
            history,
            () => {
              setStatusText('Thinking...')
            },
            () => {
              setStatusText('Thinking...')
            },
          )

          setStatusText('')

          // Display the ReAct final answer directly (no streaming)
          updateMessages((m) => {
            const copy = [...m]
            const last = copy[copy.length - 1]
            if (last?.role === 'assistant') last.content = reactResult.answer
            return copy
          })
          buffer.current = reactResult.answer
          return
        }

        // Inject search context as a system message before the user message
        if (agentResult.searchContext) {
          history.push({ role: 'system', content: agentResult.searchContext })
        }
        history.push({ role: 'user', content: agentResult.userContent })

        setStatusText('')

        // Use lower temperature when grounding response in external data (webSearch)
        // to reduce hallucinations. Free conversation keeps default (0.8).
        const chatOptions = agentResult.searchContext ? { temperature: 0.3 } : undefined

        await streamChat('', (tok) => {
          buffer.current += tok
          updateMessages((m) => {
            const copy = [...m]
            const last = copy[copy.length - 1]
            if (last?.role === 'assistant') {
              last.content = buffer.current
            }
            return copy
          })
        }, history, undefined, chatOptions)
      }

      sendToLLM().then(() => {
        if (buffer.current) {
          saveMessage(session.id, 'assistant', buffer.current)
          messageCountRef.current++
        }
        stopLoading()
        buffer.current = ''
      }).catch(() => {
        const errorMsg = 'Error: Could not connect to Ollama. Is it running on localhost:11434?'
        buffer.current = ''
        updateMessages((m) => {
          const copy = [...m]
          const last = copy[copy.length - 1]
          if (last?.role === 'assistant') {
            last.content = errorMsg
          }
          return copy
        })
        saveMessage(session.id, 'assistant', errorMsg)
        messageCountRef.current++
        stopLoading()
      })

      return
    }

    if (key.leftArrow) {
      setCursorPos((p) => Math.max(0, p - 1))
      return
    }
    if (key.rightArrow) {
      setCursorPos((p) => Math.min(input.length, p + 1))
      return
    }
    if (key.upArrow) {
      handleUp()
      return
    }
    if (key.downArrow) {
      handleDown()
      return
    }
    if (key.backspace) {
      if (cursorPos === 0) return
      setInput((s) => s.slice(0, cursorPos - 1) + s.slice(cursorPos))
      setCursorPos((p) => p - 1)
      return
    }

    // Ctrl+W: delete previous word (Unix standard)
    if (key.ctrl && char === 'w') {
      if (cursorPos === 0) return
      const { text, pos } = deleteWordBefore(input, cursorPos)
      setInput(text)
      setCursorPos(pos)
      return
    }
    if (char) {
      setInput((s) => s.slice(0, cursorPos) + char + s.slice(cursorPos))
      setCursorPos((p) => p + 1)
    }
  })

  // Floating modal overlays: any non-'none' overlay renders ON TOP of the chat
  // (position="absolute") so the user keeps visual context of their conversation.
  const isModalOpen: boolean =
    overlay === 'command-palette' ||
    overlay === 'sessions' ||
    overlay === 'confirm-delete-session' ||
    overlay === 'confirm-delete-all' ||
    overlay === 'color-picker' ||
    overlay === 'news-list' ||
    overlay === 'match-list' ||
    overlay === 'keybindings' ||
    (overlay === 'article-reader' && readingArticle !== null) ||
    (overlay === 'match-detail' && selectedMatch !== null)

  return (
    <Box flexDirection="row" height={terminalHeight}>
      {/* Main content column */}
      <Box flexDirection="column" width={mainContentWidth}>
        <MessageList
          messages={messages}
          visibleStart={scrollOffset}
          visibleCount={contentHeight}
          terminalWidth={mainContentWidth}
          dimmed={isModalOpen}
        />

        <SlashMenu
          commands={filteredSlashCommands}
          selectedIndex={slashSelectedIndex}
          visible={slashActive && filteredSlashCommands.length > 0}
          width={mainContentWidth}
        />

        <FileMenu
          files={fileMatches}
          selectedIndex={fileSelectedIndex}
          visible={fileMenuActive}
          width={mainContentWidth}
        />

        <Input
          value={input}
          cursorPos={cursorPos}
          cursorVisible={cursorVisible}
          isLoading={isLoading}
          width={mainContentWidth}
          dimmed={isModalOpen}
        />

        <Footer
          isLoading={isLoading}
          loadingPos={loadingPos}
          loadingDir={loadingDir}
          statusText={statusText}
          isAtBottom={isAtBottom}
          hasMoreLines={hasMoreLines}
          scrollOffset={scrollOffset}
          digestCount={digestArticles.length}
          matchCount={digestMatches.length}
          overlayOpen={overlay === 'news-list' || overlay === 'match-list'}
          dimmed={isModalOpen}
        />
      </Box>

      {/* Right sidebar */}
      <Sidebar isLoading={isLoading} terminalHeight={terminalHeight} sessionName={session.title ?? session.id} />

      {/* Floating modal overlay — covers everything including sidebar */}
      {isModalOpen && (
        <Box
          position="absolute"
          top={0}
          left={0}
          width={terminalWidth}
          height={terminalHeight}
          flexDirection="column"
        >
          <Box
            position="absolute"
            top={0}
            left={0}
            width={terminalWidth}
            height={terminalHeight}
            alignItems="center"
            justifyContent="center"
          >
            {overlay === 'command-palette' && (
              <CommandPalette
                commands={COMMANDS}
                onSelect={handleCommandSelect}
                onClose={() => setOverlay('none')}
              />
            )}
            {overlay === 'sessions' && (
              <SessionList
                currentSessionId={session.id}
                onSelect={handleResumeSession}
                onNewSession={handleNewSession}
                onDeleteSession={handleRequestDeleteSession}
                onDeleteAll={() => setOverlay('confirm-delete-all')}
                onClose={() => setOverlay('none')}
              />
            )}
            {overlay === 'confirm-delete-session' && (() => {
              const isCurrent = pendingDeleteSessionId === session.id
              return (
                <ConfirmDialog
                  title={isCurrent ? 'Delete current session?' : 'Delete session?'}
                  message={isCurrent ? 'This removes the current conversation and starts a new session.' : 'This removes the selected conversation from saved sessions.'}
                  confirmLabel={isCurrent ? 'delete current' : 'delete session'}
                  onConfirm={handleConfirmDeleteSession}
                  onCancel={() => {
                    setPendingDeleteSessionId(null)
                    setOverlay('sessions')
                  }}
                />
              )
            })()}
            {overlay === 'confirm-delete-all' && (
              <ConfirmDialog
                title="Delete all sessions?"
                message="This removes every saved conversation. Memories and preferences are kept."
                confirmLabel="delete all"
                onConfirm={handleDeleteAllSessions}
                onCancel={() => setOverlay('sessions')}
              />
            )}
            {overlay === 'color-picker' && (
              <ColorPicker
                onClose={() => setOverlay('none')}
              />
            )}
            {overlay === 'keybindings' && (
              <Keybindings
                onClose={() => setOverlay('none')}
              />
            )}
            {overlay === 'news-list' && digestArticles.length > 0 && (
              <NewsList
                articles={digestArticles}
                onOpenArticle={(article) => {
                  setReadingArticle(article)
                  setArticleReaderReturnOverlay('news-list')
                  setOverlay('article-reader')
                }}
                onClose={() => setOverlay('none')}
              />
            )}
            {overlay === 'article-reader' && readingArticle && (
              <ArticleReader
                article={readingArticle}
                onClose={() => {
                  setOverlay(articleReaderReturnOverlay ?? 'none')
                  setReadingArticle(null)
                  setArticleReaderReturnOverlay(null)
                }}
              />
            )}
            {overlay === 'match-list' && digestMatches.length > 0 && (
              <MatchList
                matches={digestMatches}
                onOpenMatch={(match) => {
                  setSelectedMatch(match)
                  setMatchDetailReturnOverlay('match-list')
                  setOverlay('match-detail')
                }}
                onClose={() => setOverlay('none')}
              />
            )}
            {overlay === 'match-detail' && selectedMatch && (
              <MatchDetail
                match={selectedMatch}
                onClose={() => {
                  setOverlay(matchDetailReturnOverlay ?? 'none')
                  setSelectedMatch(null)
                  setMatchDetailReturnOverlay(null)
                }}
              />
            )}
          </Box>
        </Box>
      )}
    </Box>
  )
}

export function runTUI(resumeSessionId?: string): void {
  const exitInfoRef: {
    current: {
      sessionId: string
      sessionDate: string
      hasMessages: boolean
      messageCount: number
      duration: string
      model: string
      cwd: string
    }
  } = {
    current: {
      sessionId: '',
      sessionDate: '',
      hasMessages: false,
      messageCount: 0,
      duration: '',
      model: '',
      cwd: process.cwd(),
    },
  }

  const InnerApp = () => {
    const { exit } = useApp()
    const sessionStartRef = useRef(Date.now())
    const [phase, setPhase] = useState<'setup' | 'splash' | 'chat'>(
      () => (isFirstRun() ? 'setup' : 'splash'),
    )

    const handleChatExit = useCallback((
      sessionId: string,
      sessionDate: string,
      hasMessages: boolean,
      messageCount: number = 0,
    ) => {
      const elapsed = Math.round((Date.now() - sessionStartRef.current) / 60000)
      const duration = elapsed < 60 ? `${elapsed}m` : `${Math.floor(elapsed / 60)}h ${elapsed % 60}m`
      exitInfoRef.current = {
        sessionId,
        sessionDate,
        hasMessages,
        messageCount,
        duration,
        model: loadConfig().model ?? '',
        cwd: process.cwd(),
      }
      closeDb()
      exit()
    }, [exit])

    const handleSplashDone = useCallback(() => {
      setPhase('chat')
      runCleanup().catch(() => {})
    }, [])

    const handleSetupDone = useCallback(() => {
      setPhase('splash')
    }, [])

    if (phase === 'setup') {
      return <FirstRunSetup onDone={handleSetupDone} />
    }

    if (phase === 'splash') {
      return <Splash onDone={handleSplashDone} />
    }

    return (
      <Chat
        resumeSessionId={resumeSessionId}
        onExit={handleChatExit}
      />
    )
  }

  const instance = render(
    <ThemeProvider>
      <InnerApp />
    </ThemeProvider>,
    { alternateScreen: true },
  )

  instance.waitUntilExit().then(() => {
    const info = exitInfoRef.current
    printGoodbye(info)
    // Ensure the process exits cleanly — Ink may leave handles (e.g. raw mode)
    // open after waitUntilExit resolves, keeping the event loop alive.
    process.exit(0)
  })
}
