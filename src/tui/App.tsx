import React, { useState, useRef, useCallback, useEffect } from 'react'
import { render, Box, Text, useInput, useApp } from 'ink'
import { streamChat } from '../core/ollama.js'

import { useLoading } from './hooks/useLoading.js'
import { useCursor } from './hooks/useCursor.js'
import { Splash } from './components/Splash.js'
import { Header } from './components/Header.js'
import { MessageList, countRenderedLines } from './components/MessageList.js'
import type { ChatMessage } from './components/MessageList.js'
import { Input } from './components/Input.js'
import { Footer } from './components/Footer.js'
import { printGoodbye } from './components/Goodbye.js'
import { CommandPalette } from './components/CommandPalette.js'
import type { CommandItem } from './components/CommandPalette.js'
import { SessionList } from './components/SessionList.js'
import { ColorPicker } from './components/ColorPicker.js'
import { ThemeProvider } from './context/ThemeContext.js'
import {
  createSession,
  getSession,
  getSessionMessages,
  getSessionPromptMessages,
  saveMessage,
  saveMessageParts,
  updateSessionTitle,
  getSummary,
  reactivateSession,
  deleteSession,
  deleteAllSessions,
  closeDb,
} from '../memory/sessions.js'
import type { Session } from '../memory/sessions.js'
import { runCleanup } from '../memory/cleanup.js'
import { loadConfig, DEFAULT_MODEL } from '../config/index.js'
import { processQuery, processQueryWithReAct } from '../core/agent.js'
import { buildPromptMessages } from '../core/prompt-builder.js'
import { hasDocumentRefs, resolveDocumentParts } from '../core/document-context.js'
import { buildGeneralMemoryContext } from '../memory/memory-retrieval.js'

const MODEL = loadConfig().model ?? DEFAULT_MODEL

const COMMANDS: CommandItem[] = [
  { id: 'sessions', label: 'Sessions', description: 'Browse and resume previous sessions', shortcut: '' },
  { id: 'theme', label: 'Theme', description: 'Change the accent color of the UI', shortcut: '' },
  { id: 'clear', label: 'Clear Messages', description: 'Clear the current chat display', shortcut: '' },
  { id: 'exit', label: 'Exit', description: 'Close null CLI', shortcut: 'ctrl+c' },
]

type Overlay = 'none' | 'command-palette' | 'sessions' | 'color-picker' | 'confirm-delete-session' | 'confirm-delete-all'

