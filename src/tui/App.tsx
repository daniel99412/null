import React, { useState, useRef, useCallback, useEffect } from 'react'
import { render, Box, Text, useInput, useApp } from 'ink'
import { streamChat } from '../core/ollama.js'
import { tools } from '../core/tools.js'
import { useLoading } from './hooks/useLoading.js'
import { useCursor } from './hooks/useCursor.js'
import { Splash } from './components/Splash.js'
import { Header } from './components/Header.js'
import { MessageList, countRenderedLines } from './components/MessageList.js'
import type { ChatMessage } from './components/MessageList.js'
import { Input } from './components/Input.js'
import { Footer } from './components/Footer.js'
import { Goodbye } from './components/Goodbye.js'
import { CommandPalette } from './components/CommandPalette.js'
import type { CommandItem } from './components/CommandPalette.js'
import { SessionList } from './components/SessionList.js'
import {
  createSession,
  getSession,
  getSessionMessages,
  saveMessage,
  updateSessionTitle,
  closeDb,
} from '../memory/sessions.js'
import type { Session } from '../memory/sessions.js'
import type { SearchContext } from '../tools/web-search.js'

const MODEL = 'qwen2.5-coder:7b'

const COMMANDS: CommandItem[] = [
  { id: 'sessions', label: 'Sessions', description: 'Browse and resume previous sessions', shortcut: '' },
  { id: 'new-session', label: 'New Session', description: 'Start a fresh conversation', shortcut: '' },
  { id: 'search', label: 'Search Web', description: 'Search the web and ask about the results', shortcut: '/search' },
  { id: 'clear', label: 'Clear Messages', description: 'Clear the current chat display', shortcut: '' },
  { id: 'exit', label: 'Exit', description: 'Close null CLI', shortcut: 'ctrl+c' },
]

type Overlay = 'none' | 'command-palette' | 'sessions'

interface ChatProps {
  resumeSessionId?: string
  onExit: (sessionId: string, sessionDate: string, hasMessages: boolean) => void
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
  const [session, setSession] = useState<Session>(() => {
    if (resumeSessionId) {
      const existing = getSession(resumeSessionId)
      if (existing) return existing
    }
    return createSession()
  })
  const [scrollOffset, setScrollOffset] = useState(0)
  const [overlay, setOverlay] = useState<Overlay>('none')
  const messageCountRef = useRef(0)

  // Load existing messages when resuming a session
  useEffect(() => {
    if (resumeSessionId) {
      const existing = getSessionMessages(resumeSessionId)
      if (existing.length > 0) {
        setMessages(existing)
        messageCountRef.current = existing.length
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
    setMessages([])
    setScrollOffset(0)
    messageCountRef.current = 0
    setOverlay('none')
  }, [])

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
    setSession(existing)
    const existingMessages = getSessionMessages(sessionId)
    setMessages(existingMessages)
    messageCountRef.current = existingMessages.length
    setScrollOffset(0)
    setOverlay('none')
  }, [session.id])

  const searchPendingRef = useRef(false)

