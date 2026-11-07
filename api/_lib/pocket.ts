// Pocket: everyday money that feels normal. Shared pots that remember who owes what,
// savings goals that adapt to real cash flow, and subscription limits learned from you.

import { randomBytes } from 'node:crypto'
import { read, write } from './store.js'
import { remember } from './memory.js'
import { settleUp } from './score.js'
import { HttpError, keeperNs, learn, type Goal, type Keeper } from './keeper.js'

export interface Expense {
  id: string
  desc: string
  amount: number
  payer: string
  split: string[]
  at: number
}

export interface Group {
  id: string
  name: string
  currency: string
  members: string[]
  expenses: Expense[]
  settlements: { from: string; to: string; amount: number; at: number }[]
  norms: string[]
  created: number
}

const rid = () => randomBytes(5).toString('hex')
export const groupNs = (id: string) => `os-g-${id}`
const clean = (s: string, n = 28) => s.replace(/[^\p{L}\p{N} .,&'()_]/gu, '').trim().slice(0, n)

export async function loadGroup(id: string): Promise<Group> {
  if (!/^[a-f0-9]{10}$/.test(id)) throw new HttpError(400, 'That treasury link is not valid.')
  const g = await read<Group | null>(`g/${id}.json`, null)
  if (!g) throw new HttpError(404, 'That treasury does not exist.')
  return g
}

export async function createGroup(k: Keeper, name: string, currency: string, members: string[]) {
  const ms = [...new Set(members.map(m => clean(m, 20)).filter(Boolean))].slice(0, 12)
  if (ms.length < 2) throw new HttpError(400, 'A shared treasury needs at least two people.')
  const g: Group = { id: rid(), name: clean(name) || 'Shared pot', currency: clean(currency, 4).toUpperCase() || 'IDR', members: ms, expenses: [], settlements: [], norms: [], created: Date.now() }
  await write(`g/${g.id}.json`, g)
  if (!k.pocket.groups.includes(g.id)) k.pocket.groups.push(g.id)
  const rec = await remember(groupNs(g.id), 'pocket', 'pot', `Shared treasury "${g.name}" opened with ${ms.join(', ')}. Amounts are in ${g.currency}.`)
  k.memoryIds.push(rec.id)
  return g
}

const MULT: Record<string, number> = { k: 1e3, rb: 1e3, ribu: 1e3, m: 1e6, jt: 1e6, juta: 1e6, mn: 1e6 }

/** "Dinner 240k paid by Rina split Rina, Budi, Vika" -> structured expense. */
export function parseExpense(text: string, members: string[]): Omit<Expense, 'id' | 'at'> {
  const t = text.trim()
  const m = t.match(/(?:rp\.?\s*|\$|usd\s*|idr\s*)?(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(k|rb|ribu|m|jt|juta|mn)?\b/i)
  if (!m) throw new HttpError(400, 'I could not find an amount. Try "Dinner 240k paid by Rina".')
  let num = m[1]
  if (/^\d{1,3}([.,]\d{3})+$/.test(num)) num = num.replace(/[.,]/g, '')
  else num = num.replace(',', '.')
  const amount = Number(num) * (m[2] ? MULT[m[2].toLowerCase()] : 1)
  if (!(amount > 0)) throw new HttpError(400, 'The amount must be above zero.')
  const find = (s: string) => members.find(x => x.toLowerCase() === s.trim().toLowerCase())
  const payerM = t.match(/(?:paid by|dibayar|bayar(?:in)? oleh|by)\s+([\p{L}\p{N}]+)/iu) || t.match(/^([\p{L}\p{N}]+)\s+(?:paid|bayar)/iu)
  const payer = payerM ? find(payerM[1]) : undefined
  if (!payer) throw new HttpError(400, `Who paid? Add "paid by" and one of: ${members.join(', ')}.`)
  let split = members.slice()
  const splitM = t.match(/(?:split|for|bagi|untuk|between|among|with)\s+(.+)$/iu)
  if (splitM && !/\b(all|everyone|semua)\b/i.test(splitM[1])) {
    const names = splitM[1].split(/,|\band\b|\bdan\b|&/i).map(find).filter((x): x is string => Boolean(x))
    if (names.length) split = [...new Set(names)]
  }
  const desc = clean(t.replace(m[0], '').replace(payerM?.[0] || '', '').replace(splitM?.[0] || '', '').replace(/\s+/g, ' '), 40) || 'Expense'
  return { desc, amount: Math.round(amount * 100) / 100, payer, split }
}

export function balances(g: Group) {
  const b: Record<string, number> = Object.fromEntries(g.members.map(m => [m, 0]))
  for (const e of g.expenses) {
    b[e.payer] += e.amount
    for (const s of e.split) b[s] -= e.amount / e.split.length
  }
  for (const s of g.settlements) {
    b[s.from] += s.amount
    b[s.to] -= s.amount
  }
  for (const k of Object.keys(b)) b[k] = Math.round(b[k] * 100) / 100
  return b
}

const money = (n: number, c: string) => `${c} ${Math.round(n).toLocaleString('en-US')}`

export async function addExpense(k: Keeper, id: string, text: string) {
  const g = await loadGroup(id)
  const e: Expense = { id: rid(), at: Date.now(), ...parseExpense(text, g.members) }
  g.expenses.push(e)
  const bal = balances(g)
  const plan = settleUp(bal)
  const word = e.desc.toLowerCase().split(' ')[0]
  const sameKind = g.expenses.filter(x => x.desc.toLowerCase().startsWith(word)).slice(-4)
  let norm = ''
  if (sameKind.length >= 3 && sameKind.filter(x => x.payer === e.payer).length >= 3) {
    norm = `${e.payer} usually pays for ${word}.`
    if (!g.norms.includes(norm)) g.norms.push(norm)
    else norm = ''
  }
  await write(`g/${g.id}.json`, g)
  const owes = plan.map(p => `${p.from} owes ${p.to} ${money(p.amount, g.currency)}`).join('; ') || 'everyone is square'
  const rec = await remember(groupNs(g.id), 'pocket', 'expense', `${e.payer} paid ${money(e.amount, g.currency)} for ${e.desc}, split between ${e.split.join(', ')}. Treasury "${g.name}" now: ${owes}.${norm ? ' Pattern noticed: ' + norm : ''}`)
  k.memoryIds.push(rec.id)
  if (norm) learn(k, 'pocket', norm)
  return { group: g, expense: e, balances: bal, plan, memory: rec }
}

export async function settle(k: Keeper, id: string, from: string, to: string, amount: number) {
  const g = await loadGroup(id)
  if (!g.members.includes(from) || !g.members.includes(to) || !(amount > 0)) throw new HttpError(400, 'Pick two people and an amount.')
  g.settlements.push({ from, to, amount, at: Date.now() })
  await write(`g/${g.id}.json`, g)
  const plan = settleUp(balances(g))
  const rec = await remember(groupNs(g.id), 'pocket', 'settle', `${from} paid back ${to} ${money(amount, g.currency)} in treasury "${g.name}". Still open: ${plan.map(p => `${p.from} owes ${p.to} ${money(p.amount, g.currency)}`).join('; ') || 'nothing, everyone is square'}.`)
  k.memoryIds.push(rec.id)
  return { group: g, balances: balances(g), plan, memory: rec }
}

// ---------------------------------------------------------------- savings goals

/** Monthly net flow seen by Watch, in USD. Null when there is not enough history. */
export function cashflow(k: Keeper) {
  const since = Date.now() - 30 * 86400000
  const recent = k.watch.txs.filter(t => t.t >= since)
  if (recent.length < 3) return null
  const inflow = recent.filter(t => t.dir === 'in').reduce((a, t) => a + t.usd, 0)
  const outflow = recent.filter(t => t.dir === 'out').reduce((a, t) => a + t.usd, 0)
  return { inflow, outflow, net: inflow - outflow }
}

function plan(goal: Goal, k: Keeper) {
  const weeks = Math.max(1, (goal.by - Date.now()) / (7 * 86400000))
  const need = Math.max(0, goal.target - goal.saved) / weeks
  const flow = cashflow(k)
  if (!flow) return { weekly: need, why: `${weeks.toFixed(1)} weeks left, so ${need.toFixed(2)} a week covers it.` }
  const room = Math.max(0, (flow.net / 4.3) * 0.6)
  if (room >= need) return { weekly: need, why: `Your wallet kept about $${(flow.net / 4.3).toFixed(2)} a week over the last 30 days, so ${need.toFixed(2)} a week fits.` }
  return {
    weekly: Math.max(room, need * 0.5),
    why: `${flow.net > 0 ? `The last 30 days left only about $${(flow.net / 4.3).toFixed(2)} a week` : `The watched wallet spent more than it received over the last 30 days`}. Planning ${Math.max(room, need * 0.5).toFixed(2)} a week instead of ${need.toFixed(2)}; the date may slip unless spending drops.`,
  }
}

export async function upsertGoal(k: Keeper, input: { id?: string; name?: string; target?: number; by?: number; add?: number }) {
  let g = input.id ? k.pocket.goals.find(x => x.id === input.id) : undefined
  if (!g) {
    if (!input.name || !(input.target! > 0) || !(input.by! > Date.now())) throw new HttpError(400, 'A goal needs a name, an amount, and a future date.')
    g = { id: rid(), name: clean(input.name), target: input.target!, saved: 0, by: input.by!, weekly: 0, plan: [] }
    k.pocket.goals.push(g)
  }
  if (input.add) g.saved = Math.max(0, g.saved + input.add)
  const p = plan(g, k)
  const changed = !g.plan.length || Math.abs(p.weekly - g.weekly) > 0.01 * Math.max(1, g.weekly)
  g.weekly = Math.round(p.weekly * 100) / 100
  if (changed) {
    g.plan.push({ t: Date.now(), weekly: g.weekly, why: p.why })
    const rec = await remember(keeperNs(k.id), 'pocket', 'goal', `Savings goal "${g.name}": ${g.saved.toFixed(2)} of ${g.target} saved, due ${new Date(g.by).toISOString().slice(0, 10)}. New weekly plan ${g.weekly.toFixed(2)}. ${p.why}`)
    k.memoryIds.push(rec.id)
    learn(k, 'pocket', `Goal "${g.name}" plan is now ${g.weekly.toFixed(2)} a week.`)
  }
  return g
}

export async function capSubscription(k: Keeper, who: string, capUsd: number) {
  const r = k.watch.recurring.find(x => x.counterparty === who)
  if (!r) throw new HttpError(404, 'That repeating payment is not on record.')
  r.capUsd = capUsd
  const monthly = (r.usd * 30) / r.everyDays
  const over = monthly > capUsd
  const rec = await remember(keeperNs(k.id), 'pocket', 'subscription', `Subscription limit learned: ${r.label} costs about $${monthly.toFixed(2)} a month and the keeper wants it under $${capUsd.toFixed(2)}. ${over ? 'It is currently over the limit, so flag the next charge.' : 'It is within the limit.'}`)
  k.memoryIds.push(rec.id)
  learn(k, 'pocket', `${r.label} should stay under $${capUsd.toFixed(2)} a month.`)
  return { recurring: r, monthly, over, memory: rec }
}
