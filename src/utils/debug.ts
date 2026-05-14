/**
 * Debug logger — writes to stderr when NULL_DEBUG=1.
 * Use this across all modules so debug output never pollutes TUI stdout.
 */
export function debugLog(msg: string): void {
  if (process.env['NULL_DEBUG']) {
    process.stderr.write(`[null-debug] ${msg}\n`)
  }
}
