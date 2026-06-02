// Ensures execute.ts stays in sync with the tools registry (compile-time validation)
import type {} from './execute.js'

export const tools = {
  get_time: () => {
    const now = new Date()

    return {
      iso: now.toISOString(),
      time: now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }),
      date: now.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' }),
      day: now.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' }),
    }
  },

  get_location: async () => {
    // Location via IP geolocation — simple fallback
    try {
      const res = await fetch('https://ipapi.co/json/')
      if (!res.ok) throw new Error(`ipapi.co error: ${res.status}`)
      const data = await res.json() as { city?: string; region?: string; country_name?: string; latitude?: number; longitude?: number }
      return {
        city: data.city ?? 'Unknown',
        region: data.region ?? '',
        country: data.country_name ?? '',
        lat: data.latitude ?? 0,
        lon: data.longitude ?? 0,
      }
    } catch {
      return { city: 'Unknown', region: '', country: '', lat: 0, lon: 0 }
    }
  },
}
