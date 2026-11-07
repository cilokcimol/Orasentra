import type { Ctx } from '../main'
import { esc, usd, useKey, keeperKey, ownKey, toast, ago } from '../lib'

export function renderJudge(app: HTMLElement, ctx: Ctx) {
  const h = ctx.health
  const st = h?.stats
  const mainnet = h?.memoryMode === 'mainnet'
  const latest: any[] = st?.latest || []
  const tatumCalls = h?.tatumCalls?.total ?? 0
  const sui = ctx.board?.sui?.usd
  const qs: any[] = ctx.board?.questions || []
  const pmOpen = qs.filter(q => q.source === 'polymarket' && q.outcome === null).length
  const onchain = qs.filter(q => q.source === 'onchain' && q.outcome === null).length
  const resolved = qs.filter(q => q.outcome !== null).length
  const mark = (ok: boolean | undefined) => `<span class="st ${ok === undefined ? '' : ok ? 'ok' : 'no'}" aria-label="${ok ? 'operational' : ok === false ? 'degraded' : 'checking'}">${ok ? '✓' : ok === false ? '!' : '…'}</span>`
  const sample = h?.demoKey

  app.innerHTML = `
  <section>
    <div class="room-head" style="--c: var(--melt)">
      <div><span class="tag">Live system status</span><h1 class="display">Status</h1><p class="lede">Every service Orasentra depends on, checked live from this deployment, with the records that prove it.</p></div>
      <div class="row">${sample ? (keeperKey() === sample ? `<button class="btn ghost" type="button" id="mine">Return to my archive</button>` : `<button class="btn" type="button" id="demo">Explore a sample archive</button>`) : ''}<a class="btn ghost" href="https://github.com/cilokcimol/orasentra">Source code</a></div>
    </div>
    <ol class="checks">
      <li>${mark(h ? mainnet && h.memory?.ok : undefined)}<div><h3>Memory network</h3><p>${h ? (mainnet ? `Connected to the Walrus Memory relayer on mainnet. Relayer health ${h.memory?.ok ? 'is good' : 'is failing'}.` : 'The memory network is not configured on this deployment yet.') : 'Checking…'}</p></div><a class="btn small ghost" href="#/archive">Open Archive</a></li>
      <li>${mark(h ? (st?.stored ?? 0) > 0 : undefined)}<div><h3>Sealed memories</h3><p>${st?.total ?? 0} memories written, ${st?.stored ?? 0} confirmed with a Walrus blob id, across ${st?.keepers ?? 0} archives and ${st?.pots ?? 0} shared treasuries. Oracle ${st?.byRoom?.calls ?? 0}, Sentinel ${st?.byRoom?.watch ?? 0}, Treasury ${st?.byRoom?.pocket ?? 0}.</p>${latest.length ? `<p>Latest: ${latest.slice(0, 5).map(m => `<a href="${esc(m.url)}" target="_blank" rel="noopener" class="mono">${esc(m.blobId.slice(0, 10))}…</a> ${esc(ago(m.at))}`).join(', ')}</p>` : ''}</div></li>
      <li>${mark(h ? h.tatum && tatumCalls > 0 : undefined)}<div><h3>Sui chain gateway</h3><p>${h?.tatum ? `${tatumCalls} reads of Sui mainnet through the Tatum RPC gateway: the Cetus USDC pool for the SUI price${sui ? ` (now ${usd(sui)})` : ''}, and transaction history with balance changes for the Sentinel.` : 'The chain gateway is not configured on this deployment yet.'}</p></div><a class="btn small ghost" href="#/sentinel">Open Sentinel</a></li>
      <li>${mark(ctx.board ? pmOpen > 0 : undefined)}<div><h3>Market data</h3><p>${pmOpen} open Polymarket questions across sport, elections, culture and crypto, ${onchain} SUI questions settled from the chain, ${resolved} resolved and scored recently.</p></div><a class="btn small ghost" href="#/oracle">Open Oracle</a></li>
      <li>${mark(h ? true : undefined)}<div><h3>Reasoning</h3><p>${h?.llm ? 'Ask Orasentra drafts answers with Gemini, grounded only in recalled memories and computed figures.' : 'Ask Orasentra answers from recalled memories and computed figures.'} Trust scores, rules and savings plans are plain arithmetic, published in the source.</p></div></li>
    </ol>
    <div class="section">
      <div class="proof">
        <div><h3>What is stored</h3><p>Plain language records of calls, scorecards, wallet baselines, rules, shared expenses and plans. One namespace per archive and per shared treasury.</p></div>
        <div><h3>What is never stored</h3><p>Private keys, seed phrases or passwords. The Sentinel is read only and Orasentra never moves funds.</p></div>
        <div><h3>How questions settle</h3><p>Market questions settle when Polymarket settles. SUI questions settle at the first chain read after their close, and the delay is recorded with the result.</p></div>
      </div>
    </div>
  </section>`
  app.querySelector('#demo')?.addEventListener('click', () => {
    useKey(sample)
    toast('Opened the sample archive. Anything you add here is visible to other visitors.')
    ctx.refresh(['state']).then(() => (location.hash = '#/archive'))
  })
  app.querySelector('#mine')?.addEventListener('click', () => {
    const own = ownKey()
    if (own) useKey(own)
    toast('Back to your own archive.')
    ctx.refresh(['state']).then(() => ctx.rerender())
  })
}
