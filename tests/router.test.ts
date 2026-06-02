/**
 * Regression tests for the heuristic router.
 *
 * These tests cover ONLY the heuristic layer (no Ollama calls).
 * They verify that the patterns correctly classify queries into:
 *   - none        → general knowledge, programming, science, math, history
 *   - getDateTime → date/time questions
 *   - sportsQuery → scores, standings, schedules, jornadas
 *   - webSearch   → recency-dependent or unknown queries
 *
 * The router calls Ollama as a fallback only when no heuristic matches,
 * so these tests mock the fetch to prevent network calls.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest'

// Mock fetch globally so no Ollama calls go out during tests
beforeAll(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ message: { content: '{"tool":"none","confidence":0.9}' } }),
  }))
})

import { routeQuery } from '../src/core/router.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function decision(query: string) {
  const result = await routeQuery(query)
  return result.decision
}

// ---------------------------------------------------------------------------
// NONE — general knowledge, programming, science, math, history
// ---------------------------------------------------------------------------

describe('router → none (heuristic)', () => {
  const cases = [
    // Programming
    'cómo se define una function en javascript',
    'qué es un array en python',
    'hello world en typescript',
    'cómo funciona la recursion',
    'qué es un algoritmo',
    'cómo uso un loop en go',
    'qué es una clase en oop',
    // Science / math
    'cuál es el teorema de pitágoras',
    'cuál es la ley de newton',
    'qué es la gravedad',
    'cuál es la fórmula del agua',
    'qué es la evolución',
    'cuál es la capital de Francia',
    'cuántos planetas hay en el sistema solar',
    // History / knowledge
    'qué fue la segunda guerra mundial',
    'cuéntame sobre la revolución francesa',
    'qué es la fotosíntesis',
    'quién fue Napoleón Bonaparte',
    'explícame la batalla de waterloo',
    'qué es la edad media',
    'qué fue la conquista de México',
    'qué es la constitución',
    'quién soy',
    'que sabes de mí',
  ]

  for (const query of cases) {
    it(`"${query}"`, async () => {
      expect(await decision(query)).toBe('none')
    })
  }
})

// ---------------------------------------------------------------------------
// GETDATETIME
// ---------------------------------------------------------------------------

describe('router → getDateTime (heuristic)', () => {
  const cases = [
    'qué hora es',
    'what time is it',
    'qué día es hoy',
    'what day is it today',
    'en qué fecha estamos',
    'qué fecha es hoy',
    'what is today\'s date',
  ]

  for (const query of cases) {
    it(`"${query}"`, async () => {
      expect(await decision(query)).toBe('getDateTime')
    })
  }
})

// ---------------------------------------------------------------------------
// SPORTSQUERY
// ---------------------------------------------------------------------------

describe('router → sportsQuery (heuristic)', () => {
  const cases = [
    // Resultados / marcadores
    'resultados de la liga mx',
    'dame los resultados del fin de semana',
    'marcadores de hoy en la liga mx',
    'cuál fue el marcador del partido de chivas',
    'cómo quedó el america ayer',
    'cómo terminó el partido de pumas',
    // Jornadas
    'última jornada de la liga mx',
    'dame la ultima jornada',
    'jornada pasada liga mx',
    'jornada anterior',
    'jornada 15 liga mx',
    // Jornada con liga en cualquier orden
    'que tal estuvo la jornada de la liga',
    'dame los resultados de LaLiga de la jornada pasada',
    'como estuvo la jornada de la liga mx',
    'jornada de la liga mx',
    // Tabla / standings
    'tabla de posiciones de la liga mx',
    'tabla general del clausura',
    'standings de la premier league',
    'clasificación de la liga mx',
    // Próximos partidos
    'próximos partidos de la liga mx',
    'proximos juegos del america',
    // Liga mx + contexto temporal
    'liga mx de hoy',
    'resultados liga mx semana pasada',
    // Verbos de juego
    'cuándo juega el america',
    'jugaron ayer las chivas',
    'jugó el atlas este fin de semana',
    // Fin de semana
    'me puedes dar los resultados del fin de semana de la liga mx',
  ]

  for (const query of cases) {
    it(`"${query}"`, async () => {
      expect(await decision(query)).toBe('sportsQuery')
    })
  }
})

// ---------------------------------------------------------------------------
// WEBSEARCH — recency-dependent queries
// ---------------------------------------------------------------------------

describe('router → webSearch (heuristic)', () => {
  const cases = [
    // Years past cutoff
    'noticias de 2025',
    'qué pasó en 2024 con openai',
    // Prices / markets
    'precio del dólar hoy',
    'cotización del bitcoin ahora',
    // Latest news
    'últimas noticias de tecnología',
    'latest news about climate change',
    'noticias recientes',
  ]

  for (const query of cases) {
    it(`"${query}"`, async () => {
      expect(await decision(query)).toBe('webSearch')
    })
  }
})

// ---------------------------------------------------------------------------
// Edge cases — sports should NOT fall into webSearch even with "hoy"/"ayer"
// ---------------------------------------------------------------------------

describe('router → sportsQuery takes priority over webSearch patterns', () => {
  const cases = [
    'resultados de hoy en la liga mx',
    'marcadores de ayer',
    'últimos resultados del america',
  ]

  for (const query of cases) {
    it(`"${query}"`, async () => {
      expect(await decision(query)).toBe('sportsQuery')
    })
  }
})

// ---------------------------------------------------------------------------
// Source should be 'heuristic' for all pattern matches (no LLM call)
// ---------------------------------------------------------------------------

describe('router source is heuristic (no LLM)', () => {
  it('programming query uses heuristic', async () => {
    const result = await routeQuery('cómo funciona un array')
    expect(result.source).toBe('heuristic')
  })

  it('sports query uses heuristic', async () => {
    const result = await routeQuery('resultados liga mx')
    expect(result.source).toBe('heuristic')
  })

  it('datetime query uses heuristic', async () => {
    const result = await routeQuery('qué hora es')
    expect(result.source).toBe('heuristic')
  })
})
