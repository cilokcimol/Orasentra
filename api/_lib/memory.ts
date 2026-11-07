// Walrus Memory. Every meaningful event becomes one plain English memory in the keeper's namespace.
// The relayer stores it on Walrus mainnet; we keep a local log of job ids and blob ids so the UI can link to each one.

import { waitUntil } from '@vercel/functions'
import { MemWal, MemWalMock } from '@mysten-incubation/memwal'
import { env, memoryMode } from './env.js'
import { read, update } from './store.js'

export type Room = 'calls' | 'watch' | 'pocket' | 'ledger'

export interface MemoryRecord {
  id: string
  ns: string
  room: Room
  kind: string
  text: string
  at: number
  jobId?: string
  blobId?: string
  status: 'pending' | 'stored' | 'failed'
  mode: 'mainnet' | 'testnet' | 'mock'
  error?: string
}

export interface MemoryStats {
  total: number
  stored: number
  byRoom: Record<string, number>
  recent: MemoryRecord[]
  namespaces: string[]
}

type Client = Pick<MemWal, 'remember' | 'getRememberStatus' | 'recall' | 'health'>
let client: Client | null = null

function memwal(): Client {
  if (client) return client
  if (memoryMode() === 'mock') {
    client = MemWalMock.create({ owner: '0xmock' }) as unknown as Client
  } else {
    client = MemWal.create({
      key: env.memwalKey.replace(/^0x/, ''),
      accountId: env.memwalAccount,
      serverUrl: env.memwalServer,
      requestTimeoutMs: 20000,
      recallTimeoutMs: 20000,
    })
  }
  return client
}

const STATS = 'memory/stats.json'
const emptyStats = (): MemoryStats => ({ total: 0, stored: 0, byRoom: {}, recent: [], namespaces: [] })

const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36)

/** Writes one memory. Returns quickly with a pending record; the blob id is filled in by settle(). */
export async function remember(ns: string, room: Room, kind: string, text: string): Promise<MemoryRecord> {
  const rec: MemoryRecord = { id: rid(), ns, room, kind, text: text.slice(0, 1500), at: Date.now(), status: 'pending', mode: memoryMode() }
  try {
    const job = await memwal().remember(rec.text, ns)
    rec.jobId = job.job_id
  } catch (e) {
    rec.status = 'failed'
    rec.error = String((e as Error)?.message || e).slice(0, 200)
  }
  // The shared counter is bookkeeping: finish it after the response so the person is not kept waiting.
  later(update<MemoryStats>(STATS, emptyStats(), s => {
    s.total += rec.status === 'failed' ? 0 : 1
    s.byRoom[room] = (s.byRoom[room] || 0) + (rec.status === 'failed' ? 0 : 1)
    s.recent.unshift(rec)
    s.recent = s.recent.slice(0, 400)
    if (!s.namespaces.includes(ns)) s.namespaces.push(ns)
  }))
  return rec
}

function later(p: Promise<unknown>) {
  const safe = p.catch(e => console.error('background save failed', e))
  try {
    waitUntil(safe)
  } catch {
    void safe
  }
}

/** Polls the relayer for pending jobs and records their Walrus blob ids. */
export async function settle(limit = 12): Promise<MemoryStats> {
  const stats = await read<MemoryStats>(STATS, emptyStats())
  const pending = stats.recent.filter(r => r.status === 'pending' && r.jobId).slice(0, limit)
  if (!pending.length) return stats
  const results = await Promise.all(
    pending.map(async r => {
      try {
        const s = await memwal().getRememberStatus(r.jobId!)
        return { id: r.id, status: s.status, blob: s.blob_id, error: s.error }
      } catch (e) {
        return { id: r.id, status: 'error', error: String((e as Error)?.message || e) }
      }
    }),
  )
  return update<MemoryStats>(STATS, emptyStats(), s => {
    for (const res of results) {
      const r = s.recent.find(x => x.id === res.id)
      if (!r) continue
      if ((res.status === 'done' || res.status === 'uploaded') && res.blob) {
        if (r.status !== 'stored') s.stored += 1
        r.status = 'stored'
        r.blobId = res.blob
      } else if (res.status === 'failed' || res.status === 'not_found') {
        r.status = 'failed'
        r.error = res.error?.slice(0, 200)
        s.total = Math.max(0, s.total - 1)
      }
    }
  })
}

export async function stats(): Promise<MemoryStats> {
  return read<MemoryStats>(STATS, emptyStats(), 5000)
}

export interface Recalled {
  text: string
  blobId: string
  distance: number
  at?: string
}

export async function recall(ns: string, query: string, limit = 8, sort: 'relevance' | 'recent' = 'relevance'): Promise<Recalled[]> {
  const res = await memwal().recall({ query, namespace: ns, limit, sort })
  return res.results.map(r => ({ text: r.text, blobId: r.blob_id, distance: r.distance, at: r.created_at }))
}

export async function health() {
  try {
    const h = await memwal().health()
    return { ok: h.status === 'ok', mode: memoryMode(), version: h.version }
  } catch (e) {
    return { ok: false, mode: memoryMode(), error: String((e as Error)?.message || e).slice(0, 160) }
  }
}

export const walrusBlobUrl = (blobId: string) => `https://walruscan.com/mainnet/blob/${blobId}`
