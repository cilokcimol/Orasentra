import type { Ctx } from '../main'
import { esc, usd } from '../lib'
import { mountCore, type CoreHandle, type CoreBand } from '../core3d'

let core: CoreHandle | null = null

export function bandsFrom(ctx: Ctx): CoreBand[] {
  const mine = (ctx.state?.memories || []).map((m: any) => ({ room: m.room, kind: m.kind, at: m.at, text: m.text, url: m.url, status: m.status }))
  const pub = (ctx.health?.stats?.latest || []).map((m: any) => ({ room: m.room, kind: m.kind, at: m.at, url: m.url, status: 'stored' }))
  const seen = new Set(mine.map((m: CoreBand) => m.url).filter(Boolean))
  return [...mine, ...pub.filter((p: CoreBand) => !seen.has(p.url))].sort((a, b) => b.at - a.at)
}

function readouts(ctx: Ctx) {
  const total = ctx.health?.stats?.total ?? ctx.state?.stats?.total
  const mode = ctx.health?.memoryMode
  const tatum = ctx.health?.tatumCalls?.total
  const sui = ctx.board?.sui?.usd
  return `
    <div class="readout"><b>${total ?? '…'}</b><span>${mode === 'mainnet' ? 'memories written to Walrus mainnet' : mode ? `memories (${esc(mode)} mode, mainnet key not set)` : 'memories on Walrus'}</span></div>
    <div class="readout"><b>${tatum ?? '…'}</b><span>Sui reads through the Tatum gateway</span></div>
    <div class="readout"><b>${sui ? usd(sui).replace('$', '$') : '…'}</b><span>SUI, read from the Cetus pool on mainnet</span></div>`
}

export function renderHome(app: HTMLElement, ctx: Ctx) {
  const existing = app.querySelector('[data-view="home"]')
  if (existing && core) {
    app.querySelector('.readouts')!.innerHTML = readouts(ctx)
    core.setBands(bandsFrom(ctx))
    return
  }
  app.innerHTML = `
  <div data-view="home">
    <section class="hero">
      <div class="hero-copy">
        <h1 class="display">Hindsight,<span class="line2">kept.</span></h1>
        <p class="lede">Mnemora is one agent with one long memory. It remembers every call you make before a game or a vote, every payment that leaves your wallet, and every debt in your group. Then it learns who to trust, what is normal for you, and how much you can really save.</p>
        <div class="cta">
          <a class="btn calls" href="#/calls">Make a call</a>
          <a class="btn ghost" href="#/judge">Check the proof</a>
        </div>
        <div class="readouts" aria-live="polite">${readouts(ctx)}</div>
      </div>
      <div class="stage" id="stage">
        <p class="stage-title">The memory core. Every band is a memory on Walrus, newest at the top. Drag to turn it.</p>
        <div class="tip" id="core-tip" hidden></div>
        <div class="stage-legend"><span><i style="background:#e0893a"></i>Calls</span><span><i style="background:#c8483f"></i>Watch</span><span><i style="background:#3f8f70"></i>Pocket</span><span><i style="background:#dfeaec"></i>Older ice</span></div>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2>One memory, three rooms</h2>
        <p class="lede">Each room is useful on its own. Together they share what Mnemora has learned about you.</p>
      </div>
      <div class="rooms">
        <a class="room-row" href="#/calls" style="--c: var(--calls)">
          <div><div class="room-name">Calls</div><p class="track">Markets and sports prediction</p></div>
          <p>Log your pick before a match, an election or a market move. Mnemora puts it beside the Polymarket odds and the live SUI price, flags when sources disagree, then scores every voice after the result. Trust is earned only by beating the baseline.</p>
          <blockquote>Scorecard for "Will SUI trade above $0.86": it resolved Above. Brier scores, lower is better: Rina 0.090, You 0.144, Onchain 0.250. Mnemora now trusts: Rina 0.61, You 0.55.<cite>Example of a scorecard memory</cite></blockquote>
        </a>
        <a class="room-row" href="#/watch" style="--c: var(--watch)">
          <div><div class="room-name">Watch</div><p class="track">Smart agent for real life</p></div>
          <p>Point it at a Sui wallet. It reads payments through Tatum, finds subscriptions and spikes, and asks you only when something is odd. Your answers become rules. Next time, it picks up exactly where it left off, on any device.</p>
          <blockquote>Escalation rule learned: payments to Netflix up to $13.75 are normal; only ask above that.<cite>Example of a rule memory</cite></blockquote>
        </a>
        <a class="room-row" href="#/pocket" style="--c: var(--pocket)">
          <div><div class="room-name">Pocket</div><p class="track">Consumer finance</p></div>
          <p>Shared pots that remember who owes who, typed the way you talk. Savings goals that change pace with your real cash flow. Subscription limits it learns from you. No wallet, no gas, no crypto words.</p>
          <blockquote>Rina paid IDR 1,200,000 for Villa, split between Vika, Rina, Budi. Pot "Bali trip" now: Vika owes Rina IDR 400,000.<cite>Example of a pot memory</cite></blockquote>
        </a>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>How it learns</h2></div>
      <ol class="loop">
        <li><b>Log</b><p>A pick, a payment or an expense comes in with the time it happened.</p></li>
        <li><b>Check</b><p>Live sources answer back: Polymarket odds, the Cetus pool, your wallet through Tatum.</p></li>
        <li><b>Score</b><p>When the outcome arrives, every voice gets a Brier score against the baseline.</p></li>
        <li><b>Remember</b><p>The result is written in plain words to Walrus Memory, under your own namespace.</p></li>
        <li><b>Lean</b><p>The next blend, rule or plan is weighted by what proved right before.</p></li>
      </ol>
    </section>

    <section class="section">
      <div class="proof">
        <div><h3>Walrus Memory</h3><p>Every event is stored as a memory on Walrus mainnet through the Walrus Memory relayer. Recall finds them again by meaning, from this app or any tool holding the key.</p></div>
        <div><h3>Tatum on Sui</h3><p>Wallet history, balances and the SUI price come from Sui mainnet through the Tatum RPC gateway. Every read is counted on the judge page.</p></div>
        <div><h3>Your key, your memory</h3><p>No sign up. Your browser holds a private key that names your memory. Copy it from the Ledger to open the same memory on another device.</p></div>
      </div>
    </section>
  </div>`
  core?.destroy()
  core = mountCore(app.querySelector('#stage')!, { tooltip: app.querySelector('#core-tip') as HTMLElement })
  core.setBands(bandsFrom(ctx))
  return () => {
    core?.destroy()
    core = null
  }
}
