import type { Ctx } from '../main'
import { api, act, esc, usd, short, ago, date, toast } from '../lib'

export function renderWatch(app: HTMLElement, ctx: Ctx) {
  const k = ctx.state?.keeper
  const w = k?.watch
  const demo = ctx.health?.demoAddress
  const tatum = ctx.health?.tatum
  const name = (who: string) => w?.labels?.[who] || short(who)
  const outs = (w?.txs || []).filter((t: any) => t.dir === 'out')
  const week = outs.filter((t: any) => t.t > Date.now() - 7 * 864e5).reduce((a: number, t: any) => a + t.usd, 0)
  const med = (() => {
    const s = outs.map((t: any) => t.usd).sort((a: number, b: number) => a - b)
    return s.length ? s[Math.floor(s.length / 2)] : 0
  })()
  const openAlerts = (w?.alerts || []).filter((a: any) => a.status === 'open')
  const closed = (w?.alerts || []).filter((a: any) => a.status !== 'open').slice(0, 6)

  app.innerHTML = `
  <section style="--c: var(--watch)">
    <div class="room-head">
      <div>
        <span class="tag">An autonomous watch over your wallet</span>
        <h1 class="display">Sentinel</h1>
        <p class="lede">A spending sentinel with a permanent memory. It reads a Sui wallet through Tatum, speaks only when something is unusual, and turns your answers into rules it keeps.</p>
      </div>
      ${w?.lastScan ? `<p class="small muted">Last checked ${ago(w.lastScan)}. It will pick up from there.</p>` : ''}
    </div>
    ${tatum === false ? `<p class="notice">Wallet reading is offline at the moment. The Oracle and Treasury remain available.</p>` : ''}
    <div class="cols">
      <div>
        <form class="panel" id="addr-form" style="margin-bottom:18px">
          <div class="field">
            <label for="addr">Sui wallet to watch</label>
            <div class="row">
              <input id="addr" type="text" inputmode="text" autocomplete="off" spellcheck="false" placeholder="0x…" value="${esc(w?.address || '')}" />
              <button class="btn watch" type="submit">${w?.address ? 'Check for new payments' : 'Start watching'}</button>
            </div>
            <span class="hint">Read only. Orasentra never asks for keys and never moves money.${demo && !w?.address ? ` <button class="chip" type="button" id="use-demo">Use the demo wallet</button>` : ''}</span>
          </div>
        </form>
        ${
          w?.address
            ? `
        <div class="stats">
          <div><b>${usd(week)}</b><span>out in the last 7 days</span></div>
          <div><b>${usd(med)}</b><span>usual payment</span></div>
          <div><b>${w.rules.length}</b><span>rules learned</span></div>
          <div><b>${w.recurring.length}</b><span>repeating payments</span></div>
        </div>
        <h3 style="margin:6px 0 10px">Needs your answer</h3>
        ${
          openAlerts.length
            ? `<div class="journal">${openAlerts
                .map(
                  (a: any) => `<div class="alert" data-a="${esc(a.id)}">
            <div><b>${esc(a.text)}</b><div class="small muted">${ago(a.t)} · <span class="mono">${esc(short(a.digest, 8))}</span></div></div>
            <div class="acts">
              <button class="btn small ghost" data-act="normal">This is normal</button>
              <button class="btn small ghost" data-act="always">Always tell me</button>
              <label class="sr" for="lim-${esc(a.id)}">Limit in dollars</label><input id="lim-${esc(a.id)}" type="number" min="1" placeholder="Limit $" />
              <button class="btn small ghost" data-act="limit">Set limit</button>
              <label class="sr" for="lab-${esc(a.id)}">Name this payee</label><input id="lab-${esc(a.id)}" type="text" placeholder="Name it" maxlength="32" style="width:130px;min-height:36px" />
            </div></div>`,
                )
                .join('')}</div>`
            : `<div class="empty">${w.lastScan ? '<b>All quiet.</b> Nothing new looks unusual. The first check sets your baseline; later checks compare against it.' : 'Run a check to set the baseline.'}</div>`
        }
        <h3 style="margin:26px 0 10px">Recent payments</h3>
        ${
          w.txs.length
            ? `<div class="scroll-x"><table class="txs"><thead><tr><th>When</th><th>To or from</th><th>Coin</th><th style="text-align:right">Value</th></tr></thead><tbody>${w.txs
                .slice(0, 25)
                .map(
                  (t: any) => `<tr><td>${date(t.t)}</td><td>${t.dir === 'out' ? 'To' : 'From'} ${esc(name(t.counterparty))}</td><td>${t.amount.toFixed(t.amount < 1 ? 4 : 2)} ${esc(t.coin)}</td><td class="amt ${t.dir === 'in' ? 'in' : ''}">${t.dir === 'in' ? '+' : ''}${usd(t.usd)}</td></tr>`,
                )
                .join('')}</tbody></table></div>`
            : `<div class="empty">No payments found yet for this wallet in the gateway's history.</div>`
        }`
            : `<div class="empty"><b>Nothing watched yet.</b> Paste a Sui address above. The first check reads its recent payments and sets what normal looks like.</div>`
        }
      </div>
      <aside class="side">
        <div class="panel">
          <h3>Rules it learned from you</h3>
          <p class="sub">Each one came from an answer you gave. They travel with your memory.</p>
          ${w?.rules?.length ? `<div class="journal">${w.rules.map((r: any) => `<div class="entry"><div class="t">${esc(r.label)}: ${r.limitUsd === 0 ? 'always tell me' : `normal up to ${usd(r.limitUsd)}`}</div><div class="s"><span>${esc(r.reason)}</span><span>${date(r.at)}</span></div></div>`).join('')}</div>` : `<div class="empty">Answer an alert and the rule shows up here.</div>`}
        </div>
        <div class="panel flat">
          <h3>Repeating payments</h3>
          <p class="sub">Found from the timing of payments. Name them and set a monthly limit in the Treasury.</p>
          ${w?.recurring?.length ? `<div class="journal">${w.recurring.map((r: any) => `<div class="entry"><div class="t">${esc(r.label)}</div><div class="s"><span>about ${usd(r.usd)} every ${r.everyDays} days</span><span>${r.count} times</span>${r.capUsd ? `<span>limit ${usd(r.capUsd)} a month</span>` : ''}</div></div>`).join('')}</div>` : `<div class="empty">None found yet. It needs at least three payments to the same place at a steady pace.</div>`}
        </div>
        <div class="panel flat">
          <h3>Ask about your spending</h3>
          <p class="sub">Try "What did I spend last Tuesday?" Orasentra answers from the payments it has seen and from memory.</p>
          <button class="btn ghost small" type="button" id="ask-tue">Ask it now</button>
        </div>
      </aside>
    </div>
  </section>`

  app.querySelector('#use-demo')?.addEventListener('click', () => {
    ;(app.querySelector('#addr') as HTMLInputElement).value = demo
  })
  app.querySelector('#addr-form')!.addEventListener('submit', async e => {
    e.preventDefault()
    const address = (app.querySelector('#addr') as HTMLInputElement).value.trim()
    const btn = (e.target as HTMLFormElement).querySelector('button[type=submit]') as HTMLButtonElement
    const res = await act(btn, () => api('watch/scan', { address }))
    if (res) {
      const r = res.result
      toast(r.firstScan ? 'Baseline set. Orasentra will compare future payments against it.' : `${r.fresh} new payments, ${r.alerts.length} to review.`)
      ctx.apply(res, 'watch')
    }
  })
  app.querySelectorAll<HTMLElement>('[data-a]').forEach(card =>
    card.querySelectorAll<HTMLButtonElement>('[data-act]').forEach(b =>
      b.addEventListener('click', async () => {
        const id = card.dataset.a!
        const action = b.dataset.act
        const limitUsd = Number((card.querySelector(`#lim-${CSS.escape(id)}`) as HTMLInputElement).value) || undefined
        const label = (card.querySelector(`#lab-${CSS.escape(id)}`) as HTMLInputElement).value.trim() || undefined
        if (action === 'limit' && !limitUsd) return toast('Type a limit in dollars first.', 'err')
        const res = await act(b, () => api('watch/answer', { id, action, limitUsd, label }))
        if (res) ctx.apply(res, 'watch')
      }),
    ),
  )
  app.querySelector('#ask-tue')?.addEventListener('click', () => {
    const dlg = document.getElementById('ask') as HTMLDialogElement
    dlg.showModal()
    ;(document.getElementById('ask-q') as HTMLInputElement).value = 'What did I spend last Tuesday?'
    ;(document.getElementById('ask-form') as HTMLFormElement).requestSubmit()
  })
  void closed
}
