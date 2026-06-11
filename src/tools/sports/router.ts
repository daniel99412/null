import { debugLog } from '../../utils/debug.js'
import type { SportProvider, SportsCapability, SportsProvider } from './types.js'
import { espnProvider } from './providers/espn.js'
import { fotmobProvider } from './providers/fotmob.js'
import { sofascoreProvider } from './providers/sofascore.js'

const PROVIDERS: Record<SportProvider, SportsProvider> = {
  fotmob: fotmobProvider,
  espn: espnProvider,
  sofascore: sofascoreProvider,
}

const PROVIDER_PRIORITY: Record<SportsCapability, SportProvider[]> = {
  scoreboard: ['fotmob', 'espn'],
  standings: ['fotmob', 'espn'],
  fixtures: ['fotmob', 'espn'],
  news: ['espn', 'fotmob'],
}

export function resolveProviders(capability: SportsCapability): SportsProvider[] {
  return PROVIDER_PRIORITY[capability]
    .map((id) => PROVIDERS[id])
    .filter((provider) => provider.capabilities[capability])
}

export async function withProviderFallback<T>(
  capability: SportsCapability,
  run: (provider: SportsProvider) => Promise<T>,
): Promise<{ provider: SportProvider; result: T }> {
  const providers = resolveProviders(capability)
  let lastError: Error | null = null

  for (const provider of providers) {
    try {
      const result = await run(provider)
      return { provider: provider.id, result }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      debugLog(`[sports] provider ${provider.id} failed for ${capability}: ${lastError.message}`)
    }
  }

  throw lastError ?? new Error(`No provider available for ${capability}`)
}
