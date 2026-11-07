import './style.css'
import { api, esc, toast, act, emitMemory } from './lib'
import { renderHome } from './views/home'
import { renderCalls } from './views/calls'
import { renderWatch } from './views/watch'
import { renderPocket } from './views/pocket'
import { renderLedger } from './views/ledger'
import { renderJudge } from './views/judge'

export interface Ctx {
  state: any | null
  board: any | null
  health: any | null
  refresh(parts?: ('state' | 'board' | 'health')[]): Promise<void>
  apply(res: any, room?: string): void
  rerender(): void
}

const app = document.getElementById('app')!
let cleanup: (() => void) | null = null

const ctx: Ctx = {
  state: null,
  board: null,
  health: null,
  async refresh(parts = ['state', 'board', 'health']) {
    const jobs: Promise<void>[] = []
    if (parts.includes('state')) jobs.push(api('state').then(s => void (ctx.state = s)).catch(e => toast(e.message, 'err')))
    if (parts.includes('board')) jobs.push(api('board').then(b => void (ctx.board = b)).catch(() => {}))
    if (parts.includes('health')) jobs.push(api('health').then(h => void (ctx.health = h)).catch(() => {}))
    await Promise.all(jobs)
  },
  /** Merge a mutation response, announce the new memory, re-render. */
  apply(res: any, room?: string) {
    if (res?.keeper && ctx.state) ctx.state.keeper = res.keeper
    const mem = res?.result?.memory
    if (mem && room) {
      emitMemory(room)
      if (ctx.state) ctx.state.memories = [{ ...mem }, ...(ctx.state.memories || [])]
      toast(mem.status === 'failed' ? `Saved locally. Walrus did not accept the memory: ${mem.error || 'unknown error'}` : 'Memory sealed. Writing to Walrus now.')
    }
    ctx.rerender()
  },
  rerender() {
    route(false)
  },
}

function current() {
  const h = location.hash.replace(/^#\/?/, '')
  const [room, ...rest] = h.split('/')
  return { room: room || '', rest }
}

let lastRoom = '-'
async function route(scrollTop = true) {
  const { room, rest } = current()
  document.querySelectorAll<HTMLAnchorElement>('.nav a').forEach(a => {
    if (a.dataset.r === room) a.setAttribute('aria-current', 'page')
    else a.removeAttribute('aria-current')
  })
  const changed = room !== lastRoom
  lastRoom = room
  if (changed && cleanup) {
    cleanup()
    cleanup = null
  }
  const views: Record<string, (el: HTMLElement, c: Ctx, rest: string[]) => void | (() => void)> = {
    '': renderHome,
    oracle: renderCalls,
    sentinel: renderWatch,
    treasury: renderPocket,
    archive: renderLedger,
    status: renderJudge,
  }
  const view = views[room] || renderHome
  const titles: Record<string, string> = { oracle: 'Oracle', sentinel: 'Sentinel', treasury: 'Treasury', archive: 'Archive', status: 'Status' }
  document.title = titles[room] ? `${titles[room]} · Orasentra` : 'Orasentra'
  app.classList.toggle('full', !views[room] || room === '')
  const out = view(app, ctx, rest)
  if (typeof out === 'function') cleanup = out
  if (changed && scrollTop) {
    scrollTo({ top: 0 })
    app.focus({ preventScroll: true })
  }
}

addEventListener('hashchange', () => route(true))

// ---------------------------------------------------------------- ask
const dlg = document.getElementById('ask') as HTMLDialogElement
const out = document.getElementById('ask-out')!
const SUGGEST = ['What did I spend last Tuesday?', 'Who should I trust on sports?', 'Who owes who in my treasury?', 'What have you learned about my spending?']
document.getElementById('ask-suggest')!.innerHTML = SUGGEST.map(s => `<button class="chip" type="button">${esc(s)}</button>`).join('')
document.getElementById('ask-suggest')!.addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest('button')
  if (!b) return
  ;(document.getElementById('ask-q') as HTMLInputElement).value = b.textContent || ''
  ;(document.getElementById('ask-form') as HTMLFormElement).requestSubmit()
})
document.getElementById('ask-open')!.addEventListener('click', () => {
  dlg.showModal()
  ;(document.getElementById('ask-q') as HTMLInputElement).focus()
})
document.getElementById('ask-close')!.addEventListener('click', () => dlg.close())
dlg.addEventListener('click', e => {
  if (e.target === dlg) dlg.close()
})
document.getElementById('ask-form')!.addEventListener('submit', async e => {
  e.preventDefault()
  const q = (document.getElementById('ask-q') as HTMLInputElement).value
  const btn = (e.target as HTMLFormElement).querySelector('button')
  out.innerHTML = `<p class="muted">Searching your memories on Walrus…</p>`
  const res = await act(btn, () => api('ask', { q }))
  if (!res) {
    out.innerHTML = ''
    return
  }
  const r = res.result
  out.innerHTML = `<div class="answer"><p>${esc(r.answer)}</p>${
    r.memories?.length
      ? `<div class="from"><b>From these memories</b>${r.memories
          .slice(0, 3)
          .map((m: any) => `<span>${esc(m.text.slice(0, 160))}${m.text.length > 160 ? '…' : ''}</span>`)
          .join('')}</div>`
      : ''
  }</div>`
})

// ---------------------------------------------------------------- boot
app.innerHTML = `<p class="loading wrap">Opening your memory…</p>`
route()
ctx.refresh().then(() => route(false))
setInterval(() => {
  if (!document.hidden) ctx.refresh(['state', 'health']).then(() => {
    const busy = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)
    if (!busy && !document.querySelector('.drawer')) route(false)
  })
}, 45000)
