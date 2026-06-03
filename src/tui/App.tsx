import React, { useState, useRef, useCallback, useEffect } from 'react'
import { render, Box, Text, useInput, useApp } from 'ink'
import { streamChat } from '../core/ollama.js'
import { getCommentaryClient, getDefaultClient } from '../core/llm-client.js'
import { buildSportsCommentaryPrompt } from '../tools/espn.js'
import { buildPreferencesContext } from '../memory/preferences.js'
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
import { FirstRunSetup } from './components/FirstRunSetup.js'
import { ArticleReader, type DigestArticle } from './components/ArticleReader.js'
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
import { loadConfig, DEFAULT_MODEL, isFirstRun } from '../config/index.js'
import { processQuery, processQueryWithReAct } from '../core/agent.js'

const MODEL = loadConfig().model ?? DEFAULT_MODEL

const COMMANDS: CommandItem[] = [
  { id: 'sessions', label: 'Sessions', description: 'Browse and resume previous sessions', shortcut: '' },
  { id: 'theme', label: 'Theme', description: 'Change the accent color of the UI', shortcut: '' },
  { id: 'clear', label: 'Clear Messages', description: 'Clear the current chat display', shortcut: '' },
  { id: 'exit', label: 'Exit', description: 'Close null CLI', shortcut: 'ctrl+c' },
]

