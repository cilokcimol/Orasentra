// Calls: log picks before events, score every voice after, and learn whom to trust.

import { read, update } from './store.js'
import * as pm from './polymarket.js'
import { suiPrice, tatumReady } from './tatum.js'
import { brier, credibility, weights, blend, spread, probAbove, dailyVol, clampP, pct } from './score.js'
import { remember } from './memory.js'
import { HttpError, keeperNs, learn, type Keeper, type Pick, type VoiceStats } from './keeper.js'

export interface Question {
  id: string
  source: 'polymarket' | 'onchain'
  category: 'sports' | 'politics' | 'culture' | 'crypto' | 'onchain'
  title: string
  side: string
  other: string
  image?: string
  url?: string
  closesAt: number
  marketId?: string
  marketP?: number
  line?: number
  priceAtOpen?: number
  createdAt: number
  outcome: 0 | 1 | null
  resolvedAt?: number
  resolution?: string
}

interface Board {
  updatedAt: number
  questions: Question[]
}

const BOARD = 'calls/board.json'
const PRICES = 'calls/prices.json'
const DAY = 86400000

// ---------------------------------------------------------------- price samples (Tatum)

export async function samplePrice(): Promise<{ usd: number; vol: number; series: { t: number; usd: number }[] } | null> {
  const series = await read<{ t: number; usd: number }[]>(PRICES, [], 20000)
  const last = series[series.length - 1]
  if (last && Date.now() - last.t < 10 * 60000) return { usd: last.usd, vol: dailyVol(series), series }
  if (!tatumReady()) return last ? { usd: last.usd, vol: dailyVol(series), series } : null
  try {
    const { usd } = await suiPrice()
    const next = await update<{ t: number; usd: number }[]>(PRICES, [], s => {
      s.push({ t: Date.now(), usd })
      return s.slice(-2000)
    })
    return { usd, vol: dailyVol(next), series: next }
  } catch {
    return last ? { usd: last.usd, vol: dailyVol(series), series } : null
  }
}

// ---------------------------------------------------------------- the board

const nextUtcMidnight = (days: number) => {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  return d.getTime() + days * DAY
}

export async function board(force = false): Promise<Board> {
  const current = await read<Board>(BOARD, { updatedAt: 0, questions: [] }, 30000)
  if (!force && Date.now() - current.updatedAt < 10 * 60000) return current
  const price = await samplePrice()
  const cats: pm.Category[] = ['sports', 'politics', 'culture', 'crypto']
  const fetched = await Promise.all(cats.map(c => pm.openMarkets(c).then(ms => ({ c, ms })).catch(() => ({ c, ms: [] as pm.PmMarket[] }))))

  const next = await update<Board>(BOARD, { updatedAt: 0, questions: [] }, b => {
    const byId = new Map(b.questions.map(q => [q.id, q]))
    for (const { c, ms } of fetched) {
      let added = 0
      for (const m of ms) {
        const id = `pm-${m.id}`
        const existing = byId.get(id)
        if (existing) {
          if (existing.outcome === null) existing.marketP = m.prices[0]
          continue
        }
        if (m.endDate < Date.now() + 2 * 3600000 || m.endDate > Date.now() + 30 * DAY) continue
        if (added >= 6 || b.questions.filter(q => q.category === c && q.outcome === null).length >= 8) continue
        const q: Question = {
          id,
          source: 'polymarket',
          category: c,
          title: m.question,
          side: m.outcomes[0],
          other: m.outcomes[1],
          image: m.image,
          url: pm.marketUrl(m),
          closesAt: m.endDate,
          marketId: m.id,
          marketP: m.prices[0],
          createdAt: Date.now(),
          outcome: null,
        }
        b.questions.push(q)
        byId.set(id, q)
        added++
      }
    }
    if (price) {
      for (const days of [1, 3, 7]) {
        const closesAt = nextUtcMidnight(days)
        const id = `sui-${new Date(closesAt).toISOString().slice(0, 10)}`
        if (byId.has(id)) continue
        const line = Math.round(price.usd * 100) / 100
        const date = new Date(closesAt).toUTCString().slice(0, 16)
        b.questions.push({
          id,
          source: 'onchain',
          category: 'onchain',
          title: `Will SUI trade above $${line.toFixed(2)} on the Cetus USDC pool at 00:00 UTC, ${date}?`,
          side: 'Above',
          other: 'Below',
          closesAt,
          line,
          priceAtOpen: price.usd,
          createdAt: Date.now(),
          outcome: null,
        })
      }
    }
    b.questions = b.questions.filter(q => q.outcome === null || (q.resolvedAt || 0) > Date.now() - 45 * DAY)
    b.updatedAt = Date.now()
  })
  try {
    await resolveDue(next, price?.usd)
  } catch (e) {
    console.error('resolve failed', e)
  }
  return read<Board>(BOARD, next)
}

