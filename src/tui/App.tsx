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
import { printGoodbye } from './components/Goodbye.js'
import { CommandPalette } from './components/CommandPalette.js'
import type { CommandItem } from './components/CommandPalette.js'
import { SessionList } from './components/SessionList.js'
import { ColorPicker } from './components/ColorPicker.js'
import { ThemeProvider, useTheme } from './context/ThemeContext.js'
import {
  createSession,
  getSession,
  getSessionMessages,
  saveMessage,
  updateSessionTitle,
  getSummary,
  reactivateSession,
  closeDb,
} from '../memory/sessions.js'
import type { Session } from '../memory/sessions.js'
import { runCleanup } from '../memory/cleanup.js'
import { routeQuery } from '../core/router.js'
import { getCachedSearch, setCachedSearch } from '../memory/search-cache.js'
import type { SearchContext } from '../tools/web-search.js'
import { getScoreboard, detectLeague, detectDateRange, hasExplicitDateRange, formatScoreboardContext } from '../tools/espn.js'

const MODEL = 'qwen2.5-coder:7b'

const COMMANDS: CommandItem[] = [
  { id: 'sessions', label: 'Sessions', description: 'Browse and resume previous sessions', shortcut: '' },
  { id: 'new-session', label: 'New Session', description: 'Start a fresh conversation', shortcut: '' },
  { id: 'search', label: 'Search Web', description: 'Search the web and ask about the results', shortcut: '/search' },
  { id: 'theme', label: 'Theme', description: 'Change the accent color of the UI', shortcut: '' },
  { id: 'clear', label: 'Clear Messages', description: 'Clear the current chat display', shortcut: '' },
  { id: 'exit', label: 'Exit', description: 'Close null CLI', shortcut: 'ctrl+c' },
]

type Overlay = 'none' | 'command-palette' | 'sessions' | 'color-picker'

interface SearchPipelineResult {
  contextMessage: string
  originalTxt: string
}

interface FetchedArticle {
  title: string
  url: string
  content: string
}

/**
 * Debug log to stderr (doesn't interfere with TUI).
 */
function debugLog(msg: string): void {
  process.stderr.write(`[null-debug] ${msg}\n`)
}

/**
 * Fetch multiple pages in parallel, returning structured articles.
 */
async function fetchArticles(
  results: { title: string; url: string; snippet: string }[],
  maxArticles: number = 5,
): Promise<FetchedArticle[]> {
  const toFetch = results.slice(0, maxArticles)

  const settled = await Promise.allSettled(
    toFetch.map(async (r) => {
      const text = await tools.web_fetch(r.url)
      return {
        title: r.title,
        url: r.url,
        content: text && text.length > 100 ? text : r.snippet,
      }
    }),
  )

  const articles: FetchedArticle[] = []
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i]
    if (result.status === 'fulfilled') {
      articles.push(result.value)
      debugLog(`  ✓ Fetched: ${toFetch[i].title}`)
    } else {
      // Use snippet as fallback
      articles.push({
        title: toFetch[i].title,
        url: toFetch[i].url,
        content: toFetch[i].snippet,
      })
      debugLog(`  ✗ Failed, using snippet: ${toFetch[i].title}`)
    }
  }

  return articles
}

/**
 * Build a factual context message from fetched articles.
 * Structured as a numbered dictionary so the LLM can summarize each one.
 */
function buildArticleContext(
  articles: FetchedArticle[],
  query: string,
  wikiExtract?: string | null,
): string {
  const now = new Date()
  const systemLocale = Intl.DateTimeFormat().resolvedOptions()
  const todayStr = now.toLocaleDateString(systemLocale.locale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: systemLocale.timeZone,
  })

  const parts = [
    `Today is ${todayStr}.`,
    `The following are ${articles.length} current articles/sources about "${query}".`,
    `Read each one and use the information to answer the user's question.`,
    '',
  ]

  if (wikiExtract) {
    parts.push('--- Background ---')
    parts.push(wikiExtract)
    parts.push('')
  }

  for (let i = 0; i < articles.length; i++) {
    const a = articles[i]
    parts.push(`--- Article ${i + 1}: ${a.title} ---`)
    parts.push(`Source: ${a.url}`)
    // Truncate each article to ~3000 chars to fit context window
    parts.push(a.content.slice(0, 3000))
    parts.push('')
  }

  parts.push('INSTRUCTIONS: You have all the information needed to answer. Summarize each article with specific details (names, scores, dates, numbers). Include source URLs. DO NOT say you cannot access the internet. DO NOT tell the user to visit websites instead — give them the answer directly. Respond in the same language the user writes in.')

  return parts.join('\n')
}

/**
 * Full search pipeline: search DDG → fetch top 5 pages → build structured context.
 * Uses cache to avoid redundant calls.
 * Returns null if search fails or yields no results.
 */