type Overlay = 'none' | 'command-palette' | 'sessions' | 'color-picker' | 'confirm-delete-session' | 'confirm-delete-all' | 'article-reader'

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
  const [digestArticles, setDigestArticles] = useState<Array<{ position: number; title: string; url: string; source: string; category: string }>>([])
  const [readingArticle, setReadingArticle] = useState<DigestArticle | null>(null)
  const messageCountRef = useRef(0)
  const welcomeDoneRef = useRef(false)

  // Welcome greeting: when Chat mounts fresh (not resumed), greet the user warmly
  useEffect(() => {
    if (resumeSessionId || welcomeDoneRef.current) return
    welcomeDoneRef.current = true

    const config = loadConfig()
    const name = config.userName

    const welcomePrompt = name
      ? `Saluda cálidamente a ${name} y pregúntale cómo puedes ayudarle hoy. Responde en español. Máximo 2 líneas. No uses emojis.`
      : `Saluda cálidamente al usuario y ofrécete a ayudar. Responde en español. Máximo 2 líneas. No uses emojis.`

    let buffer = ''
    startLoading()

    streamChat(
      '',
      (token) => {
        buffer += token
        updateMessages([{ role: 'assistant', content: buffer }])
      },
      [{ role: 'user', content: welcomePrompt }],
      'Eres Null, un asistente personal de IA amable y servicial. Respondes en español.',
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

    // Number keys 0-9 open the corresponding article from the last news digest
    if (!isLoading && /^[0-9]$/.test(char) && digestArticles.length > 0) {
      const idx = char === '0' ? 9 : parseInt(char, 10) - 1
      const article = digestArticles[idx]
      if (article) {
        setReadingArticle(article)
        setOverlay('article-reader')
        return
      }
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
      setScrollOffset(0)
      startLoading()
      buffer.current = ''

      const sendToLLM = async (): Promise<void> => {
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
        })

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
          if (agentResult.digestArticles && agentResult.digestArticles.length > 0) {
            setDigestArticles(agentResult.digestArticles)
          } else {
            setDigestArticles([])
          }
          return
        }

        // If router returned 'none', run the ReAct loop so the LLM can
        // self-direct tool usage if needed, rather than a blind streamChat.
        if (agentResult.useReAct && !isExplicitSearch) {
          const reactResult = await processQueryWithReAct(
            agentResult.userContent,
            history,
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

        // Sports query — show table immediately, then stream LLM commentary below
        if (agentResult.tableOutput) {
          // Step 1: render the table right away so the user sees data instantly
          updateMessages((m) => {
            const copy = [...m]
            const last = copy[copy.length - 1]
            if (last?.role === 'assistant') last.content = agentResult.tableOutput!
            return copy
          })

          // Step 2: build commentary prompt
          // For news intent, skip scoreboard commentary — use news context directly
          const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
          let commentMessages: { role: string; content: string }[]

          if (agentResult.newsIntent) {
            // News query: comment based on headlines, not the scoreboard
            const newsContext = agentResult.searchContext ?? ''
            commentMessages = [
              ...(newsContext ? [{ role: 'system', content: newsContext }] : []),
              {
                role: 'user',
                content: `${txt}\n\nResume las noticias más relevantes del equipo en 2-4 líneas. Usa SOLO los titulares de arriba. No inventes nada. Responde en español.`,
              },
            ]
          } else if (agentResult.scoreboard) {
            const prefsCtx = buildPreferencesContext() ?? undefined
            const { systemPrompt, userInstruction } = buildSportsCommentaryPrompt(
              agentResult.scoreboard,
              txt,
              tz,
              prefsCtx,
            )
            // Debug log
            process.stderr.write(`[null-debug] === SPORTS COMMENTARY PROMPT (structured) ===\n`)
            process.stderr.write(`[null-debug] System:\n${systemPrompt}\n`)
            process.stderr.write(`[null-debug] User instruction:\n${userInstruction}\n`)
            process.stderr.write(`[null-debug] === END PROMPT ===\n`)

            commentMessages = [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userInstruction },
            ]
          } else {
            // Fallback: no scoreboard, use raw context
            const sportSystemContent = agentResult.searchContext ?? ''
            commentMessages = [
              ...(sportSystemContent ? [{ role: 'system', content: sportSystemContent }] : []),
              {
                role: 'user',
                content: `${txt}\n\nEscribe 2-4 líneas de comentario deportivo basado SOLO en los datos anteriores. No inventes nada.`,
              },
            ]
          }

          const commentaryClient = getCommentaryClient()
          let commentary = ''
          await commentaryClient.streamChat(
            commentMessages.map((m) => ({
              role: m.role as 'system' | 'user' | 'assistant',
              content: m.content,
            })),
            (tok) => {
              commentary += tok
              updateMessages((m) => {
                const copy = [...m]
                const last = copy[copy.length - 1]
                if (last?.role === 'assistant') {
                  last.content = `${agentResult.tableOutput!}\n\n${commentary}`
                }
                return copy
              })
            },
            { temperature: 0.3 },
          )

          buffer.current = `${agentResult.tableOutput}\n\n${commentary}`
          return
        }

        // Inject search context as a system message before the user message
        if (agentResult.searchContext) {
          history.push({ role: 'system', content: agentResult.searchContext })
        }
        history.push({ role: 'user', content: agentResult.userContent })

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

  // Floating modal overlays: any non-'none' overlay renders ON TOP of the chat
  // (position="absolute") so the user keeps visual context of their conversation.
  const isModalOpen: boolean =
    overlay === 'command-palette' ||
    overlay === 'sessions' ||
    overlay === 'confirm-delete-session' ||
    overlay === 'confirm-delete-all' ||
    overlay === 'color-picker' ||
    (overlay === 'article-reader' && readingArticle !== null)

  return (
    <Box flexDirection="column" height={terminalHeight}>
      <Header model={MODEL} sessionId={session.id} dimmed={isModalOpen} />

      <Box height={1} paddingX={1}>
        <Text color="gray" dimColor={isModalOpen}>{'─'.repeat(Math.max(0, terminalWidth - 4))}</Text>
      </Box>

      <MessageList
        messages={messages}
        visibleStart={scrollOffset}
        visibleCount={contentHeight}
        terminalWidth={terminalWidth}
        dimmed={isModalOpen}
      />

      <Input
        value={input}
        cursorVisible={cursorVisible}
        isLoading={isLoading}
        dimmed={isModalOpen}
      />

      <Footer
        isLoading={isLoading}
        loadingPos={loadingPos}
        isAtBottom={isAtBottom}
        hasMoreLines={hasMoreLines}
        scrollOffset={scrollOffset}
        digestCount={digestArticles.length}
        dimmed={isModalOpen}
      />

      {/* Floating modal overlay — command palette and article reader */}
      {isModalOpen && (
        <Box
          position="absolute"
          top={0}
          left={0}
          width={terminalWidth}
          height={terminalHeight}
          flexDirection="column"
        >
          {/* Modal content centered on top — the chat behind is dimmed via the dimmed props above */}
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
            {overlay === 'article-reader' && readingArticle && (
              <ArticleReader
                article={readingArticle}
                onClose={() => {
                  setOverlay('none')
                  setReadingArticle(null)
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
  const exitInfoRef = { current: { sessionId: '', sessionDate: '', hasMessages: false } }

  const InnerApp = () => {
    const { exit } = useApp()
    const [phase, setPhase] = useState<'setup' | 'splash' | 'chat'>(
      () => (isFirstRun() ? 'setup' : 'splash'),
    )

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
