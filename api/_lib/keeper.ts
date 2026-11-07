// A keeper is one person using Hindcast. No account: the browser holds a secret keeper key,
// the server only ever sees its hash. The same key on another device opens the same memory.

import { createHash } from 'node:crypto'
import { read, write } from './store.js'

export interface VoiceStats {
  kind: 'you' | 'market' | 'onchain' | 'hindcast' | 'friend'
  n: number
  brierSum: number
  baseSum: number
  beat: number
  cred: number
  history: { t: number; cred: number }[]
}

export interface Pick {
  qid: string
  title: string
  side: string
  category: string
  closesAt: number
  at: number
  probs: Record<string, number>
  weights: Record<string, number>
  disagreement: number
  scored?: { outcome: 0 | 1; brier: Record<string, number>; at: number; winner: string }
}

export interface WatchTx {
  digest: string
  t: number
  usd: number
  dir: 'out' | 'in'
  counterparty: string
  coin: string
  amount: number
}

export interface WatchRule {
  id: string
  scope: string
  label: string
  limitUsd: number
  reason: string
  at: number
}

export interface WatchAlert {
  id: string
  digest: string
  t: number
  kind: 'spike' | 'new_payee' | 'recurring' | 'over_limit'
  text: string
  usd: number
  counterparty: string
  status: 'open' | 'normal' | 'always' | 'limit'
}

export interface Keeper {
  id: string
  created: number
  seen: number
  name?: string
  currency: 'USD' | 'IDR'
  voices: Record<string, VoiceStats>
  picks: Pick[]
  watch: {
    address?: string
    lastDigest?: string
    lastScan?: number
    txs: WatchTx[]
    labels: Record<string, string>
    rules: WatchRule[]
    alerts: WatchAlert[]
    recurring: { counterparty: string; label: string; usd: number; everyDays: number; count: number; capUsd?: number }[]
  }
  pocket: {
    groups: string[]
    goals: Goal[]
  }
  learned: { t: number; room: string; text: string }[]
  memoryIds: string[]
}

export interface Goal {
  id: string
  name: string
  target: number
  saved: number
  by: number
  weekly: number
  plan: { t: number; weekly: number; why: string }[]
}

export const keeperHash = (secret: string) => createHash('sha256').update(`hindcast:${secret}`).digest('hex').slice(0, 24)
export const keeperNs = (hash: string) => `hc-${hash}`

const fresh = (id: string): Keeper => ({
  id,
  created: Date.now(),
  seen: Date.now(),
  currency: 'USD',
  voices: {},
  picks: [],
  watch: { txs: [], labels: {}, rules: [], alerts: [], recurring: [] },
  pocket: { groups: [], goals: [] },
  learned: [],
  memoryIds: [],
})

export function keeperFrom(req: Request): string {
  const secret = req.headers.get('x-hindcast-key') || ''
  if (!/^[a-f0-9]{32,64}$/.test(secret)) throw new HttpError(401, 'Missing keeper key. Reload the page to create one.')
  return keeperHash(secret)
}

export async function loadKeeper(hash: string): Promise<Keeper> {
  const k = await read<Keeper | null>(`k/${hash}.json`, null)
  const out = k ? { ...fresh(hash), ...k, watch: { ...fresh(hash).watch, ...k.watch }, pocket: { ...fresh(hash).pocket, ...k.pocket } } : fresh(hash)
  out.seen = Date.now()
  return out
}

export async function saveKeeper(k: Keeper) {
  k.picks = k.picks.slice(-300)
  k.learned = k.learned.slice(-200)
  k.watch.txs = k.watch.txs.slice(0, 300)
  k.watch.alerts = k.watch.alerts.slice(0, 120)
  k.memoryIds = k.memoryIds.slice(-500)
  return write(`k/${k.id}.json`, k)
}

export function learn(k: Keeper, room: string, text: string) {
  k.learned.push({ t: Date.now(), room, text })
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}
