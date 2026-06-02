import { Command } from 'commander'
import { runTUI } from '../tui/App.js'
import { streamChat } from '../core/ollama.js'
import { renderMarkdown } from '../utils/markdown.js'
import { loadConfig, setAccentColor, setModel, type AccentColor } from '../config/index.js'
import { checkHealth } from '../core/health.js'
import { runSetup } from './setup.js'

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

  const configCmd = program
    .command('config')
    .description('Manage configuration')

  configCmd
    .command('show')
    .description('Show current configuration')
    .action(() => {
      const config = loadConfig()
      console.log(JSON.stringify(config, null, 2))
    })

  configCmd
    .command('set')
    .description('Set a configuration value')
    .argument('<key>', 'config key (accent-color, model)')
    .argument('<value>', 'value')
    .action((key: string, value: string) => {
      if (key === 'accent-color') {
        setAccentColor(value as AccentColor)
        console.log(`Accent color set to: ${value}`)
      } else if (key === 'model') {
        setModel(value)
        console.log(`Model set to: ${value}`)
      } else {
        console.error(`Unknown key: ${key}. Valid keys: accent-color, model`)
        process.exit(1)
      }
    })

  // Health check command
  program
    .command('health')
    .description('Check status of Ollama and internet connectivity')
    .action(async () => {
      process.stdout.write('Checking services...\n')
      const status = await checkHealth(3000)

      const ollamaIcon = status.ollama.available ? '✓' : '✗'
      const internetIcon = status.internet.available ? '✓' : '✗'

      console.log(`\nOllama        ${ollamaIcon} ${status.ollama.available ? `online (${status.ollama.latencyMs}ms)` : 'offline — run: ollama serve'}`)
      if (status.ollama.available && status.ollama.models.length > 0) {
        console.log(`  Models: ${status.ollama.models.join(', ')}`)
      }
      console.log(`Internet      ${internetIcon} ${status.internet.available ? 'connected' : 'no connection — web search unavailable'}`)
    })

  // Setup wizard
  program
    .command('setup')
    .description('Interactive setup wizard')
    .action(async () => {
      await runSetup()
    })

  program
    .argument('[prompt...]', 'prompt to execute directly')
    .option('--dev', 'enable debug mode')
    .option('-s, --session <id>', 'resume a previous session')
    .action(async (promptParts: string[], options: CLIOptions) => {
      // Fast startup check — fail early if Ollama is not running
      const health = await checkHealth(2000)
      if (!health.ollama.available) {
        console.error('\x1B[31mError:\x1B[0m Ollama is not running.')
        console.error('Start it with: \x1B[36mollama serve\x1B[0m')
        console.error('Or check status with: \x1B[36mnull health\x1B[0m')
        process.exit(1)
      }

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
