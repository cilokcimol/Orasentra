// Shared browser helpers: the keeper key, the API client, formatting, small UI pieces.

const KEY = 'orasentra.key'

export function keeperKey(): string {
  let k = ''
  try {
    k = localStorage.getItem(KEY) || ''
  } catch {}
  if (!/^[a-f0-9]{32,64}$/.test(k)) {
    const b = new Uint8Array(16)
    crypto.getRandomValues(b)
    k = [...b].map(x => x.toString(16).padStart(2, '0')).join('')
    try {
      localStorage.setItem(KEY, k)
    } catch {}
  }
  return k
}

export function useKey(k: string): boolean {
  const v = k.trim().toLowerCase()
  if (!/^[a-f0-9]{32,64}$/.test(v)) return false
  try {
    const cur = localStorage.getItem(KEY)
    if (cur && !localStorage.getItem(KEY + '.own')) localStorage.setItem(KEY + '.own', cur)
    localStorage.setItem(KEY, v)
  } catch {
    return false
  }
  return true
}

export function ownKey(): string | null {
  try {
    return localStorage.getItem(KEY + '.own')
  } catch {
    return null
  }
}

export class ApiError extends Error {}

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', 'x-orasentra-key': keeperKey() },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => null)
  if (!res) throw new ApiError('Could not reach Orasentra. Check your connection and try again.')
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status}).`)
  return data as T
}

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export const pct = (p: number) => `${Math.round(p * 100)}%`
export const usd = (n: number) => (n >= 1000 ? `$${Math.round(n).toLocaleString('en-US')}` : `$${n.toFixed(2)}`)
export const money = (n: number, c: string) => `${c} ${Math.round(n).toLocaleString('en-US')}`
export const short = (a: string, n = 6) => (a && a.length > n * 2 + 2 ? `${a.slice(0, n)}…${a.slice(-4)}` : a)

export function ago(t: number) {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

export function until(t: number) {
  const s = Math.round((t - Date.now()) / 1000)
  if (s <= 0) return 'closed'
  if (s < 3600) return `${Math.round(s / 60)} min left`
  if (s < 86400) return `${Math.round(s / 3600)} h left`
  return `${Math.round(s / 86400)} days left`
}

export const date = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

export function toast(text: string, kind: 'ok' | 'err' = 'ok') {
  let host = document.getElementById('toasts')
  if (!host) {
    host = document.createElement('div')
    host.id = 'toasts'
    host.setAttribute('role', 'status')
    host.setAttribute('aria-live', 'polite')
    document.body.append(host)
  }
  const el = document.createElement('div')
  el.className = `toast ${kind}`
  el.textContent = text
  host.append(el)
  setTimeout(() => el.classList.add('out'), 4200)
  setTimeout(() => el.remove(), 4800)
}

/** Runs an async action with a busy button and a toast on failure. */
export async function act<T>(btn: HTMLButtonElement | null, fn: () => Promise<T>): Promise<T | null> {
  const label = btn?.innerHTML
  if (btn) {
    btn.disabled = true
    btn.classList.add('busy')
  }
  try {
    return await fn()
  } catch (e) {
    toast((e as Error).message || 'Something went wrong.', 'err')
    return null
  } finally {
    if (btn) {
      btn.disabled = false
      btn.classList.remove('busy')
      btn.innerHTML = label!
    }
  }
}

/** A tiny SVG line for trust history. */
export function spark(values: number[], w = 120, h = 28, cls = '') {
  if (values.length < 2) values = [values[0] ?? 0.5, values[0] ?? 0.5]
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - v * h).toFixed(1)}`).join(' ')
  return `<svg class="spark ${cls}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><line x1="0" x2="${w}" y1="${h / 2}" y2="${h / 2}" class="mid"/><polyline points="${pts}"/></svg>`
}

export const prefersReducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

export const ROOM_LABEL: Record<string, string> = { calls: 'Oracle', watch: 'Sentinel', pocket: 'Treasury', ledger: 'Archive' }

/** Event bus so a new memory anywhere can ripple through the 3D core. */
export const bus = new EventTarget()
export const emitMemory = (room: string) => bus.dispatchEvent(new CustomEvent('memory', { detail: { room } }))
