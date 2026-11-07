// Watch: an expense watchdog for a Sui wallet. Reads payments through Tatum, learns what is normal
// for you from your answers, and picks up exactly where it left off next time.

import { txsFor, suiPrice, tatumReady, type SuiTx } from './tatum.js'
import { remember } from './memory.js'
import { HttpError, keeperNs, learn, type Keeper, type WatchAlert, type WatchTx } from './keeper.js'

const SUI = '0x2::sui::SUI'
const isUsdc = (t: string) => /::usdc::USDC$/i.test(t)
const short = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a)
const usd = (n: number) => `$${n.toFixed(n >= 100 ? 0 : 2)}`
const rid = () => Math.random().toString(36).slice(2, 10)

export const validAddress = (a: string) => /^0x[a-f0-9]{64}$/i.test(a)

function ownerOf(o: SuiTx['balanceChanges'] extends (infer B)[] | undefined ? B : never): string {
  const owner = (o as { owner: unknown }).owner
  if (typeof owner === 'string') return owner
  return (owner as { AddressOwner?: string })?.AddressOwner || 'object'
}

export function toWatchTx(tx: SuiTx, me: string, price: number): WatchTx | null {
  const changes = tx.balanceChanges || []
  const mine = changes.filter(c => ownerOf(c).toLowerCase() === me.toLowerCase())
  if (!mine.length) return null
  const valued = mine.map(c => {
    const raw = Number(c.amount)
    const amount = c.coinType === SUI ? raw / 1e9 : isUsdc(c.coinType) ? raw / 1e6 : raw
    const value = c.coinType === SUI ? amount * price : isUsdc(c.coinType) ? amount : 0
    return { c, amount, value }
  })
  const main = valued.sort((a, b) => Math.abs(b.value) - Math.abs(a.value))[0]
  const dir = main.amount < 0 ? 'out' : 'in'
  const others = changes
    .filter(c => ownerOf(c).toLowerCase() !== me.toLowerCase() && c.coinType === main.c.coinType)
    .filter(c => (dir === 'out' ? Number(c.amount) > 0 : Number(c.amount) < 0))
    .sort((a, b) => Math.abs(Number(b.amount)) - Math.abs(Number(a.amount)))
  const counterparty = others[0] ? ownerOf(others[0]) : 'contract'
  const coin = main.c.coinType === SUI ? 'SUI' : isUsdc(main.c.coinType) ? 'USDC' : main.c.coinType.split('::').pop() || 'coin'
  return { digest: tx.digest, t: Number(tx.timestampMs), usd: Math.abs(main.value), dir, counterparty, coin, amount: Math.abs(main.amount) }
}

const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = xs.slice().sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

function limitFor(k: Keeper, who: string): number | null {
  const r = k.watch.rules.find(x => x.scope === who) || k.watch.rules.find(x => x.scope === '*')
  return r ? r.limitUsd : null
}

function detectRecurring(k: Keeper) {
  const outs = k.watch.txs.filter(t => t.dir === 'out' && t.usd >= 0.5 && t.counterparty !== 'contract')
  const by = new Map<string, WatchTx[]>()
  for (const t of outs) by.set(t.counterparty, [...(by.get(t.counterparty) || []), t])
  const found: Keeper['watch']['recurring'] = []
  for (const [who, list] of by) {
    if (list.length < 3) continue
    const ts = list.map(t => t.t).sort((a, b) => a - b)
    const gaps = ts.slice(1).map((t, i) => (t - ts[i]) / 86400000)
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
    const sd = Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length)
    if (mean < 0.5 || sd / mean > 0.4) continue
    const prev = k.watch.recurring.find(r => r.counterparty === who)
    found.push({ counterparty: who, label: k.watch.labels[who] || short(who), usd: median(list.map(t => t.usd)), everyDays: Math.round(mean * 10) / 10, count: list.length, capUsd: prev?.capUsd })
  }
  return found
}

