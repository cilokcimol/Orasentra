import type { Ctx } from '../main'
import { api, act, esc, pct, until, date, spark, usd } from '../lib'

let filter = 'all'
let open: string | null = null
let draft: { you: number; friends: Record<string, number> } = { you: 0.5, friends: {} }

const CATS = [
  ['all', 'All'],
  ['sports', 'Sports'],
  ['politics', 'Elections'],
  ['culture', 'Culture'],
  ['crypto', 'Crypto'],
  ['onchain', 'SUI onchain'],
]

const COLOR: Record<string, string> = { You: '#12292f', Market: '#6f8a91', Onchain: '#1f7fa0', Mnemora: '#c9691f' }
const colorOf = (n: string) => COLOR[n] || '#7a4fa0'

function blendPreview(ctx: Ctx, q: any) {
  const trust: any[] = ctx.state?.keeper?.trust || []
  const cred = (n: string) => trust.find(t => t.name === n)?.cred ?? 0.5
  const probs: Record<string, number> = { You: draft.you, ...draft.friends }
  if (q.source === 'onchain') probs.Onchain = onchainP(ctx, q)
  else probs.Market = q.marketP
  const w = Object.fromEntries(Object.keys(probs).map(n => [n, Math.max(0.0025, cred(n) ** 2)]))
  const sum = Object.values(w).reduce((a, b) => a + b, 0)
  const blend = Object.entries(probs).reduce((a, [n, p]) => a + (w[n] / sum) * p, 0)
  const vals = Object.values(probs)
  return { probs, blend, spread: Math.max(...vals) - Math.min(...vals), w: Object.fromEntries(Object.entries(w).map(([n, x]) => [n, x / sum])) }
}

function phi(x: number) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x))
  const d = 0.3989423 * Math.exp((-x * x) / 2)
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return x > 0 ? 1 - p : p
}

function onchainP(ctx: Ctx, q: any) {
  const sui = ctx.board?.sui
  if (!sui || !q.line) return 0.5
  const hours = Math.max(0, (q.closesAt - Date.now()) / 3600000)
  const sigma = Math.max(1e-6, sui.vol * Math.sqrt(hours / 24))
  return Math.min(0.99, Math.max(0.01, phi(Math.log(sui.usd / q.line) / sigma)))
}

function drawer(ctx: Ctx, q: any) {
  const b = blendPreview(ctx, q)
  const rows = Object.entries({ ...b.probs, Mnemora: b.blend })
    .map(
      ([n, p]) => `<div class="voice-row"><span>${esc(n)}${n === 'Mnemora' ? '' : ` <span class="muted small">w ${(b.w[n] ?? 0).toFixed(2)}</span>`}</span><div class="bar" style="--c:${colorOf(n)}"><i style="width:${(p * 100).toFixed(1)}%"></i></div><b class="num">${pct(p)}</b></div>`,
    )
    .join('')
  return `
  <div class="drawer" id="drawer">
    <div class="slider">
      <label for="you">Your chance that <span>${esc(q.side)}</span> happens <b id="you-v">${pct(draft.you)}</b></label>
      <input type="range" id="you" min="1" max="99" value="${Math.round(draft.you * 100)}" />
    </div>
    <div>
      <p class="small muted" style="margin-bottom:6px">Add the call of someone you follow: a friend, an analyst, a tipster. Mnemora will score them too.</p>
      <div class="friend-add">
        <label class="sr" for="fname">Name</label><input id="fname" type="text" placeholder="Name" maxlength="24" />
        <label class="sr" for="fp">Their chance in percent</label><input id="fp" type="number" min="1" max="99" placeholder="%" />
        <button class="btn ghost small" type="button" id="fadd">Add voice</button>
      </div>
    </div>
    <div class="voices" aria-live="polite">${rows}</div>
    ${b.spread >= 0.2 ? `<p class="flag">Sources disagree by ${Math.round(b.spread * 100)} points. Mnemora will remember who was right.</p>` : ''}
    <div class="row">
      <button class="btn calls" type="button" id="lock">Lock my call</button>
      <span class="small muted">Locked calls cannot be edited. It is written to Walrus with the time, before the result.</span>
    </div>
  </div>`
}

