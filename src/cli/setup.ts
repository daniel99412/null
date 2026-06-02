import readline from 'readline'
import { loadConfig, saveConfig, DEFAULT_MODEL } from '../config/index.js'
import { checkHealth } from '../core/health.js'

// ─── Readline helpers ─────────────────────────────────────────────────────────

function createRL(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()))
  })
}

function print(msg: string): void {
  process.stdout.write(msg + '\n')
}

function dim(msg: string): string {
  return `\x1B[2m${msg}\x1B[0m`
}

function cyan(msg: string): string {
  return `\x1B[36m${msg}\x1B[0m`
}

function green(msg: string): string {
  return `\x1B[32m${msg}\x1B[0m`
}

function yellow(msg: string): string {
  return `\x1B[33m${msg}\x1B[0m`
}

function red(msg: string): string {
  return `\x1B[31m${msg}\x1B[0m`
}

function bold(msg: string): string {
  return `\x1B[1m${msg}\x1B[0m`
}

// ─── Steps ────────────────────────────────────────────────────────────────────

async function stepOllama(): Promise<{ available: boolean; models: string[] }> {
  print('\n' + bold('Step 1: Checking Ollama') + dim(' — required'))
  process.stdout.write('  Connecting to localhost:11434... ')

  const health = await checkHealth(3000)

  if (!health.ollama.available) {
    print(red('✗ offline'))
    print('')
    print('  Ollama is not running. To install and start it:')
    print(cyan('    brew install ollama') + dim('  (macOS)'))
    print(cyan('    ollama serve'))
    print('')
    print('  Then re-run: ' + cyan('null setup'))
    return { available: false, models: [] }
  }

  print(green(`✓ online`) + dim(` (${health.ollama.latencyMs}ms)`))
  if (health.ollama.models.length > 0) {
    print(dim(`  Installed models: ${health.ollama.models.join(', ')}`))
  } else {
    print(yellow('  No models installed yet.'))
    print(dim('  Tip: ollama pull qwen2.5:7b'))
  }

  return { available: true, models: health.ollama.models }
}

async function stepModel(rl: readline.Interface, models: string[]): Promise<string> {
  print('\n' + bold('Step 2: Choose your model'))

  const config = loadConfig()
  const currentModel = config.model ?? DEFAULT_MODEL

  if (models.length === 0) {
    print(dim(`  No models found. Using default: ${DEFAULT_MODEL}`))
    return DEFAULT_MODEL
  }

  const defaultChoice = models.includes('qwen2.5:7b')
    ? 'qwen2.5:7b'
    : models[0]

  print(dim(`  Current: ${currentModel}`))
  print(dim(`  Available: ${models.join(', ')}`))
  print('')

  const answer = await ask(rl, `  Model to use [${defaultChoice}]: `)
  const chosen = answer || defaultChoice

  if (!models.includes(chosen)) {
    print(yellow(`  Warning: '${chosen}' is not in the installed list. It will be used anyway.`))
  }

  return chosen
}

function printSummary(model: string): void {
  print('\n' + bold('Setup complete!') + ' ' + green('✓'))
  print('')
  print(dim('  Configuration:'))
  print(`    Model      ${cyan(model)}`)
  print('')
  print(dim('  Try it:'))
  print(`    ${cyan('null')}                    ${dim('open interactive chat')}`)
  print(`    ${cyan('null "hola, cómo estás"')} ${dim('quick prompt')}`)
  print(`    ${cyan('null health')}             ${dim('check service status')}`)
  print(`    ${cyan('null config show')}        ${dim('view full config')}`)
  print('')
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function runSetup(): Promise<void> {
  print(bold('\nnull CLI — Setup Wizard'))
  print(dim('─'.repeat(40)))

  const config = loadConfig()
  let dirty = false

  const rl = createRL()

  // Handle Ctrl+C: save what we have and exit gracefully
  rl.on('SIGINT', () => {
    print('\n' + yellow('\nInterrupted. Saving progress...'))
    if (dirty) {
      saveConfig(config)
      print(green('  Config saved.'))
    }
    rl.close()
    process.exit(0)
  })

  try {
    // Step 1: Ollama check
    const { available, models } = await stepOllama()
    if (!available) {
      rl.close()
      process.exit(1)
    }

    // Step 2: Model selection
    const model = await stepModel(rl, models)
    if (model !== (config.model ?? DEFAULT_MODEL)) {
      config.model = model
      dirty = true
    }

    // Save config
    if (dirty) {
      saveConfig(config)
      print('\n' + dim('  Config saved to ~/.null-cli/config.json'))
    }

    printSummary(config.model ?? DEFAULT_MODEL)
  } finally {
    rl.close()
  }
}
