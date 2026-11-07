import type { Ctx } from '../main'
import { esc, usd, pct, ago, until } from '../lib'
import { mountRelic, type RelicHandle, type Shard } from '../relic3d'

let relic: RelicHandle | null = null
let io: IntersectionObserver | null = null

export function shardsFrom(ctx: Ctx): Shard[] {
  const mine = (ctx.state?.memories || []).map((m: any) => ({ room: m.room, kind: m.kind, at: m.at, text: m.text, url: m.url, status: m.status }))
  const pub = (ctx.health?.stats?.latest || []).map((m: any) => ({ room: m.room, kind: m.kind, at: m.at, url: m.url, status: 'stored' }))
  const seen = new Set(mine.map((m: Shard) => m.url).filter(Boolean))
  return [...mine, ...pub.filter((p: Shard) => !seen.has(p.url))].sort((a, b) => b.at - a.at)
}

function panels(ctx: Ctx) {
  const sui = ctx.board?.sui?.usd
  const st = ctx.health?.stats
  const latest = (ctx.state?.memories || [])[0] || st?.latest?.[0]
  const q = (ctx.board?.questions || []).filter((x: any) => x.source === 'polymarket' && x.outcome === null).sort((a: any, b: any) => a.closesAt - b.closesAt)[0]
  return `
    <div class="gcard"><div class="row2"><span class="k">SUI on Cetus, read through Tatum</span><span class="badge ok">live</span></div><div class="v">${sui ? usd(sui) : '…'}</div></div>
    ${q ? `<div class="gcard"><span class="k">Oracle, next to close</span><p style="color:var(--ink);font-weight:650;margin:4px 0 6px">${esc(q.title.length > 70 ? q.title.slice(0, 68) + '…' : q.title)}</p><div class="row2"><span class="k">${esc(q.side)}, market ${pct(q.marketP)}</span><span class="k">${esc(until(q.closesAt))}</span></div></div>` : ''}
    <div class="gcard"><div class="row2"><span class="k">Memories sealed on Walrus</span><span class="k">${latest ? esc(ago(latest.at)) : ''}</span></div><div class="v">${st?.total ?? '…'}</div></div>`
}