async function performSearch(query: string, originalTxt: string): Promise<SearchPipelineResult | null> {
  try {
    debugLog(`Router triggered webSearch for: "${query}"`)

    // Check cache first
    const cached = getCachedSearch(query)
    let searchCtx: SearchContext

    if (cached) {
      debugLog('Using cached search results')
      searchCtx = cached
    } else {
      // Fetch from DuckDuckGo
      searchCtx = await tools.web_search(query)
      debugLog(`DDG returned ${searchCtx.results.length} results, extract: ${searchCtx.extract ? 'yes' : 'no'}`)

      if (searchCtx.results.length === 0 && !searchCtx.extract) {
        debugLog('No search results found')
        return null
      }

      // Cache the result (5 min TTL)
      setCachedSearch(query, searchCtx, 300)
    }

    // Fetch top 5 pages in parallel
    debugLog(`Fetching top ${Math.min(searchCtx.results.length, 5)} pages...`)
    const articles = await fetchArticles(searchCtx.results, 5)
    debugLog(`Got ${articles.length} articles`)

    const contextMessage = buildArticleContext(articles, query, searchCtx.extract)
    debugLog(`Context message length: ${contextMessage.length} chars`)

    return { contextMessage, originalTxt }
  } catch (err) {
    debugLog(`Search pipeline error: ${err}`)
  }
  return null
}

/**
 * Sports pipeline: detect league + date range → ESPN API → formatted context.
 * Returns null if no league detected (falls back to webSearch).
 */
async function performSportsQuery(query: string): Promise<string | null> {
  const leagueSlug = detectLeague(query)
  if (!leagueSlug) {
    debugLog('No league detected — falling back to webSearch')
    return null
  }

  // Only pass explicit range to getScoreboard if the user specified one.
  // Otherwise pass undefined so getScoreboard can auto-fallback to last weekend.
  const explicitRange = hasExplicitDateRange(query) ? detectDateRange(query) : undefined
  const rangeForLog = explicitRange ?? detectDateRange(query)
  debugLog(`Sports query: league=${leagueSlug}, range=${rangeForLog.from.toISOString().slice(0, 10)} to ${rangeForLog.to.toISOString().slice(0, 10)}, explicit=${explicitRange !== undefined}`)

  try {
    const scoreboard = await getScoreboard(leagueSlug, explicitRange)
    debugLog(`ESPN returned ${scoreboard.games.length} games`)
    return formatScoreboardContext(scoreboard, scoreboard.effectiveRange)
  } catch (err) {
    debugLog(`ESPN API error: ${err}`)
    return null
  }
}

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
      case 'new-session':
        handleNewSession()
        break
      case 'search':
        setOverlay('none')
        // Pre-fill input with /search prefix
        setInput('/search ')
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
        const history: { role: string; content: string }[] = messagesRef.current
          .filter((m) => {
            // Skip empty assistant messages (placeholders)
            if (m.role === 'assistant' && !m.content.trim()) return false
            // Skip empty recall messages
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

        let userContent = txt
        let searchContext: string | null = null

        // Route the query to determine what action to take
        const isExplicitSearch = /^\/search\s+/i.test(txt)
        const searchQuery = isExplicitSearch
          ? txt.replace(/^\/search\s+/i, '').trim()
          : txt

        if (isExplicitSearch) {
          // Explicit /search command — always search
          updateMessages((m) => {
            const copy = [...m]
            const last = copy[copy.length - 1]
            if (last?.role === 'assistant') last.content = '🔍 Searching the web...'
            return copy
          })

          const result = await performSearch(searchQuery, txt)
          if (result) {
            searchContext = result.contextMessage
            userContent = searchQuery
          }

          updateMessages((m) => {
            const copy = [...m]
            const last = copy[copy.length - 1]
            if (last?.role === 'assistant') last.content = ''
            return copy
          })
        } else {
          // Use the router to decide
          const routerResult = await routeQuery(txt)
          const { decision } = routerResult
          debugLog(`Router decision: ${decision} (source: ${routerResult.source}, confidence: ${routerResult.confidence})`)

          if (decision === 'getDateTime') {
            const t = tools.get_time()
            userContent = `Current time: ${t.time}, date: ${t.date}. User asked: "${txt}". Answer naturally.`

          } else if (decision === 'sportsQuery') {
            updateMessages((m) => {
              const copy = [...m]
              const last = copy[copy.length - 1]
              if (last?.role === 'assistant') last.content = '⚽ Consultando resultados deportivos...'
              return copy
            })

            const sportsCtx = await performSportsQuery(txt)
            if (sportsCtx) {
              searchContext = sportsCtx
              userContent = txt
            } else {
              // League not recognized — fall back to web search
              const result = await performSearch(txt, txt)
              if (result) {
                searchContext = result.contextMessage
                userContent = txt
              }
            }

            updateMessages((m) => {
              const copy = [...m]
              const last = copy[copy.length - 1]
              if (last?.role === 'assistant') last.content = ''
              return copy
            })

          } else if (decision === 'webSearch') {
            updateMessages((m) => {
              const copy = [...m]
              const last = copy[copy.length - 1]
              if (last?.role === 'assistant') last.content = '🔍 Searching the web...'
              return copy
            })

            const result = await performSearch(searchQuery, txt)
            if (result) {
              searchContext = result.contextMessage
              userContent = txt
            }

            updateMessages((m) => {
              const copy = [...m]
              const last = copy[copy.length - 1]
              if (last?.role === 'assistant') last.content = ''
              return copy
            })
          }
          // else: decision === 'none' → userContent stays as txt
        }

        // Inject search context as a system message before the user message
        if (searchContext) {
          history.push({ role: 'system', content: searchContext })
        }
        history.push({ role: 'user', content: userContent })

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
        onClose={() => setOverlay('none')}
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
    if (info.hasMessages) {
      printGoodbye(info)
    }
  })
}
