import { getLocation, type GeoLocation } from './gps.js'
import { loadConfig } from '../config/index.js'

const OPENWEATHER_BASE = 'https://api.openweathermap.org/data/2.5'

export interface WeatherData {
  location: GeoLocation | null
  city_query: string | null  // set when queried by city name
  temp: number
  feels_like: number
  humidity: number
  pressure: number
  wind_speed: number
  wind_deg: number
  description: string
  icon: string
  city_name: string
  country: string
  sunrise: number
  sunset: number
  visibility: number
  clouds: number
  timestamp: number
}

interface OWResponse {
  main: { temp: number; feels_like: number; humidity: number; pressure: number }
  wind: { speed: number; deg: number }
  weather: { description: string; icon: string }[]
  sys: { country: string; sunrise: number; sunset: number }
  name: string
  visibility: number
  clouds: { all: number }
  dt: number
}

async function fetchWithTimeout(url: string, timeout: number = 10000): Promise<Response> {
  const controller = new AbortController()
  const id = setTimeout(() => controller.abort(), timeout)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(id)
  }
}

function parseOWResponse(data: OWResponse, location: GeoLocation | null, cityQuery: string | null): WeatherData {
  return {
    location,
    city_query: cityQuery,
    temp: Math.round(data.main.temp),
    feels_like: Math.round(data.main.feels_like),
    humidity: data.main.humidity,
    pressure: data.main.pressure,
    wind_speed: Math.round(data.wind.speed * 10) / 10,
    wind_deg: data.wind.deg,
    description: data.weather[0]?.description || '',
    icon: data.weather[0]?.icon || '',
    city_name: data.name,
    country: data.sys.country,
    sunrise: data.sys.sunrise,
    sunset: data.sys.sunset,
    visibility: data.visibility,
    clouds: data.clouds.all,
    timestamp: data.dt,
  }
}

function getApiKey(): string {
  const config = loadConfig()
  if (!config.openWeatherApiKey) {
    throw new Error('OpenWeather API key not configured. Run: null config set weather-key <your-api-key>')
  }
  return config.openWeatherApiKey
}

/**
 * Get weather for current location via IP geolocation.
 */
export async function getCurrentWeather(): Promise<WeatherData> {
  const apiKey = getApiKey()
  const location = await getLocation()

  const url = `${OPENWEATHER_BASE}/weather?lat=${location.lat}&lon=${location.lon}&units=metric&lang=es&appid=${apiKey}`
  const res = await fetchWithTimeout(url)
  if (!res.ok) {
    throw new Error(`OpenWeather API error: ${res.status}`)
  }
  const data = await res.json() as OWResponse
  return parseOWResponse(data, location, null)
}

/**
 * Get weather for a specific city name (e.g. "Cancún", "Tokyo", "New York").
 */
export async function getWeatherByCity(city: string): Promise<WeatherData> {
  const apiKey = getApiKey()

  const url = `${OPENWEATHER_BASE}/weather?q=${encodeURIComponent(city)}&units=metric&lang=es&appid=${apiKey}`
  const res = await fetchWithTimeout(url)
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(`Ciudad "${city}" no encontrada`)
    }
    throw new Error(`OpenWeather API error: ${res.status}`)
  }
  const data = await res.json() as OWResponse
  return parseOWResponse(data, null, city)
}
