// One request router for every endpoint, so it runs the same in one Vercel function and in local dev.

import { HttpError, keeperFrom, loadKeeper, saveKeeper, keeperNs, type Keeper } from './keeper.js'
import * as calls from './calls.js'
import * as watch from './watch.js'
import * as pocket from './pocket.js'
import { ask } from './ask.js'
import { settle as settleMemories, stats as memoryStats, health as memoryHealth, walrusBlobUrl, type MemoryRecord } from './memory.js'
import { tatumReady, tatumMethods } from './tatum.js'
import { read } from './store.js'
import { env, memoryMode } from './env.js'

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

const hits = new Map<string, number[]>()
function limit(key: string, max = 40, windowMs = 10 * 60000) {
  const now = Date.now()
  const list = (hits.get(key) || []).filter(t => now - t < windowMs)
  if (list.length >= max) throw new HttpError(429, 'Too many changes in a short time. Wait a few minutes.')
  list.push(now)
  hits.set(key, list)
}

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v))

function myMemories(k: Keeper, recent: MemoryRecord[]) {
  const mine = new Set([keeperNs(k.id), ...k.pocket.groups.map(pocket.groupNs)])
  return recent.filter(r => mine.has(r.ns)).slice(0, 80).map(r => ({ ...r, url: r.blobId && r.mode !== 'mock' ? walrusBlobUrl(r.blobId) : undefined }))
}

function publicStats(s: Awaited<ReturnType<typeof memoryStats>>) {
  return {
    total: s.total,
    stored: s.stored,
    byRoom: s.byRoom,
    keepers: s.namespaces.filter(n => !n.startsWith('os-g-')).length,
    pots: s.namespaces.filter(n => n.startsWith('os-g-')).length,
    latest: s.recent
      .filter(r => r.status === 'stored' && r.blobId && r.mode !== 'mock')
      .slice(0, 12)
      .map(r => ({ room: r.room, kind: r.kind, at: r.at, blobId: r.blobId, url: walrusBlobUrl(r.blobId!) })),
  }
}

function view(k: Keeper) {
  return {
    id: k.id.slice(0, 6),
    created: k.created,
    name: k.name,
    trust: calls.trustTable(k),
    picks: k.picks.slice().reverse(),
    watch: { ...k.watch, txs: k.watch.txs.slice(0, 60), cashflow: pocket.cashflow(k) },
    pocket: k.pocket,
    learned: k.learned.slice().reverse(),
  }
}

export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '')
  const body = req.method === 'POST' ? ((await req.json().catch(() => ({}))) as Record<string, unknown>) : {}
  try {
    if (path === 'health') {
      const [mem, s, t] = await Promise.all([memoryHealth(), memoryStats(), read('tatum/stats.json', { total: 0 })])
      return json({ memory: mem, memoryMode: memoryMode(), tatum: tatumReady(), tatumCalls: t, tatumMethods: tatumMethods(), llm: Boolean(env.geminiKey), demoAddress: env.demoAddress || null, demoKey: /^[a-f0-9]{32,64}$/.test(env.demoKey) ? env.demoKey : null, stats: publicStats(s) })
    }
    if (path === 'diag/tatum') {
      const tatum = await import('./tatum.js')
      const out: Record<string, string> = {}
      const run = async (n: string, f: () => Promise<unknown>) => {
        try {
          out[n] = `ok ${JSON.stringify(await f()).slice(0, 160)}`
        } catch (e) {
          out[n] = String((e as Error).message).slice(0, 160)
        }
      }
      await run('checkpoint', () => tatum.checkpoint())
      await run('price', () => tatum.suiPrice())
      if (env.demoAddress) await run('txs', async () => (await tatum.recentTxs(env.demoAddress, 5)).map(t => [t.digest.slice(0, 8), t.balanceChanges?.length]))
      return json(out)
    }
    if (path === 'board') {
      const b = await calls.board()
      const price = await calls.samplePrice()
      return json({ ...b, sui: price ? { usd: price.usd, vol: price.vol, series: price.series.slice(-288) } : null })
    }
    if (path === 'pocket/group' && req.method === 'GET') {
      const g = await pocket.loadGroup(url.searchParams.get('id') || '')
      return json({ group: g, balances: pocket.balances(g), plan: (await import('./score.js')).settleUp(pocket.balances(g)) })
    }

    const id = keeperFrom(req)
    const k = await loadKeeper(id)
    if (req.method === 'POST') limit(id)
    let out: unknown

    switch (path) {
      case 'state': {
        await calls.board().catch(() => null)
        const scored = await calls.scorePicks(k)
        const s = await settleMemories().catch(() => memoryStats())
        await saveKeeper(k)
        return json({ keeper: view(k), scored, memories: myMemories(k, s.recent), stats: publicStats(s) })
      }
      case 'keeper/name':
        k.name = String(body.name || '').replace(/[^\p{L}\p{N} .'_]/gu, '').slice(0, 24) || undefined
        out = { ok: true }
        break
      case 'calls/pick': {
        const friends = Object.fromEntries(Object.entries((body.friends as Record<string, unknown>) || {}).map(([n, p]) => [n, num(p)]))
        out = await calls.logPick(k, String(body.qid), num(body.you), friends)
        break
      }
      case 'calls/replay':
        out = await calls.replay(k, String(body.category) as 'sports')
        break
      case 'watch/scan':
        out = await watch.scan(k, body.address ? String(body.address) : undefined)
        break
      case 'watch/answer':
        out = await watch.answerAlert(k, String(body.id), body.action as 'normal', body.limitUsd ? num(body.limitUsd) : undefined, body.label ? String(body.label) : undefined)
        break
      case 'watch/label':
        k.watch.labels[String(body.who)] = String(body.label || '').replace(/[^\p{L}\p{N} .&'_]/gu, '').slice(0, 32)
        out = { ok: true }
        break
      case 'pocket/group':
        out = await pocket.createGroup(k, String(body.name || ''), String(body.currency || 'IDR'), (body.members as string[]) || [])
        break
      case 'pocket/join': {
        const g = await pocket.loadGroup(String(body.id))
        if (!k.pocket.groups.includes(g.id)) k.pocket.groups.push(g.id)
        out = { group: g }
        break
      }
      case 'pocket/expense':
        out = await pocket.addExpense(k, String(body.id), String(body.text || ''))
        break
      case 'pocket/settle':
        out = await pocket.settle(k, String(body.id), String(body.from), String(body.to), num(body.amount))
        break
      case 'pocket/goal':
        out = await pocket.upsertGoal(k, { id: body.id as string, name: body.name as string, target: num(body.target), by: num(body.by), add: body.add ? num(body.add) : undefined })
        break
      case 'pocket/cap':
        out = await pocket.capSubscription(k, String(body.who), num(body.capUsd))
        break
      case 'ask':
        out = await ask(k, String(body.q || ''))
        break
      default:
        throw new HttpError(404, 'Unknown endpoint.')
    }
    await saveKeeper(k)
    return json({ ok: true, result: out, keeper: view(k) })
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status)
    console.error(e)
    return json({ error: 'Something went wrong on the server. Try again in a moment.', detail: String((e as Error)?.message || e).slice(0, 200) }, 500)
  }
}
