import fs from 'fs'
import path from 'path'
import os from 'os'

const CONFIG_DIR = path.join(os.homedir(), '.null-cli')
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json')

export const DEFAULT_MODEL = 'qwen2.5-coder:7b'
export const ROUTER_MODEL = 'qwen2.5:3b'
export const DEFAULT_OLLAMA_URL = 'http://localhost:11434'

export const AVAILABLE_COLORS = [
  'cyan',
  'green',
  'blue',
  'magenta',
  'yellow',
  'red',
  'white',
] as const

export type AccentColor = typeof AVAILABLE_COLORS[number]

export interface CachedLocation {
  ip: string
  lat: number
  lon: number
  city: string
  region: string
  country: string
  country_code: string
  timezone: string
}

export interface MCPExternalServer {
  command: string
  args?: string[]
  transport?: 'stdio'
}

export interface NullConfig {
  accentColor: AccentColor
  openWeatherApiKey?: string
  cachedLocation?: CachedLocation
  model?: string
  routerModel?: string
  ollamaUrl?: string
  userName?: string
  setupCompleted?: boolean
  mcpServers?: Record<string, MCPExternalServer>
}

const DEFAULT_CONFIG: NullConfig = {
  accentColor: 'cyan',
}

export function loadConfig(): NullConfig {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      return { ...DEFAULT_CONFIG }
    }
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<NullConfig>
    return {
      accentColor: AVAILABLE_COLORS.includes(parsed.accentColor as AccentColor)
        ? (parsed.accentColor as AccentColor)
        : DEFAULT_CONFIG.accentColor,
      openWeatherApiKey: parsed.openWeatherApiKey,
      cachedLocation: parsed.cachedLocation,
      model: parsed.model,
      routerModel: parsed.routerModel,
      ollamaUrl: parsed.ollamaUrl,
      userName: parsed.userName,
      setupCompleted: parsed.setupCompleted,
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveConfig(config: NullConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n', 'utf-8')
}

export function setAccentColor(color: AccentColor): void {
  const config = loadConfig()
  config.accentColor = color
  saveConfig(config)
}

export function setModel(model: string): void {
  const config = loadConfig()
  config.model = model
  saveConfig(config)
}

/**
 * Returns true if the user has not yet completed first-run setup.
 * The setup is considered complete when either `setupCompleted` is true
 * OR a `userName` has been saved.
 */
export function isFirstRun(): boolean {
  const config = loadConfig()
  return !config.setupCompleted && !config.userName
}

/**
 * Persist first-run setup state. The accent color is also saved here
 * so the chosen theme survives across runs.
 */
export function completeSetup(opts: { userName?: string; accentColor: AccentColor }): void {
  const config = loadConfig()
  if (opts.userName && opts.userName.trim()) {
    config.userName = opts.userName.trim()
  }
  config.accentColor = opts.accentColor
  config.setupCompleted = true
  saveConfig(config)
}
