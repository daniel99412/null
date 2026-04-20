import { marked } from 'marked'
import { markedTerminal } from 'marked-terminal'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
marked.use(markedTerminal() as any)

/**
 * Render a markdown string to styled terminal output.
 * Returns the formatted string with ANSI escape codes.
 */
export function renderMarkdown(text: string): string {
  const rendered = marked.parse(text) as string
  // Remove trailing newlines that marked adds
  return rendered.replace(/\n+$/, '')
}
