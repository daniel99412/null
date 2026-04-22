import { Command } from 'commander'
import { runTUI } from '../tui/App.js'
import { streamChat } from '../core/ollama.js'
import { renderMarkdown } from '../utils/markdown.js'
import { loadConfig, setAccentColor, saveConfig, type AccentColor } from '../config/index.js'
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
    .argument('<key>', 'config key (accent-color, weather-key)')
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
      } else {
        console.error(`Unknown key: ${key}. Valid keys: accent-color, weather-key`)
        process.exit(1)
      }
    })

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
