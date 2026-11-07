// Exercises every room against a deployment so the shared demo memory has real history.
// Usage: BASE=https://your-app.vercel.app KEY=<demo keeper key> ADDRESS=<sui address> npx tsx scripts/seed.ts
const BASE = (process.env.BASE || 'http://localhost:8787').replace(/\/$/, '')
const KEY = process.env.KEY || ''
const ADDRESS = process.env.ADDRESS || ''
if (!/^[a-f0-9]{32,64}$/.test(KEY)) throw new Error('Set KEY to a 32 to 64 character hex keeper key')

async function call(path: string, body?: unknown) {
  const res = await fetch(`${BASE}/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'x-mnemora-key': KEY },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  const mem = data?.result?.memory
  console.log(res.status, path, data.error || (mem ? `${mem.status}: ${mem.text.slice(0, 90)}` : 'ok'))
  return data
}

const board = await call('board')
for (const cat of ['sports', 'politics', 'culture', 'crypto']) await call('calls/replay', { category: cat })
const open = (board.questions || []).filter((q: any) => q.outcome === null && q.closesAt > Date.now() + 3600000)
const pickOne = (pred: (q: any) => boolean) => open.find(pred)
const picks = [
  pickOne((q: any) => q.category === 'sports'),
  pickOne((q: any) => q.category === 'politics' || q.category === 'culture'),
  pickOne((q: any) => q.source === 'onchain'),
].filter(Boolean)
for (const [i, q] of picks.entries()) {
  const base = q.marketP ?? 0.5
  await call('calls/pick', { qid: q.id, you: Math.min(0.95, Math.max(0.05, base + (i % 2 ? -0.12 : 0.1))), friends: { Rina: Math.min(0.95, Math.max(0.05, base + 0.2)), 'Pundit Bob': Math.min(0.95, Math.max(0.05, base - 0.18)) } })
}
if (ADDRESS) await call('watch/scan', { address: ADDRESS })
const pot = await call('pocket/group', { name: 'Bali trip', currency: 'IDR', members: ['Vika', 'Rina', 'Budi'] })
const id = pot?.result?.id
if (id) {
  await call('pocket/expense', { id, text: 'Villa 1.2jt paid by Rina' })
  await call('pocket/expense', { id, text: 'Seafood dinner 450k paid by Budi split Budi, Vika' })
  await call('pocket/expense', { id, text: 'Scooter rental 300k paid by Vika' })
  await call('pocket/settle', { id, from: 'Vika', to: 'Rina', amount: 100000 })
}
await call('pocket/goal', { name: 'Flight home', target: 250, by: Date.now() + 45 * 86400000 })
const state = await call('state')
console.log('memories in demo namespace:', state.memories?.length, 'global total:', state.stats?.total)
