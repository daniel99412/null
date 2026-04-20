import { Command } from 'commander'
import { runTUI } from '../tui/App.js'
import { streamChat } from '../core/ollama.js'
import { renderMarkdown } from '../utils/markdown.js'

function clearScreen(): void {
  process.stdout.write('\x1B[2J\x1B[3J\x1B[H')
}

interface CLIOptions {
  dev?: boolean
  session?: string
}

export function runCLI(): void {
  clearScreen()

  const program = new Command()

  program
    .name('null')
    .description('Your AI-powered virtual secretary that runs in the terminal.')
    .version('0.1.0')

  program
    .argument('[prompt...]', 'prompt to execute directly')
    .option('--dev', 'enable debug mode')
    .option('-s, --session <id>', 'resume a previous session')
    .action((promptParts: string[], options: CLIOptions) => {
      if (!promptParts || promptParts.length === 0) {
        runTUI(options.session)
        return
      }

      const prompt = promptParts.join(' ')

      process.stdout.write('\x1B[36mnull\x1B[0m > ')

      let buffer = ''
      streamChat(prompt, (token) => {
        buffer += token
        process.stdout.write(token)
      }).then(() => {
        // Clear raw output and replace with styled markdown
        const lines = buffer.split('\n').length + 1
        process.stdout.write(`\x1B[${lines}A\x1B[J`)
        console.log(renderMarkdown(buffer))
      }).catch((err: Error) => {
        console.error(
          '\n\x1B[31mError:\x1B[0m Could not connect to Ollama. Is it running on localhost:11434?',
        )
        if (options.dev) {
          console.error(err.message)
        }
      })
    })

  program.parse()
}
