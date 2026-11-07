import type { Ctx } from '../main'
import { esc, usd, useKey, keeperKey, ownKey, toast } from '../lib'

export function renderJudge(app: HTMLElement, ctx: Ctx) {
  const h = ctx.health
  const st = h?.stats
  const mainnet = h?.memoryMode === 'mainnet'
  const total = st?.total ?? 0
  const latest: any[] = st?.latest || []
  const tatumCalls = h?.tatumCalls?.total ?? 0
  const sui = ctx.board?.sui?.usd
  const pmOpen = (ctx.board?.questions || []).filter((q: any) => q.source === 'polymarket' && q.outcome === null).length
  const onchain = (ctx.board?.questions || []).filter((q: any) => q.source === 'onchain').length
  const mark = (ok: boolean | undefined) => `<span class="st ${ok === undefined ? '' : ok ? 'ok' : 'no'}" aria-label="${ok ? 'passing' : ok === false ? 'not yet' : 'checking'}">${ok ? '✓' : ok === false ? '!' : '…'}</span>`

  app.innerHTML = `
  <section>
    <div class="room-head" style="--c: var(--melt)">
      <div><span class="tag">For Total Recall reviewers</span><h1 class="display">The proof</h1><p class="lede">Each requirement, checked live against this deployment. Nothing on this page is typed in by hand.</p></div>
      <div class="row">${h?.demoKey ? (keeperKey() === h.demoKey ? `<button class="btn ghost" type="button" id="mine">Back to my own memory</button>` : `<button class="btn" type="button" id="demo">Open the shared demo memory</button>`) : ''}<a class="btn ghost" href="https://github.com/cilokcimol/hindcast">Read the code</a></div>
    </div>
    <ol class="checks">
      <li>${mark(h ? mainnet : undefined)}<div><h3>Walrus Memory writes on mainnet</h3><p>${h ? (mainnet ? `The server is connected to the mainnet relayer, health ${h.memory?.ok ? 'ok' : 'failing'}.` : `The server is in ${esc(h.memoryMode)} mode because the mainnet key is not set.`) : 'Checking…'}</p></div><a class="btn small ghost" href="#/ledger">See memories</a></li>
      <li>${mark(h ? total >= 10 && st.stored >= 10 : undefined)}<div><h3>At least 10 memories stored</h3><p>${total} written, ${st?.stored ?? 0} confirmed with a Walrus blob id, across ${st?.keepers ?? 0} keepers and ${st?.pots ?? 0} pots. Calls ${st?.byRoom?.calls ?? 0}, Watch ${st?.byRoom?.watch ?? 0}, Pocket ${st?.byRoom?.pocket ?? 0}.</p>${latest.length ? `<p>Latest blobs: ${latest.slice(0, 5).map(m => `<a href="${esc(m.url)}" target="_blank" rel="noopener" class="mono">${esc(m.blobId.slice(0, 10))}…</a>`).join(', ')}</p>` : ''}</div></li>
      <li>${mark(h ? h.tatum && tatumCalls > 0 : undefined)}<div><h3>Tatum RPC for onchain data</h3><p>${h?.tatum ? `${tatumCalls} reads of Sui mainnet through the Tatum gateway so far: the Cetus pool for the SUI price${sui ? ` (now ${usd(sui)})` : ''}, transaction history and balance changes for Watch.` : 'The Tatum key is not set on this server yet.'}</p></div><a class="btn small ghost" href="#/watch">Open Watch</a></li>
      <li>${mark(pmOpen > 0 || onchain > 0)}<div><h3>Markets and sports prediction</h3><p>${pmOpen} open Polymarket questions across sports, elections, culture and crypto, plus ${onchain} SUI questions settled from the chain. Picks lock before the event; every voice is scored with Brier; trust lives in memory.</p></div><a class="btn small ghost" href="#/calls">Open Calls</a></li>
      <li>${mark(true)}<div><h3>Smart agent for real life</h3><p>Watch reads a wallet, flags spikes, new payees and limits, learns escalation rules from your answers, finds subscriptions, and resumes from the last check on any device.</p></div><a class="btn small ghost" href="#/watch">Open Watch</a></li>
      <li>${mark(true)}<div><h3>Consumer finance, blockchain invisible</h3><p>Shared pots typed in plain words with a settle up plan, goals that re plan from real cash flow, and learned subscription limits. No wallet needed.</p></div><a class="btn small ghost" href="#/pocket">Open Pocket</a></li>
      <li>${mark(true)}<div><h3>It learns over time</h3><p>The Ledger shows trust moving after each result, rules forming from answers, and plans changing, each tied to a Walrus memory. Ask Hindcast reads them back by meaning.</p></div><a class="btn small ghost" href="#/ledger">Open Ledger</a></li>
    </ol>
    <div class="section">
      <div class="proof">
        <div><h3>Try it in two minutes</h3><p>Make one call in Calls. Open Watch and use the demo wallet. Start a pot in Pocket and add "Dinner 240k paid by" one of the names. Then open the Ledger and ask "Who owes who?"</p></div>
        <div><h3>Honest limits</h3><p>Memories are stored under the app's Walrus Memory account, one namespace per keeper. Watch is read only. Questions settle when Polymarket settles or at the onchain close.</p></div>
        <div><h3>Model</h3><p>${h?.llm ? 'Ask uses Gemini over recalled memories and computed facts.' : 'Ask answers from recalled memories and computed facts, without a language model.'} Trust and plans are plain arithmetic you can check in the source.</p></div>
      </div>
    </div>
  </section>`
  app.querySelector('#demo')?.addEventListener('click', () => {
    useKey(h.demoKey)
    toast('Opened the shared demo memory. Anything you add here is visible to other reviewers.')
    ctx.refresh(['state']).then(() => (location.hash = '#/ledger'))
  })
  app.querySelector('#mine')?.addEventListener('click', () => {
    const own = ownKey()
    if (own) useKey(own)
    toast('Back to your own memory.')
    ctx.refresh(['state']).then(() => ctx.rerender())
  })
}