interface ChatProps {
  resumeSessionId?: string
  onExit: (sessionId: string, sessionDate: string, hasMessages: boolean) => void
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
      height={rows}
      width={cols}
    >
      <Box
        flexDirection="column"
        width={width}
        borderStyle="round"
        borderColor="red"
        paddingX={1}
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

function Chat({ resumeSessionId, onExit }: ChatProps) {
  const { exit } = useApp()

  const terminalWidth = process.stdout?.columns || 80
  const terminalHeight = process.stdout?.rows || 24
  const headerHeight = 1
  const inputHeight = 3
  const footerHeight = 1
  const contentHeight = terminalHeight - headerHeight - inputHeight - footerHeight - 2

  const [input, setInput] = useState('')
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
  const messageCountRef = useRef(0)

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

  const { isLoading, loadingPos, startLoading, stopLoading } = useLoading()
  const { isVisible: cursorVisible } = useCursor(isLoading)

  const buffer = useRef('')

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
    onExit(session.id, session.created_at, hasMessages)
  }, [session.id, session.created_at, onExit])

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

    if (isLoading) return

    if (key.return) {
      if (!input.trim()) return
      if (input.trim().toLowerCase() === 'exit' || input.trim().toLowerCase() === '/exit') {
        handleExit()
        return
      }

      const txt = input

      // Save user message to DB
      const userMessageId = saveMessage(session.id, 'user', txt)
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
      setScrollOffset(0)
      startLoading()
      buffer.current = ''

      const sendToLLM = async (): Promise<void> => {
        const documentParts = hasDocumentRefs(txt)
          ? await resolveDocumentParts(txt)
          : []

        if (documentParts.length > 0) {
          saveMessageParts(session.id, userMessageId, documentParts)
        }

        // Build conversation history from structured DB parts when available.
        // Recall-only UI messages are still captured from currentMessages because
        // archived session summaries are shown without restoring old messages.
        if (process.env['NULL_DEBUG']) {
          console.error(`[null-debug] currentMessages length: ${currentMessages.length}`)
        }
        const dbHistory = getSessionPromptMessages(session.id, { beforeMessageId: userMessageId })
        const recallHistory: { role: 'system'; content: string }[] = currentMessages
          .filter((m) => {
            if (m.role === 'recall' && !m.content.trim()) return false
            return m.role === 'recall'
          })
          .map((m) => {
            return {
              role: 'system',
              content: `[Recall — summary of a previous conversation in this session]\n${m.content}\n\nUse this context if relevant to what the user asks next.`,
            }
          })
        const history: { role: 'system' | 'user' | 'assistant'; content: string }[] = [
          ...recallHistory,
          ...dbHistory,
        ]
        if (process.env['NULL_DEBUG']) {
          console.error(`[null-debug] history length after filter: ${history.length}`)
          history.forEach((m, i) => console.error(`  [${i}] ${m.role}: ${String(m.content).slice(0, 60)}`))
        }

        const isExplicitSearch = /^\/search\s+/i.test(txt)

        // processQuery calls onStatus as soon as it knows what tool to use,
        // allowing TUI to show the status message before async work completes.
        const agentResult = await processQuery(txt, isExplicitSearch, (statusMsg) => {
          updateMessages((m) => {
            const copy = [...m]
            const last = copy[copy.length - 1]
            if (last?.role === 'assistant') last.content = statusMsg
            return copy
          })
        }, session.id)

        // Clear status before streaming the real response
        updateMessages((m) => {
          const copy = [...m]
          const last = copy[copy.length - 1]
          if (last?.role === 'assistant') last.content = ''
          return copy
        })

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
            [
              ...history,
              ...documentParts.map((part) => ({ role: 'system', content: part.content })),
            ],
            (statusMsg) => {
              updateMessages((m) => {
                const copy = [...m]
                const last = copy[copy.length - 1]
                if (last?.role === 'assistant') last.content = statusMsg
                return copy
              })
            },
            (toolName) => {
              updateMessages((m) => {
                const copy = [...m]
                const last = copy[copy.length - 1]
                if (last?.role === 'assistant') last.content = `Using tool: ${toolName}...`
                return copy
              })
            },
          )

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

        const memoryContext = buildGeneralMemoryContext(agentResult.userContent)
        const promptMessages = buildPromptMessages({
          query: agentResult.userContent,
          history,
          memoryContext,
          documentParts,
          toolParts: agentResult.searchContext
            ? [{
              type: 'tool_observation',
              content: agentResult.searchContext,
              synthetic: true,
              metadata: { source: 'router' },
            }]
            : [],
        })

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
        }, promptMessages, undefined, chatOptions)
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

    if (key.upArrow) {
      handleUp()
      return
    }
    if (key.downArrow) {
      handleDown()
      return
    }
    if (key.backspace) {
      if (key.ctrl || key.meta) {
        // Ctrl+Backspace / Option+Backspace: delete previous word
        setInput((s) => {
          const trimmed = s.replace(/\s+$/, '')
          const lastSpace = trimmed.lastIndexOf(' ')
          return lastSpace === -1 ? '' : s.slice(0, lastSpace + 1)
        })
      } else {
        setInput((s) => s.slice(0, -1))
      }
      return
    }

    // Ctrl+W: delete previous word (Unix standard)
    if (key.ctrl && char === 'w') {
      setInput((s) => {
        const trimmed = s.replace(/\s+$/, '')
        const lastSpace = trimmed.lastIndexOf(' ')
        return lastSpace === -1 ? '' : s.slice(0, lastSpace + 1)
      })
      return
    }
    if (char) {
      setInput((s) => s + char)
    }
  })

  // Render overlay on top of chat
  if (overlay === 'command-palette') {
    return (
      <CommandPalette
        commands={COMMANDS}
        onSelect={handleCommandSelect}
        onClose={() => setOverlay('none')}
      />
    )
  }

  if (overlay === 'sessions') {
    return (
      <SessionList
        currentSessionId={session.id}
        onSelect={handleResumeSession}
        onNewSession={handleNewSession}
        onDeleteSession={handleRequestDeleteSession}
        onDeleteAll={() => setOverlay('confirm-delete-all')}
        onClose={() => setOverlay('none')}
      />
    )
  }

  if (overlay === 'confirm-delete-session') {
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
  }

  if (overlay === 'confirm-delete-all') {
    return (
      <ConfirmDialog
        title="Delete all sessions?"
        message="This removes every saved conversation. Memories and preferences are kept."
        confirmLabel="delete all"
        onConfirm={handleDeleteAllSessions}
        onCancel={() => setOverlay('sessions')}
      />
    )
  }

  if (overlay === 'color-picker') {
    return (
      <ColorPicker
        onClose={() => setOverlay('none')}
      />
    )
  }

  return (
    <Box flexDirection="column" height={terminalHeight}>
      <Header model={MODEL} sessionId={session.id} />

      <Box height={1} paddingX={1}>
        <Text color="gray">{'─'.repeat(Math.max(0, terminalWidth - 4))}</Text>
      </Box>

      <MessageList
        messages={messages}
        visibleStart={scrollOffset}
        visibleCount={contentHeight}
        terminalWidth={terminalWidth}
      />

      <Input
        value={input}
        cursorVisible={cursorVisible}
        isLoading={isLoading}
      />

      <Footer
        isLoading={isLoading}
        loadingPos={loadingPos}
        isAtBottom={isAtBottom}
        hasMoreLines={hasMoreLines}
        scrollOffset={scrollOffset}
      />
    </Box>
  )
}

export function runTUI(resumeSessionId?: string): void {
  const exitInfoRef = { current: { sessionId: '', sessionDate: '', hasMessages: false } }

  const InnerApp = () => {
    const { exit } = useApp()
    const [phase, setPhase] = useState<'splash' | 'chat'>('splash')

    const handleChatExit = useCallback((
      sessionId: string,
      sessionDate: string,
      hasMessages: boolean,
    ) => {
      exitInfoRef.current = { sessionId, sessionDate, hasMessages }
      closeDb()
      exit()
    }, [exit])

    const handleSplashDone = useCallback(() => {
      setPhase('chat')
      runCleanup().catch(() => {})
    }, [])

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
  })
}
