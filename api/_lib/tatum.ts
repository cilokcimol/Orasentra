// Sui mainnet reads through the Tatum RPC gateway. Every call is counted so the UI can show real usage.

import { env } from './env.js'
import { update } from './store.js'

export class TatumError extends Error {}

let calls = 0
let lastFlush = 0

async function flushCount() {
  if (!calls || Date.now() - lastFlush < 15000) return
  const n = calls
  calls = 0
  lastFlush = Date.now()
  await update<{ total: number; byMethod: Record<string, number> }>('tatum/stats.json', { total: 0, byMethod: {} }, s => {
    s.total += n
  }).catch(() => {})
}

const byMethod: Record<string, number> = {}

export async function sui<T = unknown>(method: string, params: unknown[] = []): Promise<T> {
  if (!env.tatumKey) throw new TatumError('TATUM_API_KEY is not set')
  const res = await fetch(env.tatumSuiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': env.tatumKey },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  })
  calls += 1
  byMethod[method] = (byMethod[method] || 0) + 1
  void flushCount()
  const text = await res.text()
  if (!res.ok) throw new TatumError(`Tatum ${res.status}: ${text.slice(0, 160)}`)
  const json = JSON.parse(text) as { result?: T; error?: { message: string } }
  if (json.error) throw new TatumError(`Sui RPC: ${json.error.message}`)
  return json.result as T
}

export const tatumReady = () => Boolean(env.tatumKey)
export const tatumMethods = () => ({ ...byMethod })

// Cetus CLMM pool USDC/SUI, fee 0.25%, the deepest native USDC pool on Sui mainnet.
export const SUI_USDC_POOL = '0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105'

/** Price of 1 SUI in USDC read straight from the pool's sqrt price. */
export async function suiPrice(): Promise<{ usd: number; checkpointed: number }> {
  const obj = await sui<{ data?: { content?: { fields?: { current_sqrt_price?: string } } } }>('sui_getObject', [
    SUI_USDC_POOL,
    { showContent: true },
  ])
  const sqrt = obj?.data?.content?.fields?.current_sqrt_price
  if (!sqrt) throw new TatumError('Pool state missing')
  return { usd: priceFromSqrt(sqrt), checkpointed: Date.now() }
}

/** coinA is USDC (6 decimals), coinB is SUI (9 decimals). sqrt price is Q64.64 of B per A. */
export function priceFromSqrt(sqrt: string): number {
  const s = Number(BigInt(sqrt)) / 2 ** 64
  const suiPerUsdc = s * s * 10 ** (6 - 9)
  return 1 / suiPerUsdc
}

export interface SuiTx {
  digest: string
  timestampMs: string
  balanceChanges?: { owner: { AddressOwner?: string } | string; coinType: string; amount: string }[]
}

export async function txsFor(address: string, direction: 'FromAddress' | 'ToAddress', limit = 40, cursor: string | null = null) {
  return sui<{ data: SuiTx[]; nextCursor: string | null; hasNextPage: boolean }>('suix_queryTransactionBlocks', [
    { filter: { [direction]: address }, options: { showBalanceChanges: true } },
    cursor,
    limit,
    true,
  ])
}

export async function balances(address: string) {
  return sui<{ coinType: string; totalBalance: string }[]>('suix_getAllBalances', [address])
}

export async function checkpoint() {
  return Number(await sui<string>('sui_getLatestCheckpointSequenceNumber', []))
}