  const handleCommandSelect = useCallback((commandId: string) => {
    switch (commandId) {
      case 'sessions':
        setOverlay('sessions')
        break
      case 'new-session':
        handleNewSession()
        break
      case 'search':
        setOverlay('none')
        // Pre-fill input with /search prefix
        setInput('/search ')
        break
      case 'clear':
        setMessages([])
        setScrollOffset(0)
        setOverlay('none')
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
      if (input.trim().toLowerCase() === 'exit') {
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

      setMessages((m) => [
        ...m,
        { role: 'user', content: txt },
        { role: 'assistant', content: '' },
      ])

      setInput('')
      setScrollOffset(0)
      startLoading()
      buffer.current = ''

      // Determine if this is a web search request
      const isExplicitSearch = /^\/search\s+/i.test(txt)
      const isSearchIntent = /\b(search|busca|buscar|look\s*up|google|wiki|find\s+(me|out|info)|what\s+is|what\s+are|who\s+is|who\s+are|when\s+(is|was|did)|where\s+(is|are)|how\s+(much|many|does|do|did|is)|tell\s+me\s+about|know\s+(about|something)|heard\s+(about|of)|anything\s+about|what\s+happened|latest\s+news|latest|recent|current|news\s+about|on\s+the\s+web|from\s+the\s+internet|online)\b/i.test(txt)
      const needsSearch = isExplicitSearch || isSearchIntent

      const searchQuery = isExplicitSearch
        ? txt.replace(/^\/search\s+/i, '').trim()
        : txt

      // Build the send function (may be async due to web search)
      const sendToLLM = async (): Promise<void> => {
        // Build full conversation history
        const history: { role: string; content: string }[] = messages.map((m) => ({
          role: m.role,
          content: m.content,
        }))

        let userContent = txt

        // Web search: fetch context and inject into the prompt
        if (needsSearch) {
          try {
            const searchCtx: SearchContext = await tools.web_search(searchQuery)

            if (searchCtx.extract || searchCtx.results.length > 0) {
              const resultsText = searchCtx.results
                .map((r, i) => `${i + 1}. ${r.title}: ${r.snippet}`)
                .join('\n')

              userContent = [
                `[Web Search Results for "${searchQuery}"]`,
                '',
                searchCtx.extract ? `Summary: ${searchCtx.extract}` : '',
                '',
                resultsText ? `Other results:\n${resultsText}` : '',
                '',
                `User's original question: "${txt}"`,
                '',
                'Based on the search results above, provide a helpful and accurate answer. Cite sources when relevant.',
              ].filter(Boolean).join('\n')
            }
          } catch {
            // Search failed, fall through to normal prompt
          }
        }

        // Time/date tool injection (only if not a search)
        if (!needsSearch) {
          const asksTime = /\bhora\b|\bque\s*hora\b|\bdime\s*la\s*hora\b|\btime\b|\bwhat\s*time\b/i.test(txt)
          const asksDate = /\bfecha\b|\bdia\b|\bque\s*dia\b|\bdate\b|\bwhat\s*day\b/i.test(txt)

          if (asksTime && asksDate) {
            const t = tools.get_time()
            userContent = `Current time: ${t.time}, date: ${t.date}. The user asked: "${txt}". Answer naturally.`
          } else if (asksDate) {
            const t = tools.get_time()
            userContent = `Current date: ${t.date}. The user asked: "${txt}". Answer naturally.`
          } else if (asksTime) {
            const t = tools.get_time()
            userContent = `Current time: ${t.time}. The user asked: "${txt}". Answer naturally.`
          }
        }

        history.push({ role: 'user', content: userContent })

        await streamChat('', (tok) => {
          buffer.current += tok
          setMessages((m) => {
            const copy = [...m]
            const last = copy[copy.length - 1]
            if (last?.role === 'assistant') {
              last.content = buffer.current
            }
            return copy
          })
        }, history)
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
        setMessages((m) => {
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
      setInput((s) => s.slice(0, -1))
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

interface AppProps {
  resumeSessionId?: string
}

export function App({ resumeSessionId }: AppProps) {
  const { exit } = useApp()
  const [phase, setPhase] = useState<'splash' | 'chat' | 'goodbye'>('splash')
  const [exitInfo, setExitInfo] = useState({
    sessionId: '',
    sessionDate: '',
    hasMessages: false,
  })

  const handleChatExit = useCallback((
    sessionId: string,
    sessionDate: string,
    hasMessages: boolean,
  ) => {
    if (!hasMessages) {
      closeDb()
      exit()
      return
    }
    setExitInfo({ sessionId, sessionDate, hasMessages })
    setPhase('goodbye')
  }, [exit])

  // Auto-exit after showing goodbye screen
  useEffect(() => {
    if (phase !== 'goodbye') return
    const timer = setTimeout(() => {
      closeDb()
      exit()
    }, 3000)
    return () => clearTimeout(timer)
  }, [phase, exit])

  if (phase === 'splash') {
    return <Splash onDone={() => setPhase('chat')} />
  }

  if (phase === 'goodbye') {
    return (
      <Goodbye
        sessionId={exitInfo.sessionId}
        sessionDate={exitInfo.sessionDate}
        hasMessages={exitInfo.hasMessages}
      />
    )
  }

  return (
    <Chat
      resumeSessionId={resumeSessionId}
      onExit={handleChatExit}
    />
  )
}

export function runTUI(resumeSessionId?: string): void {
  render(<App resumeSessionId={resumeSessionId} />, { alternateScreen: true })
}
