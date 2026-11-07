import type { Ctx } from '../main'
import { api, act, esc, money, usd, date, toast } from '../lib'

const pots = new Map<string, any>()

async function loadPot(id: string) {
  const r = await api(`pocket/group?id=${encodeURIComponent(id)}`)
  pots.set(id, r)
  return r
}

function potView(ctx: Ctx, data: any) {
  const g = data.group
  const bal: Record<string, number> = data.balances
  const max = Math.max(1, ...Object.values(bal).map(v => Math.abs(v)))
  const link = `${location.origin}${location.pathname}#/treasury/${g.id}`
  return `
  <div class="cols">
    <div>
      <form class="panel" id="exp-form" style="margin-bottom:18px">
        <div class="field">
          <label for="exp">Add what was spent, the way you would say it</label>
          <div class="row">
            <input id="exp" type="text" autocomplete="off" maxlength="200" placeholder="Dinner 240k paid by ${esc(g.members[0])} split ${esc(g.members.slice(0, 2).join(', '))}" />
            <button class="btn pocket" type="submit">Add</button>
          </div>
          <span class="hint">Leave out "split" to share with everyone. Works with 240k, 1.2jt, Rp 150.000 or 12.50.</span>
        </div>
      </form>
      <h3 style="margin-bottom:10px">Who is up, who is down</h3>
      <div class="balances">${g.members
        .map((m: string) => {
          const v = bal[m] || 0
          const w = (Math.abs(v) / max) * 50
          return `<div class="bal"><b>${esc(m)}</b><div class="track2"><i style="${v >= 0 ? `left:50%;width:${w}%;background:var(--pocket)` : `right:50%;width:${w}%;background:var(--watch)`}"></i></div><span class="v">${v >= 0 ? '+' : '−'}${money(Math.abs(v), g.currency)}</span></div>`
        })
        .join('')}</div>
      <h3 style="margin:24px 0 10px">Fewest payments to settle</h3>
      ${
        data.plan.length
          ? `<div class="journal">${data.plan
              .map(
                (p: any) => `<div class="settle"><span><b>${esc(p.from)}</b> pays <b>${esc(p.to)}</b> ${money(p.amount, g.currency)}</span><button class="btn small ghost" data-settle='${esc(JSON.stringify(p))}'>Mark paid</button></div>`,
              )
              .join('')}</div>`
          : `<div class="empty"><b>Everyone is square.</b></div>`
      }
      <h3 style="margin:24px 0 10px">History</h3>
      ${
        g.expenses.length
          ? `<div class="scroll-x"><table class="txs"><thead><tr><th>When</th><th>What</th><th>Paid by</th><th>Split</th><th style="text-align:right">Amount</th></tr></thead><tbody>${g.expenses
              .slice()
              .reverse()
              .map((e: any) => `<tr><td>${date(e.at)}</td><td>${esc(e.desc)}</td><td>${esc(e.payer)}</td><td>${esc(e.split.join(', '))}</td><td class="amt">${money(e.amount, g.currency)}</td></tr>`)
              .join('')}</tbody></table></div>`
          : `<div class="empty">No expenses yet. Add the first one above.</div>`
      }
    </div>
    <aside class="side">
      <div class="panel">
        <h3>${esc(g.name)}</h3>
        <p class="sub">${esc(g.members.join(', '))} · ${esc(g.currency)}</p>
        <div class="field"><label for="share">Invite link</label><div class="row"><input id="share" type="text" readonly value="${esc(link)}" /><button class="btn small ghost" type="button" id="copy">Copy</button></div><span class="hint">Anyone with the link can add to this pot.</span></div>
      </div>
      <div class="panel flat">
        <h3>What it noticed</h3>
        ${g.norms.length ? `<div class="journal">${g.norms.map((n: string) => `<div class="entry">${esc(n)}</div>`).join('')}</div>` : `<p class="sub" style="margin:0">After a few expenses it notices habits, like who usually pays for food. Each habit is written to the pot's own memory.</p>`}
      </div>
      <a class="btn ghost" href="#/treasury">All treasuries and goals</a>
    </aside>
  </div>`
}

export function renderPocket(app: HTMLElement, ctx: Ctx, rest: string[]) {
  const k = ctx.state?.keeper
  const potId = rest[0]
  const head = (title: string, lede: string) => `
    <div class="room-head">
      <div><span class="tag">Everyday money that simply makes sense</span><h1 class="display">${esc(title)}</h1><p class="lede">${esc(lede)}</p></div>
    </div>`

  if (potId) {
    const data = pots.get(potId)
    app.innerHTML = `<section style="--c: var(--pocket)">${head(data?.group?.name || 'Treasury', 'A shared treasury that remembers who owes who. No wallet and no jargon.')}${data ? potView(ctx, data) : '<p class="loading">Opening the pot…</p>'}</section>`
    if (!data) {
      loadPot(potId)
        .then(async () => {
          if (k && !k.pocket.groups.includes(potId)) {
            const res = await api('pocket/join', { id: potId }).catch(() => null)
            if (res?.keeper && ctx.state) ctx.state.keeper = res.keeper
          }
          renderPocket(app, ctx, rest)
        })
        .catch(e => (app.querySelector('.loading')!.textContent = e.message))
      return
    }
    app.querySelector('#copy')?.addEventListener('click', () => {
      navigator.clipboard?.writeText((app.querySelector('#share') as HTMLInputElement).value).then(() => toast('Link copied.'))
    })
    app.querySelector('#exp-form')!.addEventListener('submit', async e => {
      e.preventDefault()
      const text = (app.querySelector('#exp') as HTMLInputElement).value
      if (!text.trim()) return
      const res = await act((e.target as HTMLFormElement).querySelector('button'), () => api('pocket/expense', { id: potId, text }))
      if (res) {
        pots.set(potId, { group: res.result.group, balances: res.result.balances, plan: res.result.plan })
        ctx.apply(res, 'pocket')
      }
    })
    app.querySelectorAll<HTMLButtonElement>('[data-settle]').forEach(b =>
      b.addEventListener('click', async () => {
        const p = JSON.parse(b.dataset.settle!)
        const res = await act(b, () => api('pocket/settle', { id: potId, ...p }))
        if (res) {
          pots.set(potId, { group: res.result.group, balances: res.result.balances, plan: res.result.plan })
          ctx.apply(res, 'pocket')
        }
      }),
    )
    return
  }

  const groups: string[] = k?.pocket?.groups || []
  const goals: any[] = k?.pocket?.goals || []
  const recurring: any[] = k?.watch?.recurring || []
  const flow = k?.watch?.cashflow
  const missing = groups.filter(id => !pots.has(id))
  if (missing.length) Promise.all(missing.map(id => loadPot(id).catch(() => null))).then(() => location.hash.startsWith('#/treasury') && !location.hash.includes('/pocket/') && renderPocket(app, ctx, rest))

  app.innerHTML = `
  <section style="--c: var(--pocket)">
    ${head('Treasury', 'Shared spending, savings that follow your real cash flow, and subscription limits it learns from you. No wallet and no jargon.')}
    <div class="cols">
      <div>
        <h3 style="margin-bottom:10px">Shared treasuries</h3>
        ${groups.length ? `<div class="pots" style="margin-bottom:16px">${groups.map(id => {
          const d = pots.get(id)
          const open = d ? d.plan.length : null
          return `<a class="pot-link" href="#/treasury/${esc(id)}"><span>${esc(d?.group?.name || 'Loading…')}</span><span class="small muted">${d ? `${d.group.members.length} people · ${open ? `${open} to settle` : 'square'}` : ''}</span></a>`
        }).join('')}</div>` : ''}
        <form class="panel" id="pot-form">
          <h3>Open a shared treasury</h3>
          <p class="sub">For a trip, a flat or a dinner club. You will get a link to share.</p>
          <div class="field"><label for="pname">Name</label><input id="pname" type="text" maxlength="28" placeholder="Bali trip" required /></div>
          <div class="field" style="margin-top:10px"><label for="pmem">People, separated by commas</label><input id="pmem" type="text" maxlength="200" placeholder="Vika, Rina, Budi" required /></div>
          <div class="field" style="margin-top:10px"><label for="pcur">Currency</label><select id="pcur"><option>IDR</option><option>USD</option><option>SGD</option><option>EUR</option></select></div>
          <button class="btn pocket" type="submit" style="margin-top:14px">Open it</button>
        </form>

        <h3 style="margin:30px 0 10px">Savings goals</h3>
        ${flow ? `<p class="small muted" style="margin-bottom:10px">From the wallet in the Sentinel, last 30 days: in ${usd(flow.inflow)}, out ${usd(flow.outflow)}. Plans use this.</p>` : `<p class="small muted" style="margin-bottom:10px">Watch a wallet in the Sentinel and goals will adapt to its real cash flow. Without it, plans split the amount evenly.</p>`}
        <div class="journal">${goals
          .map((g: any) => {
            const pctDone = Math.min(100, (g.saved / g.target) * 100)
            const last = g.plan[g.plan.length - 1]
            return `<div class="goal" data-goal="${esc(g.id)}"><div class="row" style="justify-content:space-between"><b>${esc(g.name)}</b><span class="num">${usd(g.saved)} of ${usd(g.target)} by ${date(g.by)}</span></div><div class="meter"><i style="width:${pctDone}%"></i></div><p><b>${usd(g.weekly)} a week</b></p>${last ? `<p class="why">${esc(last.why)}</p>` : ''}${g.plan.length > 1 ? `<p class="small muted">The plan changed ${g.plan.length - 1} time${g.plan.length > 2 ? 's' : ''} as your cash flow moved.</p>` : ''}<div class="row"><label class="sr" for="add-${esc(g.id)}">Amount saved</label><input id="add-${esc(g.id)}" type="number" min="0" step="0.01" placeholder="Saved $" style="max-width:140px" /><button class="btn small ghost" data-add>Add savings</button></div></div>`
          })
          .join('')}</div>
        <form class="panel flat" id="goal-form" style="margin-top:12px">
          <div class="row">
            <label class="sr" for="gname">Goal name</label><input id="gname" type="text" maxlength="28" placeholder="New laptop" required />
            <label class="sr" for="gt">Target in dollars</label><input id="gt" type="number" min="1" step="1" placeholder="Target $" required style="max-width:130px" />
            <label class="sr" for="gby">By date</label><input id="gby" type="date" required style="max-width:170px" />
            <button class="btn pocket small" type="submit">Add goal</button>
          </div>
        </form>
      </div>
      <aside class="side">
        <div class="panel">
          <h3>Subscriptions</h3>
          <p class="sub">Repeating payments the Sentinel found. Set what each one is allowed to cost a month and Orasentra remembers it.</p>
          ${recurring.length ? `<div class="journal">${recurring.map((r: any) => {
            const monthly = (r.usd * 30) / r.everyDays
            const over = r.capUsd && monthly > r.capUsd
            return `<div class="entry" data-sub="${esc(r.counterparty)}"><div class="t">${esc(r.label)} ${over ? '<span class="badge watch">over limit</span>' : r.capUsd ? '<span class="badge ok">within limit</span>' : ''}</div><div class="s"><span>about ${usd(monthly)} a month</span>${r.capUsd ? `<span>limit ${usd(r.capUsd)}</span>` : ''}</div><div class="row" style="margin-top:8px"><label class="sr" for="cap-${esc(r.counterparty)}">Monthly limit</label><input id="cap-${esc(r.counterparty)}" type="number" min="1" placeholder="Limit $" style="max-width:120px;min-height:36px" /><button class="btn small ghost" data-cap>Set limit</button></div></div>`
          }).join('')}</div>` : `<div class="empty">None yet. Watch a wallet in the Sentinel first; repeating payments appear here.</div>`}
        </div>
      </aside>
    </div>
  </section>`

  const by = app.querySelector('#gby') as HTMLInputElement
  const d = new Date(Date.now() + 60 * 864e5)
  by.value = d.toISOString().slice(0, 10)
  by.min = new Date(Date.now() + 864e5).toISOString().slice(0, 10)

  app.querySelector('#pot-form')!.addEventListener('submit', async e => {
    e.preventDefault()
    const members = (app.querySelector('#pmem') as HTMLInputElement).value.split(',').map(s => s.trim()).filter(Boolean)
    const res = await act((e.target as HTMLFormElement).querySelector('button'), () =>
      api('pocket/group', { name: (app.querySelector('#pname') as HTMLInputElement).value, members, currency: (app.querySelector('#pcur') as HTMLSelectElement).value }),
    )
    if (res) {
      ctx.apply(res, 'pocket')
      location.hash = `#/treasury/${res.result.id}`
    }
  })
  app.querySelector('#goal-form')!.addEventListener('submit', async e => {
    e.preventDefault()
    const res = await act((e.target as HTMLFormElement).querySelector('button'), () =>
      api('pocket/goal', {
        name: (app.querySelector('#gname') as HTMLInputElement).value,
        target: Number((app.querySelector('#gt') as HTMLInputElement).value),
        by: Date.parse(`${by.value}T12:00:00Z`),
      }),
    )
    if (res) ctx.apply(res, 'pocket')
  })
  app.querySelectorAll<HTMLElement>('[data-goal]').forEach(card =>
    card.querySelector('[data-add]')!.addEventListener('click', async e => {
      const add = Number((card.querySelector('input') as HTMLInputElement).value)
      if (!add) return toast('Type how much you saved.', 'err')
      const res = await act(e.currentTarget as HTMLButtonElement, () => api('pocket/goal', { id: card.dataset.goal, add }))
      if (res) ctx.apply(res, 'pocket')
    }),
  )
  app.querySelectorAll<HTMLElement>('[data-sub]').forEach(card =>
    card.querySelector('[data-cap]')!.addEventListener('click', async e => {
      const capUsd = Number((card.querySelector('input') as HTMLInputElement).value)
      if (!capUsd) return toast('Type a monthly limit first.', 'err')
      const res = await act(e.currentTarget as HTMLButtonElement, () => api('pocket/cap', { who: card.dataset.sub, capUsd }))
      if (res) ctx.apply(res, 'pocket')
    }),
  )
}
