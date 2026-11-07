// Polymarket public data: live odds from the crowd, plus resolved markets for replays.

const GAMMA = 'https://gamma-api.polymarket.com'
const CLOB = 'https://clob.polymarket.com'

export type Category = 'sports' | 'politics' | 'culture' | 'crypto'
export const TAGS: Record<Category, string> = { sports: 'sports', politics: 'politics', culture: 'pop-culture', crypto: 'crypto' }

// Side markets that read badly as a forecast question.
const NOISY = /handicap|spread|o\/u|over\/under|\btotal\b|map \d|rounds|tweets|set \d|exact score|first half|1st half|\bcorners\b|anytime|\bprops?\b|range/i

export interface PmMarket {
  id: string
  question: string
  outcomes: string[]
  prices: number[]
  tokenIds: string[]
  endDate: number
  closed: boolean
  closedTime?: number
  volume: number
  image?: string
  slug?: string
  eventTitle?: string
}

const parse = (s: unknown): string[] => {
  if (Array.isArray(s)) return s.map(String)
  try {
    return JSON.parse(String(s ?? '[]'))
  } catch {
    return []
  }
}

function toMarket(m: Record<string, unknown>, ev?: Record<string, unknown>): PmMarket | null {
  const outcomes = parse(m.outcomes)
  const prices = parse(m.outcomePrices).map(Number)
  const tokenIds = parse(m.clobTokenIds)
  if (outcomes.length !== 2 || prices.length !== 2 || !m.endDate) return null
  return {
    id: String(m.id),
    question: String(m.question || ''),
    outcomes,
    prices,
    tokenIds,
    endDate: Date.parse(String(m.endDate)),
    closed: Boolean(m.closed),
    closedTime: m.closedTime ? Date.parse(String(m.closedTime).replace(' ', 'T').replace(/\+00$/, 'Z')) : undefined,
    volume: Number(m.volumeNum ?? m.volume ?? 0),
    image: (m.image as string) || (ev?.image as string) || undefined,
    slug: (ev?.slug as string) || (m.slug as string) || undefined,
    eventTitle: ev?.title ? String(ev.title) : undefined,
  }
}

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`Polymarket ${res.status}`)
  return res.json() as Promise<T>
}

/** The main market of each popular open event in a category. */
export async function openMarkets(cat: Category, limit = 14): Promise<PmMarket[]> {
  const events = await get<Record<string, unknown>[]>(
    `${GAMMA}/events?limit=${limit}&active=true&closed=false&tag_slug=${TAGS[cat]}&order=volume24hr&ascending=false`,
  )
  const out: PmMarket[] = []
  for (const ev of events) {
    const markets = ((ev.markets as Record<string, unknown>[]) || [])
      .filter(m => !m.closed && m.active !== false)
      .map(m => toMarket(m, ev))
      .filter((m): m is PmMarket => Boolean(m))
      .filter(m => m.prices[0] > 0.04 && m.prices[0] < 0.96)
      .filter(m => !NOISY.test(m.question))
      .sort((a, b) => b.volume - a.volume)
    if (markets[0]) out.push(markets[0])
  }
  return out
}

export async function market(id: string): Promise<PmMarket | null> {
  return toMarket(await get<Record<string, unknown>>(`${GAMMA}/markets/${id}`))
}

/** Recently resolved binary markets, newest first. */
export async function resolvedMarkets(cat: Category, limit = 16): Promise<PmMarket[]> {
  const events = await get<Record<string, unknown>[]>(
    `${GAMMA}/events?limit=${limit}&closed=true&tag_slug=${TAGS[cat]}&order=closedTime&ascending=false`,
  )
  const out: PmMarket[] = []
  for (const ev of events) {
    for (const raw of ((ev.markets as Record<string, unknown>[]) || []).slice(0, 3)) {
      const m = toMarket(raw, ev)
      if (m && m.closed && Math.max(...m.prices) >= 0.99 && m.tokenIds[0]) {
        out.push(m)
        break
      }
    }
  }
  return out
}

/** Price of the first outcome at a given time, from the order book history. */
export async function priceAt(tokenId: string, atMs: number): Promise<number | null> {
  const t = Math.floor(atMs / 1000)
  const data = await get<{ history: { t: number; p: number }[] }>(
    `${CLOB}/prices-history?market=${tokenId}&startTs=${t - 6 * 3600}&endTs=${t}&fidelity=60`,
  )
  const h = data.history || []
  return h.length ? h[h.length - 1].p : null
}

export const resolvedOutcome = (m: PmMarket): 0 | 1 | null =>
  !m.closed ? null : m.prices[0] >= 0.99 ? 1 : m.prices[1] >= 0.99 ? 0 : null

export const marketUrl = (m: { slug?: string }) => (m.slug ? `https://polymarket.com/event/${m.slug}` : 'https://polymarket.com')