async function resolveDue(b: Board, usd?: number) {
  const due = b.questions.filter(q => q.outcome === null && q.closesAt < Date.now()).slice(0, 12)
  if (!due.length) return
  const results = await Promise.all(
    due.map(async q => {
      if (q.source === 'onchain') {
        if (!q.line) return null
        // Prefer the first pool reading taken after the close; fall back to the current reading.
        const series = await read<{ t: number; usd: number }[]>(PRICES, [], 20000)
        const after = series.find(s => s.t >= q.closesAt)
        const at = after ? after.usd : usd
        if (!at) return null
        const late = Math.round(((after ? after.t : Date.now()) - q.closesAt) / 60000)
        return {
          id: q.id,
          outcome: (at > q.line ? 1 : 0) as 0 | 1,
          resolution: `SUI read at $${at.toFixed(4)} from the Cetus pool through Tatum, ${late} minutes after the close.`,
        }
      }
      const m = await pm.market(q.marketId!).catch(() => null)
      const o = m ? pm.resolvedOutcome(m) : null
      return o === null ? null : { id: q.id, outcome: o, resolution: `Polymarket settled ${o ? q.side : q.other}.` }
    }),
  )
  console.log('resolve', due.length, 'due,', results.filter(Boolean).map(r => `${r!.id}=${r!.outcome}`).join(' ') || 'none settled yet', 'price', usd)
  await update<Board>(BOARD, b, d => {
    for (const r of results) {
      if (!r) continue
      const q = d.questions.find(x => x.id === r.id)
      if (!q || q.outcome !== null) continue
      q.outcome = r.outcome
      q.resolvedAt = Date.now()
      q.resolution = r.resolution
    }
  })
}

// ---------------------------------------------------------------- voices

function voice(k: Keeper, name: string, kind: VoiceStats['kind']): VoiceStats {
  if (!k.voices[name]) k.voices[name] = { kind, n: 0, brierSum: 0, baseSum: 0, beat: 0, cred: 0.5, history: [{ t: Date.now(), cred: 0.5 }] }
  return k.voices[name]
}

export function trustTable(k: Keeper) {
  return Object.entries(k.voices)
    .map(([name, v]) => ({ name, kind: v.kind, n: v.n, cred: v.cred, beat: v.beat, avgBrier: v.n ? v.brierSum / v.n : null, history: v.history }))
    .sort((a, b) => b.cred - a.cred)
}

/** The automatic voices a question has, plus the voice that is the scoring baseline. */
async function autoVoices(q: Question): Promise<{ probs: Record<string, number>; baseline: string; kinds: Record<string, VoiceStats['kind']> }> {
  if (q.source === 'onchain') {
    const price = await samplePrice()
    if (!price || !q.line) throw new HttpError(503, 'The onchain price is not available right now. Try again in a minute.')
    const hours = (q.closesAt - Date.now()) / 3600000
    return { probs: { Onchain: probAbove(price.usd, q.line, hours, price.vol) }, baseline: 'Onchain', kinds: { Onchain: 'onchain' } }
  }
  if (q.marketP === undefined) throw new HttpError(503, 'Market odds are not loaded yet.')
  return { probs: { Market: clampP(q.marketP) }, baseline: 'Market', kinds: { Market: 'market' } }
}