export async function scan(k: Keeper, address?: string) {
  if (!tatumReady()) throw new HttpError(503, 'Wallet reading needs the Tatum key on the server. It is not set yet.')
  if (address) {
    if (!validAddress(address)) throw new HttpError(400, 'That does not look like a Sui address. It should start with 0x and have 64 more characters.')
    if (address.toLowerCase() !== k.watch.address?.toLowerCase()) {
      k.watch = { ...k.watch, address: address.toLowerCase(), txs: [], alerts: [], lastDigest: undefined, lastScan: undefined, recurring: [] }
    }
  }
  const me = k.watch.address
  if (!me) throw new HttpError(400, 'Add a Sui address to watch first.')
  const { usd: price } = await suiPrice()
  const [outs, ins] = await Promise.all([txsFor(me, 'FromAddress', 40), txsFor(me, 'ToAddress', 25)])
  const seen = new Set(k.watch.txs.map(t => t.digest))
  const all = [...outs.data, ...ins.data]
    .map(tx => toWatchTx(tx, me, price))
    .filter((t): t is WatchTx => Boolean(t))
    .filter((t, i, arr) => arr.findIndex(x => x.digest === t.digest) === i)
  const fresh = all.filter(t => !seen.has(t.digest)).sort((a, b) => a.t - b.t)
  const firstScan = !k.watch.lastScan
  const prevScan = k.watch.lastScan
  const history = k.watch.txs.filter(t => t.dir === 'out').map(t => t.usd)

  const alerts: WatchAlert[] = []
  if (!firstScan) {
    for (const t of fresh.filter(x => x.dir === 'out')) {
      const lim = limitFor(k, t.counterparty)
      const known = k.watch.txs.some(x => x.counterparty === t.counterparty)
      const name = k.watch.labels[t.counterparty] || short(t.counterparty)
      let a: WatchAlert | null = null
      if (lim !== null && t.usd > lim) a = { id: rid(), digest: t.digest, t: t.t, kind: 'over_limit', usd: t.usd, counterparty: t.counterparty, status: 'open', text: `${usd(t.usd)} to ${name} is over the ${usd(lim)} you set for it.` }
      else if (lim === null && t.usd >= 5 && history.length >= 3 && t.usd > 3 * median(history)) a = { id: rid(), digest: t.digest, t: t.t, kind: 'spike', usd: t.usd, counterparty: t.counterparty, status: 'open', text: `${usd(t.usd)} to ${name} is more than three times your usual payment of ${usd(median(history))}.` }
      else if (lim === null && !known && t.usd >= 5) a = { id: rid(), digest: t.digest, t: t.t, kind: 'new_payee', usd: t.usd, counterparty: t.counterparty, status: 'open', text: `First payment to ${name}: ${usd(t.usd)}. Is this someone you pay often?` }
      if (a) alerts.push(a)
    }
  }
  k.watch.txs = [...fresh.reverse(), ...k.watch.txs].sort((a, b) => b.t - a.t).slice(0, 300)
  k.watch.alerts = [...alerts, ...k.watch.alerts]
  const before = new Set(k.watch.recurring.map(r => r.counterparty))
  k.watch.recurring = detectRecurring(k)
  const newRecurring = k.watch.recurring.filter(r => !before.has(r.counterparty))
  k.watch.lastScan = Date.now()
  k.watch.lastDigest = k.watch.txs[0]?.digest

  const outsAll = k.watch.txs.filter(t => t.dir === 'out')
  const spent7 = outsAll.filter(t => t.t > Date.now() - 7 * 86400000).reduce((a, t) => a + t.usd, 0)
  let text: string
  if (firstScan) {
    text = `Started watching Sui wallet ${short(me)} through Tatum. Baseline: ${outsAll.length} outgoing and ${k.watch.txs.length - outsAll.length} incoming payments on record, median outgoing ${usd(median(outsAll.map(t => t.usd)))}, ${usd(spent7)} out in the last 7 days. SUI was ${usd(price)}.`
  } else {
    const since = new Date(prevScan!).toUTCString().slice(0, 22)
    text = `Picked up where I left off (${since} UTC). ${fresh.length} new payments since then, ${alerts.length} worth asking about. ${usd(spent7)} out in the last 7 days.`
  }
  if (newRecurring.length) text += ` Found repeating payments: ${newRecurring.map(r => `${r.label} about ${usd(r.usd)} every ${r.everyDays} days`).join('; ')}.`
  if (firstScan || fresh.length || newRecurring.length) {
    const rec = await remember(keeperNs(k.id), 'watch', 'scan', text)
    k.memoryIds.push(rec.id)
  }
  for (const a of alerts.slice(0, 3)) {
    const rec = await remember(keeperNs(k.id), 'watch', 'alert', `Flagged a payment: ${a.text} Transaction ${a.digest}.`)
    k.memoryIds.push(rec.id)
  }
  if (newRecurring.length) learn(k, 'watch', `Spotted ${newRecurring.length} repeating payment${newRecurring.length > 1 ? 's' : ''}.`)
  return { fresh: fresh.length, alerts, firstScan, price }
}

export async function answerAlert(k: Keeper, id: string, action: 'normal' | 'always' | 'limit', limitUsd?: number, label?: string) {
  const a = k.watch.alerts.find(x => x.id === id)
  if (!a) throw new HttpError(404, 'That alert is gone.')
  const who = a.counterparty
  if (label) k.watch.labels[who] = label.replace(/[^\p{L}\p{N} .&'_]/gu, '').slice(0, 32)
  const name = k.watch.labels[who] || short(who)
  k.watch.rules = k.watch.rules.filter(r => r.scope !== who)
  let rule
  if (action === 'normal') rule = { id: rid(), scope: who, label: name, limitUsd: Math.ceil(a.usd * 1.25 * 100) / 100, reason: 'You said a payment like this is normal.', at: Date.now() }
  else if (action === 'always') rule = { id: rid(), scope: who, label: name, limitUsd: 0, reason: 'You asked to hear about every payment here.', at: Date.now() }
  else {
    if (!(limitUsd && limitUsd > 0)) throw new HttpError(400, 'Set a limit above zero.')
    rule = { id: rid(), scope: who, label: name, limitUsd, reason: 'You set this limit yourself.', at: Date.now() }
  }
  k.watch.rules.push(rule)
  a.status = action
  for (const other of k.watch.alerts) if (other.status === 'open' && other.counterparty === who && action === 'normal' && other.usd <= rule.limitUsd) other.status = 'normal'
  const text =
    action === 'always'
      ? `Escalation rule learned: always tell the keeper about payments to ${name} (${who}). Reason: they asked after a ${usd(a.usd)} payment.`
      : `Escalation rule learned: payments to ${name} (${who}) up to ${usd(rule.limitUsd)} are normal; only ask above that. Reason: ${rule.reason} Triggered by a ${usd(a.usd)} payment.`
  const rec = await remember(keeperNs(k.id), 'watch', 'rule', text)
  k.memoryIds.push(rec.id)
  learn(k, 'watch', action === 'always' ? `Always tell you about ${name}.` : `${name} is normal up to ${usd(rule.limitUsd)}.`)
  return { rule, memory: rec }
}

/** Plain answers about past spending, computed from the payments Watch has seen. */
export function spendingOn(k: Keeper, from: number, to: number) {
  const list = k.watch.txs.filter(t => t.dir === 'out' && t.t >= from && t.t < to)
  return { total: list.reduce((a, t) => a + t.usd, 0), list }
}

export const watchShort = short