function qcard(ctx: Ctx, q: any, picked: any) {
  const p = q.source === 'onchain' ? onchainP(ctx, q) : q.marketP
  const done = q.outcome !== null
  const exp = open === q.id
  const label = q.source === 'onchain' ? 'Onchain model' : 'Market'
  return `
  <div>
    <button class="q ${done ? 'done' : ''}" type="button" data-q="${esc(q.id)}" aria-expanded="${exp}" ${done || picked ? 'data-locked="1"' : ''}>
      ${q.image ? `<img src="${esc(q.image)}" alt="" loading="lazy" />` : `<span class="ph">${q.source === 'onchain' ? 'SUI' : '?'}</span>`}
      <span>
        <span class="t">${esc(q.title)}</span>
        <span class="meta">
          <span>${esc(q.side)} vs ${esc(q.other)}</span>
          <span>${done ? `Resolved ${esc(q.outcome ? q.side : q.other)}` : esc(until(q.closesAt))}</span>
          ${picked ? `<span class="badge calls">Your call ${pct(picked.probs.You)}</span>` : ''}
          ${q.url ? `<span>Polymarket</span>` : `<span>Cetus via Tatum</span>`}
        </span>
      </span>
      <span class="odds"><b>${p !== undefined ? pct(p) : '…'}</b><span>${label}</span></span>
    </button>
    ${exp && !done && !picked ? drawer(ctx, q) : ''}
  </div>`
}

