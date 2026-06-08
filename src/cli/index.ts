import { Command } from 'commander'
import { runTUI } from '../tui/App.js'
import { processQuery } from '../core/agent.js'
import { checkHealth } from '../core/health.js'
import { runSetup } from './setup.js'
import { initMCPServers } from '../mcp/init.js'
import { loadConfig, setAccentColor, setModel } from '../config/index.js'
import type { AccentColor } from '../config/index.js'
import { cleanCaches } from '../memory/database.js'
import { getDefaultClient } from '../core/llm-client.js'
import {
  buildDocumentContextMessage,
  buildDocumentResponseInstruction,
  resolveDocumentParts,
  stripDocumentRefs,
} from '../core/document-context.js'
import fs from 'fs'
import path from 'path'
import os from 'os'

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
    .argument('<key>', 'config key (accent-color, weather-key, model)')
    .argument('<value>', 'value')
    .action((key: string, value: string) => {
      if (key === 'accent-color') {
        setAccentColor(value as AccentColor)
        console.log(`Accent color set to: ${value}`)
      } else if (key === 'weather-key') {
        const config = loadConfig()
        config.openWeatherApiKey = value
        const configDir = path.join(os.homedir(), '.null-cli')
        const configPath = path.join(configDir, 'config.json')
        if (!fs.existsSync(configDir)) {
          fs.mkdirSync(configDir, { recursive: true })
        }
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8')
        console.log('OpenWeather API key saved')
      } else if (key === 'model') {
        setModel(value)
        console.log(`Model set to: ${value}`)
      } else {
        console.error(`Unknown key: ${key}. Valid keys: accent-color, weather-key, model`)
        process.exit(1)
      }
    })

  // Clean caches command
  program
    .command('clean')
    .description('Clear all cached data (search, ESPN, news)')
    .action(() => {
      const deleted = cleanCaches()
      console.log(`Cleared ${deleted} cached entries.`)
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

      if (!health.internet.available) {
        process.stderr.write('\x1B[33mWarning:\x1B[0m No internet connection — web search will be unavailable.\n')
      }

      // Initialize MCP servers (internal + external from config)
      await initMCPServers()

      if (!promptParts || promptParts.length === 0) {
        runTUI(options.session)
        return
      }

      const prompt = promptParts.join(' ')

      process.stdout.write('\x1B[36mnull\x1B[0m > ')

      try {
        const documentParts = await resolveDocumentParts(prompt)
        if (documentParts.length > 0) {
          const userQuestion = stripDocumentRefs(prompt) || 'Resume el contenido de los archivos adjuntos.'
          const docInstruction = buildDocumentResponseInstruction(userQuestion)
          const client = getDefaultClient()
          let buffer = ''
          await client.streamChat(
            [
              {
                role: 'system',
                content: [
                  'You are Null, a helpful assistant.',
                  buildDocumentContextMessage(documentParts),
                ].join('\n\n'),
              },
              {
                role: 'user',
                content: `${userQuestion}\n\n${docInstruction}`,
              },
            ],
            (token: string) => {
              buffer += token
              process.stdout.write(token)
            },
            { temperature: 0.3 },
          )
          process.stdout.write('\n')
          return
        }

        const result = await processQuery(prompt, false, (msg) => {
          process.stdout.write(`\n\x1B[90m${msg}\x1B[0m\n`)
        })

        if (result.directResponse) {
          process.stdout.write('\n' + result.directResponse + '\n')
          return
        }

        // Send the processed context to LLM for a natural response
        const systemContent = result.searchContext
          ? `You are Null. Use the following data to answer the user.\n\n${result.searchContext}`
          : 'You are Null, a helpful assistant. Answer concisely.'

        const client = getDefaultClient()
        let buffer = ''
        await client.streamChat(
          [
            { role: 'system', content: systemContent },
            { role: 'user', content: result.userContent },
          ],
          (token: string) => {
            buffer += token
            process.stdout.write(token)
          },
        )
        process.stdout.write('\n')
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('\n\x1B[31mError:\x1B[0m ' + msg)
      }
    })

  program.parse()
}
