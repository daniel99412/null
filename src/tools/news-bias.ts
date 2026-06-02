/**
 * Bias and polarization analysis for news stories.
 *
 * Scale: 1 (izquierda dura) → 10 (derecha dura), 5 = centro
 *
 * Computation:
 *   sourcePrior       = weighted average of source bias_base
 *   coverageContextBias = mean of all sources covering story
 *   articleBias       = LLM-estimated (optional, low weight)
 *   finalBias         = formula from RFC
 *   polarization      = std deviation of source biasBase values
 */

import type { NewsStory } from './news-cluster.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BiasResult {
  /** Weighted final bias score (1–10) */
  finalBias: number
  /** Human-readable label */
  biasLabel: string
  /** Polarization std dev */
  polarizationScore: number
  /** Human-readable polarization label */
  polarizationLabel: 'baja' | 'media' | 'alta' | 'no estimable'
  /** Coverage context (mean of covering sources) */
  coverageContextBias: number
  /** Source prior (reliability-weighted mean) */
  sourcePrior: number
  /** Number of distinct sources covering the story */
  sourcesCount: number
}

// ─── Bias labels ──────────────────────────────────────────────────────────────

export function biasLabel(score: number): string {
  if (score <= 1.5) return 'izquierda dura'
  if (score <= 2.5) return 'izquierda fuerte'
  if (score <= 3.5) return 'izquierda moderada'
  if (score <= 4.5) return 'centro izquierda'
  if (score <= 5.5) return 'centro'
  if (score <= 6.5) return 'centro derecha'
  if (score <= 7.5) return 'derecha moderada'
  if (score <= 8.5) return 'derecha'
  if (score <= 9.5) return 'derecha fuerte'
  return 'derecha dura'
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

function mean(values: number[]): number {
  if (values.length === 0) return 5.0
  return values.reduce((a, b) => a + b, 0) / values.length
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0
  const m = mean(values)
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function weightedMean(values: number[], weights: number[]): number {
  const totalWeight = weights.reduce((a, b) => a + b, 0)
  if (totalWeight === 0) return mean(values)
  return values.reduce((acc, v, i) => acc + v * weights[i], 0) / totalWeight
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Calculate bias and polarization for a story.
 * No LLM call in this version (articleBias = null per RFC for v1).
 */
export function analyzeBias(story: NewsStory): BiasResult {
  const biases = story.articles.map((a) => a.biasBase)
  const reliabilities = story.articles.map((a) => a.reliability)
  const sourcesCount = story.sources.length

  // Source prior: reliability-weighted mean of bias
  const sourcePrior = weightedMean(biases, reliabilities)

  // Coverage context: simple mean across covering sources
  const coverageContextBias = mean(biases)

  // Polarization: std dev across source biases
  const polarizationScore = stddev(biases)

  // Final bias (fallback formula — no LLM article bias in v1)
  const finalBias = sourcePrior * 0.85 + coverageContextBias * 0.15

  // Clamp to [1, 10]
  const clampedBias = Math.max(1, Math.min(10, finalBias))

  // Polarization label
  let polarizationLabel: BiasResult['polarizationLabel']
  if (sourcesCount < 2) {
    polarizationLabel = 'no estimable'
  } else if (polarizationScore <= 0.8) {
    polarizationLabel = 'baja'
  } else if (polarizationScore <= 1.6) {
    polarizationLabel = 'media'
  } else {
    polarizationLabel = 'alta'
  }

  return {
    finalBias: clampedBias,
    biasLabel: biasLabel(clampedBias),
    polarizationScore,
    polarizationLabel,
    coverageContextBias,
    sourcePrior,
    sourcesCount,
  }
}
