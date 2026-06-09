import { getCurrentWeather, getWeatherByCity, type WeatherData } from '../tools/weather.js'

export function extractCityFromQuery(query: string): string | null {
  const patterns = [
    /(?:clima|tiempo|temperatura|weather)\s+(?:en|de|para|in)\s+([A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+?)(?:\?|$|,|\s+hoy|\s+ahorita|\s+ahora)/i,
    /(?:en|de|para|in)\s+([A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+?)\s+(?:clima|tiempo|temperatura|weather)/i,
    /(?:hace\s+(?:calor|frío|frio)\s+en)\s+([A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+?)(?:\?|$|,)/i,
    /(?:llov(?:er[áa]|er[eé]|e|iendo|er)\s+(?:en|hoy en|mañana en|esta noche en)|va\s+a\s+llover\s+en|habrá?\s+lluvia\s+en)\s+([A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+?)(?:\?|$|,)/i,
    /(?:hoy|mañana|esta\s+(?:noche|tarde|mañana))\s+(?:llov\w+|nev\w+|graniz\w+|lluve|llueve)\s+en\s+([A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]+?)(?:\?|$|,)/i,
    /(?:^|\s)en\s+([A-Za-záéíóúüñÁÉÍÓÚÜÑ][A-Za-záéíóúüñÁÉÍÓÚÜÑ\s]{2,})(?:\?|$|,)/i,
  ]

  for (const pattern of patterns) {
    const match = query.match(pattern)
    if (match) {
      const city = match[1].trim()
      if (city.length >= 3 && !/^(hoy|ahora|aqui|aquí|mi|la|el|un|una|esta|este)$/i.test(city)) {
        return city
      }
    }
  }

  return null
}

export function buildWeatherContext(weather: WeatherData): string {
  const sunriseStr = new Date(weather.sunrise * 1000).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  const sunsetStr = new Date(weather.sunset * 1000).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  const locationStr = weather.location
    ? `Ubicación detectada (IP): ${weather.location.city}, ${weather.location.region}`
    : `Ciudad consultada: ${weather.city_query}`

  return [
    `[DATOS REALES DEL CLIMA — obtenidos ahora mismo vía API]`,
    `Ciudad: ${weather.city_name}, ${weather.country}`,
    `Condición: ${weather.description}`,
    `Temperatura: ${weather.temp}°C (sensación térmica ${weather.feels_like}°C)`,
    `Humedad: ${weather.humidity}%`,
    `Presión: ${weather.pressure} hPa`,
    `Viento: ${weather.wind_speed} m/s`,
    `Visibilidad: ${(weather.visibility / 1000).toFixed(1)} km`,
    `Nubosidad: ${weather.clouds}%`,
    `Amanecer: ${sunriseStr} / Atardecer: ${sunsetStr}`,
    locationStr,
    ``,
    `Use this real weather data to answer naturally and conversationally. Reply in the same language the user used. Do NOT say you do not have internet access; this data is real and current.`,
  ].join('\n')
}

export async function getWeatherContextForQuery(query: string): Promise<string> {
  const city = extractCityFromQuery(query)
  const weather = city
    ? await getWeatherByCity(city)
    : await getCurrentWeather()

  return buildWeatherContext(weather)
}