export async function logPick(k: Keeper, qid: string, you: number, friends: Record<string, number>) {
  const b = await board()
  const q = b.questions.find(x => x.id === qid)
  if (!q) throw new HttpError(404, 'That question is no longer on the board.')
  if (q.outcome !== null || q.closesAt < Date.now()) throw new HttpError(409, 'This question has already closed. Picks only count before the event.')
  if (k.picks.some(p => p.qid === qid)) throw new HttpError(409, 'You already logged a call on this one. Calls are locked once logged.')
  if (!(you >= 0.01 && you <= 0.99)) throw new HttpError(400, 'Your probability must be between 1% and 99%.')

  const auto = await autoVoices(q)
  const probs: Record<string, number> = { You: clampP(you), ...auto.probs }
  voice(k, 'You', 'you')
  for (const [n, kind] of Object.entries(auto.kinds)) voice(k, n, kind)
  for (const [rawName, p] of Object.entries(friends).slice(0, 4)) {
    const name = rawName.replace(/[^\p{L}\p{N} .'_]/gu, '').trim().slice(0, 24)
    if (!name || name === 'You' || name === 'Orasentra' || !(p >= 0.01 && p <= 0.99)) continue
    probs[name] = clampP(p)
    voice(k, name, 'friend')
  }
  const creds = Object.fromEntries(Object.keys(probs).map(n => [n, k.voices[n].cred]))
  const w = weights(creds)
  probs.Orasentra = blend(probs, w)
  voice(k, 'Orasentra', 'orasentra')
  const disagreement = spread(Object.fromEntries(Object.entries(probs).filter(([n]) => n !== 'Orasentra')))

  const pick: Pick = { qid, title: q.title, side: q.side, category: q.category, closesAt: q.closesAt, at: Date.now(), probs, weights: w, disagreement }
  k.picks.push(pick)

  const others = Object.entries(probs)
    .filter(([n]) => n !== 'You' && n !== 'Orasentra')
    .map(([n, p]) => `${n} said ${pct(p)}`)
    .join('. ')
  const weightText = Object.entries(w)
    .map(([n, x]) => `${n} ${x.toFixed(2)}`)
    .join(', ')
  const flag = disagreement >= 0.2 ? ` Sources disagree by ${Math.round(disagreement * 100)} points.` : ''
  const text = `Call logged before the event on ${new Date().toISOString().slice(0, 16)} UTC. Question: "${q.title}" (${q.side}, closes ${new Date(q.closesAt).toISOString().slice(0, 10)}). You said ${pct(probs.You)}. ${others}. Orasentra blended ${pct(probs.Orasentra)} using weights ${weightText}.${flag}`
  const rec = await remember(keeperNs(k.id), 'calls', 'pick', text)
  k.memoryIds.push(rec.id)
  return { pick, memory: rec, question: q }
}

/** Scores every resolved pick, updates trust, and writes one scorecard memory per question. */
export async function scorePicks(k: Keeper) {
  const unscored = k.picks.filter(p => !p.scored)
  if (!unscored.length) return []
  const b = await read<Board>(BOARD, { updatedAt: 0, questions: [] }, 30000)
  const out: Pick[] = []
  for (const p of unscored) {
    const q = b.questions.find(x => x.id === p.qid)
    if (!q || q.outcome === null) continue
    const o = q.outcome
    const scores = Object.fromEntries(Object.entries(p.probs).map(([n, x]) => [n, brier(x, o)]))
    const baseName = q.source === 'onchain' ? 'Onchain' : 'Market'
    const base = scores[baseName] ?? 0.25
    for (const [n, s] of Object.entries(scores)) {
      const v = k.voices[n] || voice(k, n, n === 'Orasentra' ? 'orasentra' : 'friend')
      v.n += 1
      v.brierSum += s
      v.baseSum += base
      if (n !== baseName && s < base) v.beat += 1
      v.cred = credibility(v)
      v.history.push({ t: Date.now(), cred: v.cred })
      v.history = v.history.slice(-60)
    }
    const winner = Object.entries(scores).sort((a, c) => a[1] - c[1])[0][0]
    p.scored = { outcome: o, brier: scores, at: Date.now(), winner }
    out.push(p)

    const line = Object.entries(scores)
      .sort((a, c) => a[1] - c[1])
      .map(([n, s]) => `${n} ${s.toFixed(3)}`)
      .join(', ')
    const trust = trustTable(k)
      .filter(t => t.name !== 'Orasentra')
      .slice(0, 5)
      .map(t => `${t.name} ${t.cred.toFixed(2)}`)
      .join(', ')
    const result = o ? q.side : q.other
    const text = `Scorecard for "${q.title}": it resolved ${result}. ${q.resolution || ''} Brier scores, lower is better: ${line}. Closest voice: ${winner}. Orasentra now trusts: ${trust}.`
    const rec = await remember(keeperNs(k.id), 'calls', 'scorecard', text)
    k.memoryIds.push(rec.id)
    learn(k, 'calls', `After "${q.title.slice(0, 70)}" resolved ${result}, trust moved to ${trust}.`)
  }
  return out
}

// ---------------------------------------------------------------- replay: orasentraing the crowd

export async function replay(k: Keeper, cat: pm.Category) {
  const markets = (await pm.resolvedMarkets(cat, 20)).slice(0, 10)
  if (markets.length < 3) throw new HttpError(503, 'Not enough recently resolved markets in this category to replay.')
  const rows = (
    await Promise.all(
      markets.map(async m => {
        const close = m.closedTime || m.endDate
        const p = await pm.priceAt(m.tokenIds[0], close - DAY).catch(() => null)
        const o = pm.resolvedOutcome(m)
        return p === null || o === null ? null : { title: m.question, p, o, b: brier(p, o) }
      }),
    )
  ).filter((r): r is { title: string; p: number; o: 0 | 1; b: number } => Boolean(r))
  if (rows.length < 3) throw new HttpError(503, 'Price history was not available for enough markets. Try another category.')
  const avg = rows.reduce((a, r) => a + r.b, 0) / rows.length
  const right = rows.filter(r => (r.p >= 0.5 ? 1 : 0) === r.o).length
  const label = cat === 'culture' ? 'culture' : cat
  const worst = rows.slice().sort((a, b) => b.b - a.b)[0]
  const text = `Orasentra replayed ${rows.length} ${label} markets that resolved recently, reading each one's Polymarket price 24 hours before it closed. The crowd favourite won ${right} of ${rows.length}. Average Brier ${avg.toFixed(3)}. The biggest miss was "${worst.title}" at ${pct(worst.p)}. Lesson: in ${label}, the day before odds are ${avg < 0.1 ? 'hard to beat, so lean on the market' : avg < 0.18 ? 'useful but beatable' : 'noisy, so weigh other voices more'}.`
  const rec = await remember(keeperNs(k.id), 'calls', 'replay', text)
  k.memoryIds.push(rec.id)
  learn(k, 'calls', `Replay of ${rows.length} ${label} markets: crowd favourite won ${right}/${rows.length}, Brier ${avg.toFixed(3)}.`)
  return { rows, avg, right, memory: rec }
}
