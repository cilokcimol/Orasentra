// Pure scoring math, shared by the server and the tests.

import type { VoiceStats } from './keeper.js'

export const brier = (p: number, outcome: 0 | 1) => (p - outcome) ** 2

/** Credibility in [0.05, 0.95]. 0.5 means "as good as the baseline"; it moves only as evidence piles up. */
export function credibility(v: Pick<VoiceStats, 'n' | 'brierSum' | 'baseSum'>): number {
  if (!v.n) return 0.5
  const edge = (v.baseSum - v.brierSum) / v.n // positive when the voice beats the baseline
  const shrink = v.n / (v.n + 4)
  return Math.min(0.95, Math.max(0.05, 0.5 + edge * 2.2 * shrink))
}

/** Weights for the Orasentra blend. Squared credibility so proven voices pull harder. */
export function weights(creds: Record<string, number>): Record<string, number> {
  const entries = Object.entries(creds)
  const raw = entries.map(([k, c]) => [k, Math.max(0.0025, c * c)] as const)
  const sum = raw.reduce((a, [, w]) => a + w, 0) || 1
  return Object.fromEntries(raw.map(([k, w]) => [k, w / sum]))
}

export function blend(probs: Record<string, number>, w: Record<string, number>): number {
  let num = 0
  let den = 0
  for (const [k, p] of Object.entries(probs)) {
    const wk = w[k] ?? 0
    num += wk * p
    den += wk
  }
  return den ? clampP(num / den) : 0.5
}

export const clampP = (p: number) => Math.min(0.99, Math.max(0.01, p))

export const spread = (probs: Record<string, number>) => {
  const v = Object.values(probs)
  return v.length ? Math.max(...v) - Math.min(...v) : 0
}

/** Standard normal CDF. */
export function phi(x: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989423 * Math.exp((-x * x) / 2)
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return x > 0 ? 1 - p : p
}

/** Chance the price ends above a line, from current price and daily volatility (lognormal, no drift). */
export function probAbove(price: number, line: number, hours: number, dailyVol: number) {
  if (hours <= 0) return price > line ? 0.99 : 0.01
  const sigma = dailyVol * Math.sqrt(hours / 24)
  return clampP(phi(Math.log(price / line) / Math.max(sigma, 1e-6)))
}

/** Daily volatility from a price series sampled at irregular times. */
export function dailyVol(series: { t: number; usd: number }[]): number {
  const pts = series.filter(p => p.usd > 0).sort((a, b) => a.t - b.t)
  let sum = 0
  let hours = 0
  for (let i = 1; i < pts.length; i++) {
    const dt = (pts[i].t - pts[i - 1].t) / 3600000
    if (dt <= 0 || dt > 48) continue
    const r = Math.log(pts[i].usd / pts[i - 1].usd)
    sum += r * r
    hours += dt
  }
  if (hours < 6) return 0.045
  return Math.min(0.2, Math.max(0.015, Math.sqrt((sum / hours) * 24)))
}

/** Fewest transfers that settle a set of balances (positive means owed money). */
export function settleUp(balances: Record<string, number>) {
  const cred = Object.entries(balances).filter(([, v]) => v > 0.005).map(([k, v]) => ({ k, v })).sort((a, b) => b.v - a.v)
  const debt = Object.entries(balances).filter(([, v]) => v < -0.005).map(([k, v]) => ({ k, v: -v })).sort((a, b) => b.v - a.v)
  const out: { from: string; to: string; amount: number }[] = []
  let i = 0
  let j = 0
  while (i < debt.length && j < cred.length) {
    const amt = Math.min(debt[i].v, cred[j].v)
    out.push({ from: debt[i].k, to: cred[j].k, amount: Math.round(amt * 100) / 100 })
    debt[i].v -= amt
    cred[j].v -= amt
    if (debt[i].v < 0.005) i++
    if (cred[j].v < 0.005) j++
  }
  return out
}

export const pct = (p: number) => `${Math.round(p * 100)}%`