export function renderHome(app: HTMLElement, ctx: Ctx) {
  const existing = app.querySelector('[data-view="home"]')
  if (existing && relic) {
    const p = app.querySelector('.hero-panels')
    if (p) p.innerHTML = panels(ctx)
    relic.setShards(shardsFrom(ctx))
    return
  }
  const q = (ctx.board?.questions || []).find((x: any) => x.source === 'polymarket' && x.outcome === null)
  app.innerHTML = `
  <div data-view="home">
    <section class="hero" id="hero">
      <div class="tip" id="relic-tip" hidden></div>
      <div class="hero-in">
        <span class="eyebrow"><span class="live" aria-hidden="true"></span>Every memory is sealed on Walrus mainnet</span>
        <h1 class="display">The memory that <span class="glow-text">sees ahead.</span></h1>
        <p class="lede">Orasentra is a personal intelligence with a permanent memory. It forecasts beside you, keeps watch over your wallet, and keeps shared money straight. Every outcome teaches it whom to trust, what is normal for you, and what you can really afford.</p>
        <div class="cta">
          <a class="btn" href="#/oracle">Open the Oracle</a>
          <a class="btn ghost" href="#how">How it learns</a>
        </div>
      </div>
      <div class="hero-panels" aria-live="polite">${panels(ctx)}</div>
      <div class="scroll-cue" aria-hidden="true">Scroll<i></i></div>
    </section>

    <div class="wrap">
      <div class="strip" aria-label="Built on"><span>Built on</span><b>Walrus Memory</b><b>Sui</b><b>Tatum RPC</b><b>Polymarket</b><b>Cetus</b></div>

      <section class="section" id="rooms">
        <div class="section-head reveal">
          <span class="kicker">Three instruments, one memory</span>
          <h2>Everything it learns in one place makes it sharper in the others.</h2>
        </div>
        <div class="relics">
          <a class="relic-row reveal" href="#/oracle" style="--c: var(--calls)">
            <div class="relic-copy">
              <span class="relic-track">Forecasting for markets, sport and elections</span>
              <div class="relic-name">Oracle</div>
              <p class="lede">Lock your call before the event. Orasentra sets it beside the live market and the chain, flags when sources disagree, and scores every voice once the result is in.</p>
              <ul><li>Live questions from Polymarket and onchain SUI price markets</li><li>Brier scoring for you, the market and anyone you follow</li><li>Credibility moves only when a voice beats the baseline</li></ul>
            </div>
            <div class="mock" aria-hidden="true">
              <div class="bar-top"><i></i><i></i><i></i><span>Oracle</span></div>
              <div class="m-row"><span>${esc(q ? (q.title.length > 54 ? q.title.slice(0, 52) + '…' : q.title) : 'Will SUI close above $0.86 on Friday?')}</span><b>${q ? pct(q.marketP) : '48%'}</b></div>
              <div class="m-row"><span>You</span><b>62%</b></div>
              <div class="m-row"><span>Rina</span><b>70%</b></div>
              <div class="m-note">Sources disagree by 22 points. Orasentra blends 58%, leaning on the voices that have proven right.</div>
            </div>
          </a>
          <a class="relic-row reveal" href="#/sentinel" style="--c: var(--watch)">
            <div class="relic-copy">
              <span class="relic-track">An autonomous watch over your wallet</span>
              <div class="relic-name">Sentinel</div>
              <p class="lede">Point it at a Sui wallet. It reads every payment through Tatum, learns what normal looks like, and only speaks when something is not.</p>
              <ul><li>Flags spikes, first time payees and limits you set</li><li>Turns your answers into escalation rules it keeps</li><li>Resumes exactly where it stopped, on any device</li></ul>
            </div>
            <div class="mock" aria-hidden="true">
              <div class="bar-top"><i></i><i></i><i></i><span>Sentinel</span></div>
              <div class="m-row"><span>Out in the last 7 days</span><b>$184.20</b></div>
              <div class="m-note">$96.00 to 0x7a3f…c21e is three times your usual payment. Is this expected?</div>
              <div class="m-row"><span>Rule kept: Streaming normal up to $13.75</span><b style="color:var(--pocket)">learned</b></div>
            </div>
          </a>
          <a class="relic-row reveal" href="#/treasury" style="--c: var(--pocket)">
            <div class="relic-copy">
              <span class="relic-track">Everyday money that simply makes sense</span>
              <div class="relic-name">Treasury</div>
              <p class="lede">Shared spending typed the way you talk, savings that change pace with your real cash flow, and subscription limits it learns from you. No wallet and no jargon.</p>
              <ul><li>Group balances with the fewest payments to settle</li><li>Goals that re plan from the last 30 days of cash flow</li><li>Monthly caps it remembers for every subscription</li></ul>
            </div>
            <div class="mock" aria-hidden="true">
              <div class="bar-top"><i></i><i></i><i></i><span>Treasury</span></div>
              <div class="m-row"><span>Villa 1.2jt paid by Rina</span><b>IDR 1,200,000</b></div>
              <div class="m-row"><span>Budi pays Rina</span><b>IDR 400,000</b></div>
              <div><div class="m-row"><span>Flight home, $120 of $250</span><b>$18 a week</b></div><div class="meterline"><i style="width:48%"></i></div></div>
            </div>
          </a>
        </div>
      </section>

      <section class="section" id="how">
        <div class="section-head reveal">
          <span class="kicker">How it learns</span>
          <h2>A loop that turns hindsight into judgement.</h2>
        </div>
        <ol class="loop reveal">
          <li><b>Record</b><p>A call, a payment or an expense arrives with the moment it happened.</p></li>
          <li><b>Verify</b><p>Live sources answer back: market odds, the Cetus pool, your wallet on Sui.</p></li>
          <li><b>Score</b><p>When the outcome lands, every voice is scored against the baseline.</p></li>
          <li><b>Seal</b><p>The lesson is written in plain words to Walrus Memory under your own key.</p></li>
          <li><b>Lean</b><p>The next forecast, rule or plan is weighted by what proved right.</p></li>
        </ol>
      </section>

      <section class="section">
        <div class="proof reveal">
          <div><h3>Permanent memory</h3><p>Each lesson is stored on Walrus mainnet and recalled by meaning. Every entry links to its blob, so the record can be checked by anyone.</p></div>
          <div><h3>Live chain data</h3><p>Wallet history, balances and the SUI price come straight from Sui mainnet through the Tatum gateway. Nothing is estimated.</p></div>
          <div><h3>Private by default</h3><p>No sign up. Your browser holds a private memory key; the server only sees its hash. Carry the key to continue on any device.</p></div>
        </div>
      </section>

      <section class="closing reveal">
        <h2>Begin with one call.</h2>
        <p class="lede">Make a forecast, watch a wallet or open a shared treasury. Orasentra remembers from the first moment.</p>
        <div class="cta"><a class="btn" href="#/oracle">Open the Oracle</a><a class="btn ghost" href="#/treasury">Open a treasury</a></div>
      </section>
    </div>
  </div>`
  relic?.destroy()
  relic = mountRelic(app.querySelector('#hero')!, { tooltip: app.querySelector('#relic-tip') as HTMLElement })
  relic.setShards(shardsFrom(ctx))
  io?.disconnect()
  io = new IntersectionObserver(entries => entries.forEach(e => e.isIntersecting && e.target.classList.add('in')), { threshold: 0.12 })
  app.querySelectorAll('.reveal').forEach(el => io!.observe(el))
  app.querySelector('a[href="#how"]')?.addEventListener('click', e => {
    e.preventDefault()
    document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })
  })
  return () => {
    relic?.destroy()
    relic = null
    io?.disconnect()
  }
}

export { shardsFrom as bandsFrom }