export function renderCalls(app: HTMLElement, ctx: Ctx) {
  const k = ctx.state?.keeper
  const qs: any[] = ctx.board?.questions || []
  const picks: any[] = k?.picks || []
  const pickOf = (id: string) => picks.find(p => p.qid === id)
  const openQs = qs.filter(q => q.outcome === null && q.closesAt > Date.now())
  const list = (filter === 'all' ? openQs : openQs.filter(q => q.category === filter)).sort((a, b) => a.closesAt - b.closesAt)
  const trust: any[] = (k?.trust || []).filter((t: any) => t.name !== 'Mnemora')
  const hc = (k?.trust || []).find((t: any) => t.name === 'Mnemora')
  const sui = ctx.board?.sui

  app.innerHTML = `
  <section style="--c: var(--calls)">
    <div class="room-head">
      <div>
        <span class="tag">Markets and sports prediction</span>
        <h1 class="display">Calls</h1>
        <p class="lede">Make your call before the event. After it, every voice gets scored, and Mnemora learns whom to trust.</p>
      </div>
      ${sui ? `<p class="small muted">SUI ${usd(sui.usd)} on Cetus, read through Tatum. Daily volatility ${(sui.vol * 100).toFixed(1)}%.</p>` : ''}
    </div>
    <div class="cols">
      <div>
        <div class="chips" role="group" aria-label="Category">${CATS.map(([v, l]) => `<button class="chip" type="button" data-cat="${v}" aria-pressed="${filter === v}">${l}</button>`).join('')}</div>
        ${!ctx.board ? '<p class="loading">Loading the board…</p>' : list.length ? `<div class="qlist">${list.map(q => qcard(ctx, q, pickOf(q.id))).join('')}</div>` : `<div class="empty"><b>Nothing open here right now.</b> Try another category, or replay past markets on the right to see how the crowd did.</div>`}
      </div>
      <aside class="side">
        <div class="panel">
          <h3>Who to trust</h3>
          <p class="sub">0.50 is level with the baseline. A voice moves only after scored calls, and only by beating the market or the onchain model.</p>
          ${trust.length ? `<div class="trust">${trust.map(t => `<div class="trust-row"><div class="who"><b>${esc(t.name)}</b><span>${t.n} scored${t.n ? `, beat baseline ${t.beat}` : ''}</span></div>${spark(t.history.map((h: any) => h.cred))}<span class="score">${t.cred.toFixed(2)}</span></div>`).join('')}</div>` : `<div class="empty">No voices yet. Lock your first call and you, the market and anyone you add start at 0.50.</div>`}
          ${hc?.n ? `<p class="small muted" style="margin-top:10px">Mnemora's own blend: ${hc.n} scored, average Brier ${hc.avgBrier.toFixed(3)}.</p>` : ''}
        </div>
        <div class="panel flat">
          <h3>Replay the crowd</h3>
          <p class="sub">Hindcasting: Mnemora reads ten markets that already resolved, takes each price 24 hours before the close, and writes down how good the crowd really was.</p>
          <div class="chips" style="margin:0">${CATS.slice(1, 5).map(([v, l]) => `<button class="chip" type="button" data-replay="${v}">${l}</button>`).join('')}</div>
          <div id="replay-out"></div>
        </div>
        <div class="panel">
          <h3>Your journal</h3>
          ${picks.length ? `<div class="journal">${picks.slice(0, 12).map(p => `<div class="entry"><div class="t">${esc(p.title)}</div><div class="s"><span>You ${pct(p.probs.You)}</span>${p.probs.Market !== undefined ? `<span>Market ${pct(p.probs.Market)}</span>` : ''}${p.probs.Onchain !== undefined ? `<span>Onchain ${pct(p.probs.Onchain)}</span>` : ''}<span>Mnemora ${pct(p.probs.Mnemora)}</span>${p.scored ? `<span class="badge ${p.scored.winner === 'You' ? 'ok' : 'calls'}">Resolved ${esc(p.scored.outcome ? p.side : 'not ' + p.side)}, closest ${esc(p.scored.winner)}</span>` : `<span>Closes ${date(p.closesAt)}</span>`}</div></div>`).join('')}</div>` : `<div class="empty">Locked calls and their scorecards will appear here.</div>`}
        </div>
      </aside>
    </div>
  </section>`

  app.querySelectorAll<HTMLButtonElement>('[data-cat]').forEach(b =>
    b.addEventListener('click', () => {
      filter = b.dataset.cat!
      open = null
      renderCalls(app, ctx)
    }),
  )
  app.querySelectorAll<HTMLButtonElement>('[data-q]').forEach(b =>
    b.addEventListener('click', () => {
      if (b.dataset.locked) {
        const q = qs.find(x => x.id === b.dataset.q)
        if (q?.url) window.open(q.url, '_blank', 'noopener')
        return
      }
      open = open === b.dataset.q ? null : b.dataset.q!
      draft = { you: 0.5, friends: {} }
      renderCalls(app, ctx)
      document.getElementById('you')?.focus()
    }),
  )
  const q = qs.find(x => x.id === open)
  const you = document.getElementById('you') as HTMLInputElement | null
  if (q && you) {
    const update = () => {
      const d = document.getElementById('drawer')!
      const keep = document.activeElement?.id
      d.outerHTML = drawer(ctx, q)
      wire()
      if (keep) document.getElementById(keep)?.focus()
    }
    const wire = () => {
      const y = document.getElementById('you') as HTMLInputElement
      y.addEventListener('input', () => {
        draft.you = Number(y.value) / 100
        document.getElementById('you-v')!.textContent = pct(draft.you)
      })
      y.addEventListener('change', update)
      document.getElementById('fadd')!.addEventListener('click', () => {
        const n = (document.getElementById('fname') as HTMLInputElement).value.trim()
        const p = Number((document.getElementById('fp') as HTMLInputElement).value)
        if (!n || !(p >= 1 && p <= 99) || ['You', 'Market', 'Onchain', 'Mnemora'].includes(n)) return
        draft.friends[n.slice(0, 24)] = p / 100
        update()
      })
      document.getElementById('lock')!.addEventListener('click', async e => {
        const res = await act(e.currentTarget as HTMLButtonElement, () => api('calls/pick', { qid: q.id, you: draft.you, friends: draft.friends }))
        if (res) {
          open = null
          ctx.apply(res, 'calls')
        }
      })
    }
    wire()
  }
  app.querySelectorAll<HTMLButtonElement>('[data-replay]').forEach(b =>
    b.addEventListener('click', async () => {
      const res = await act(b, () => api('calls/replay', { category: b.dataset.replay }))
      if (!res) return
      const r = res.result
      ctx.apply(res, 'calls')
      const outEl = app.querySelector('#replay-out')
      if (outEl)
        outEl.innerHTML = `<div class="journal" style="margin-top:12px"><p class="small">Crowd favourite won <b>${r.right} of ${r.rows.length}</b>. Average Brier <b>${r.avg.toFixed(3)}</b>.</p>${r.rows
          .slice(0, 6)
          .map((x: any) => `<div class="entry"><div class="t">${esc(x.title)}</div><div class="s"><span>Day before ${pct(x.p)}</span><span>${x.o ? 'Happened' : 'Did not happen'}</span><span>Brier ${x.b.toFixed(3)}</span></div></div>`)
          .join('')}</div>`
    }),
  )
}
