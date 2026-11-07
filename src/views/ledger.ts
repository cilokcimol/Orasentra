import type { Ctx } from '../main'
import { esc, ago, date, keeperKey, useKey, toast, ROOM_LABEL } from '../lib'
import { mountRelic as mountCore, type RelicHandle as CoreHandle } from '../relic3d'
import { bandsFrom } from './home'

let core: CoreHandle | null = null
const ROOM_C: Record<string, string> = { calls: 'var(--calls)', watch: 'var(--watch)', pocket: 'var(--pocket)', ledger: 'var(--melt)' }
const LINE = ['#12292f', '#c9691f', '#1f7fa0', '#7a4fa0', '#2c7a5d', '#b93a33']

function trustChart(trust: any[]) {
  const voices = trust.filter(t => t.history.length > 1).slice(0, 6)
  if (!voices.length) return `<div class="empty">The chart fills in after your first calls are scored. Each line is one voice's trust over time.</div>`
  const W = 560
  const H = 200
  const t0 = Math.min(...voices.flatMap(v => v.history.map((h: any) => h.t)))
  const t1 = Math.max(...voices.flatMap(v => v.history.map((h: any) => h.t)), t0 + 1)
  const x = (t: number) => 34 + ((t - t0) / (t1 - t0)) * (W - 44)
  const y = (c: number) => 10 + (1 - c) * (H - 30)
  const lines = voices
    .map((v, i) => `<polyline fill="none" stroke="${LINE[i]}" stroke-width="2" points="${v.history.map((h: any) => `${x(h.t).toFixed(1)},${y(h.cred).toFixed(1)}`).join(' ')}"/>`)
    .join('')
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Trust over time for ${voices.map(v => esc(v.name)).join(', ')}">
    <line class="axis" x1="34" x2="${W - 10}" y1="${y(0.5)}" y2="${y(0.5)}" stroke-dasharray="3 4"/>
    <text x="0" y="${y(0.5) + 3}">0.50</text><text x="0" y="${y(0.9) + 3}">0.90</text><text x="0" y="${y(0.1) + 3}">0.10</text>
    ${lines}
  </svg><div class="legend">${voices.map((v, i) => `<span><i style="background:${LINE[i]}"></i>${esc(v.name)} ${v.cred.toFixed(2)}</span>`).join('')}</div>`
}

export function renderLedger(app: HTMLElement, ctx: Ctx) {
  const k = ctx.state?.keeper
  const mems: any[] = ctx.state?.memories || []
  const learned: any[] = k?.learned || []
  const stored = mems.filter(m => m.status === 'stored').length
  app.innerHTML = `
  <section data-view="ledger">
    <div class="room-head" style="--c: var(--melt)">
      <div><span class="tag">How it learned over time</span><h1 class="display">Archive</h1><p class="lede">Everything Orasentra has remembered for you, in order, each with a link to its sealed record on Walrus. This is the record it leans on.</p></div>
      <p class="small muted">${mems.length} memories in your namespace, ${stored} confirmed on Walrus.</p>
    </div>
    <div class="cols">
      <div>
        <div class="panel" style="margin-bottom:18px">
          <h3>Trust over time</h3>
          <p class="sub">How much Orasentra relies on each voice in the Oracle, after every scored result.</p>
          ${trustChart(k?.trust || [])}
        </div>
        <h3 style="margin-bottom:6px">What it learned</h3>
        ${learned.length ? `<ol class="timeline" style="margin-bottom:26px">${learned.map(l => `<li style="--c:${ROOM_C[l.room] || 'var(--melt)'}"><span class="when">${date(l.t)}</span><span class="dot"></span><div class="what">${esc(l.text)}<div class="meta"><span>${esc(ROOM_LABEL[l.room] || l.room)}</span></div></div></li>`).join('')}</ol>` : `<div class="empty" style="margin-bottom:26px">Lessons appear here as results come in, rules form and plans change.</div>`}
        <h3 style="margin-bottom:6px">Every memory</h3>
        ${mems.length ? `<ol class="timeline">${mems.map(m => `<li style="--c:${ROOM_C[m.room] || 'var(--melt)'}"><span class="when">${ago(m.at)}</span><span class="dot"></span><div class="what">${esc(m.text)}<div class="meta"><span>${esc(ROOM_LABEL[m.room] || m.room)} · ${esc(m.kind)}</span>${m.url ? `<a href="${esc(m.url)}" target="_blank" rel="noopener">Walrus blob <span class="mono">${esc(m.blobId.slice(0, 10))}…</span></a>` : m.status === 'failed' ? `<span class="badge watch">not stored: ${esc(m.error || 'error')}</span>` : `<span class="badge">${m.mode === 'mock' ? 'local test mode' : 'writing to Walrus'}</span>`}</div></div></li>`).join('')}</ol>` : `<div class="empty">No memories yet. Make a call, watch a wallet or add a shared expense.</div>`}
      </div>
      <aside class="side">
        <div class="mini-stage" id="lstage"><div class="tip" id="ltip" hidden></div><span class="cap">Your memories, orbiting the relic</span></div>
        <div class="keybox">
          <b>Your memory key</b>
          <p class="small" style="color:#b9d5dc">This key names your memory. Keep it private. Paste it on another device to pick up where you left off.</p>
          <code id="mykey">${esc(keeperKey())}</code>
          <div class="row"><button class="btn small" type="button" id="copykey" style="background:#fff;color:var(--ink);border-color:#fff">Copy key</button></div>
        </div>
        <form class="panel flat" id="usekey">
          <div class="field"><label for="otherkey">Open a memory from another device</label><input id="otherkey" type="text" autocomplete="off" spellcheck="false" placeholder="Paste a memory key" /></div>
          <button class="btn ghost small" type="submit" style="margin-top:10px">Use this key</button>
        </form>
      </aside>
    </div>
  </section>`
  core?.destroy()
  core = mountCore(app.querySelector("#lstage")!, { compact: true, tooltip: app.querySelector('#ltip') as HTMLElement })
  core.setShards(bandsFrom({ ...ctx, health: null } as Ctx))
  app.querySelector('#copykey')!.addEventListener('click', () => navigator.clipboard?.writeText(keeperKey()).then(() => toast('Key copied. Treat it like a password.')))
  app.querySelector('#usekey')!.addEventListener('submit', e => {
    e.preventDefault()
    const v = (app.querySelector('#otherkey') as HTMLInputElement).value
    if (!useKey(v)) return toast('That is not a valid memory key.', 'err')
    toast('Switched. Loading that memory.')
    ctx.refresh(['state']).then(() => ctx.rerender())
  })
  return () => {
    core?.destroy()
    core = null
  }
}
