import { loadConfig, saveConfig, type CachedLocation } from '../config/index.js'

export interface GeoLocation {
  lat: number
  lon: number
  city: string
  region: string
  country: string
  country_code: string
  timezone: string
  ip: string
}

// In-memory cache for the current process lifetime
let memCache: GeoLocation | null = null

async function fetchWithTimeout(url: string, timeoutMs = 8000): Promise<Response> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
  } finally {
    clearTimeout(id)
  }
}

/**
 * Get current public IP via api.ipify.org — no rate limit, very fast.
 */
async function getCurrentIP(): Promise<string> {
  const res = await fetchWithTimeout('https://api.ipify.org?format=json', 5000)
  if (!res.ok) throw new Error(`ipify responded with ${res.status}`)
  const data = await res.json() as { ip: string }
  return data.ip
}

/**
 * Resolve IP → location via ipapi.co.
 * Only called when IP has changed — avoids rate limit.
 */
async function resolveWithIpapi(ip: string): Promise<GeoLocation> {
  const res = await fetchWithTimeout(`https://ipapi.co/${ip}/json/`)
  if (!res.ok) throw new Error(`ipapi.co responded with ${res.status}`)

  const data = await res.json() as {
    latitude: number
    longitude: number
    city: string
    region: string
    country_name: string
    country_code: string
    timezone: string
    ip: string
    error?: boolean
    reason?: string
  }

  if (data.error) throw new Error(`ipapi.co: ${data.reason ?? 'unknown error'}`)

  return {
    lat: data.latitude,
    lon: data.longitude,
    city: data.city,
    region: data.region,
    country: data.country_name,
    country_code: data.country_code,
    timezone: data.timezone,
    ip: data.ip,
  }
}

/**
 * Resolve IP → location via ip-api.com (fallback, no key needed, generous limits).
 */
async function resolveWithIpApiCom(ip: string): Promise<GeoLocation> {
  const res = await fetchWithTimeout(`http://ip-api.com/json/${ip}?fields=status,lat,lon,city,regionName,country,countryCode,timezone,query`)
  if (!res.ok) throw new Error(`ip-api.com responded with ${res.status}`)

  const data = await res.json() as {
    status: string
    lat: number
    lon: number
    city: string
    regionName: string
    country: string
    countryCode: string
    timezone: string
    query: string
  }

  if (data.status !== 'success') throw new Error('ip-api.com: request failed')

  return {
    lat: data.lat,
    lon: data.lon,
    city: data.city,
    region: data.regionName,
    country: data.country,
    country_code: data.countryCode,
    timezone: data.timezone,
    ip: data.query,
  }
}

/**
 * Resolve IP → location via ipwho.is (second fallback, no key needed).
 */
async function resolveWithIpwho(ip: string): Promise<GeoLocation> {
  const res = await fetchWithTimeout(`https://ipwho.is/${ip}`)
  if (!res.ok) throw new Error(`ipwho.is responded with ${res.status}`)

  const data = await res.json() as {
    success: boolean
    latitude: number
    longitude: number
    city: string
    region: string
    country: string
    country_code: string
    timezone: { id: string }
    ip: string
    message?: string
  }

  if (!data.success) throw new Error(`ipwho.is: ${data.message ?? 'unknown error'}`)

  return {
    lat: data.latitude,
    lon: data.longitude,
    city: data.city,
    region: data.region,
    country: data.country,
    country_code: data.country_code,
    timezone: data.timezone.id,
    ip: data.ip,
  }
}

/**
 * Resolve IP → location, trying multiple services in order:
 * ipapi.co → ip-api.com → ipwho.is
 */
async function resolveLocation(ip: string): Promise<GeoLocation> {
  const providers: Array<() => Promise<GeoLocation>> = [
    () => resolveWithIpapi(ip),
    () => resolveWithIpApiCom(ip),
    () => resolveWithIpwho(ip),
  ]

  let lastError: unknown
  for (const provider of providers) {
    try {
      return await provider()
    } catch (err) {
      lastError = err
    }
  }
  throw new Error(`All geolocation providers failed. Last error: ${lastError}`)
}

/**
 * Get current location.
 *
 * Strategy:
 * 1. Use in-memory cache if available (same process run).
 * 2. Get current public IP (ipify — no rate limit).
 * 3. If IP matches config cache → return cached location (no ipapi call).
 * 4. If IP changed → call ipapi.co, persist new location to config.
 */
export async function getLocation(): Promise<GeoLocation> {
  if (memCache) return memCache

  const config = loadConfig()

  let currentIP: string
  try {
    currentIP = await getCurrentIP()
  } catch {
    // ipify failed — fall back to config cache if available
    if (config.cachedLocation) {
      const loc = config.cachedLocation
      memCache = { ...loc }
      return memCache
    }
    throw new Error('Could not determine current IP and no cached location available')
  }

  // IP unchanged — use persisted cache
  if (config.cachedLocation && config.cachedLocation.ip === currentIP) {
    memCache = { ...config.cachedLocation }
    return memCache
  }

  // IP changed (or no cache) — resolve via ipapi.co
  const location = await resolveLocation(currentIP)

  // Persist to config
  const newCache: CachedLocation = {
    ip: location.ip,
    lat: location.lat,
    lon: location.lon,
    city: location.city,
    region: location.region,
    country: location.country,
    country_code: location.country_code,
    timezone: location.timezone,
  }
  config.cachedLocation = newCache
  saveConfig(config)

  memCache = location
  return memCache
}
