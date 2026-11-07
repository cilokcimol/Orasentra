// Sui mainnet reads through the Tatum gateway, over Sui's gRPC API (sui.rpc.v2).
// Every call is counted so the status page can show real usage.

import { env } from './env.js'
import { update } from './store.js'

export class TatumError extends Error {}

const HOST = process.env.TATUM_SUI_GRPC || 'sui-mainnet-grpc.gateway.tatum.io:443'

let calls = 0
let lastFlush = 0
const byMethod: Record<string, number> = {}

function count(method: string) {
  calls += 1
  byMethod[method] = (byMethod[method] || 0) + 1
  if (Date.now() - lastFlush < 15000) return
  const n = calls
  calls = 0
  lastFlush = Date.now()
  void update<{ total: number }>('tatum/stats.json', { total: 0 }, s => {
    s.total += n
  }).catch(() => {})
}

type Grpc = typeof import('@grpc/grpc-js')
let clients: Promise<{ grpc: Grpc; ledger: any; state: any }> | null = null

async function connect() {
  if (clients) return clients
  clients = (async () => {
    const grpc = await import('@grpc/grpc-js')
    const loader = await import('@grpc/proto-loader')
    const { fileURLToPath } = await import('node:url')
    const { dirname, join } = await import('node:path')
    const { existsSync } = await import('node:fs')
    const here = dirname(fileURLToPath(import.meta.url))
    const roots = [join(process.cwd(), 'proto'), join(here, '..', '..', 'proto'), join(here, 'proto')]
    const root = roots.find(r => existsSync(join(r, 'sui/rpc/v2/ledger_service.proto')))
    if (!root) throw new TatumError('Sui API definitions are missing from the deployment')
    const def = await loader.load(['sui/rpc/v2/ledger_service.proto', 'sui/rpc/v2/state_service.proto'], {
      includeDirs: [root],
      keepCase: true,
      longs: String,
      enums: String,
      defaults: false,
      oneofs: true,
    })
    const pkg = grpc.loadPackageDefinition(def) as any
    const creds = grpc.credentials.createSsl()
    const opts = { 'grpc.max_receive_message_length': 32 * 1024 * 1024 }
    return {
      grpc,
      ledger: new pkg.sui.rpc.v2.LedgerService(HOST, creds, opts),
      state: new pkg.sui.rpc.v2.StateService(HOST, creds, opts),
    }
  })()
  clients.catch(() => (clients = null))
  return clients
}

async function meta() {
  const { grpc } = await connect()
  const m = new grpc.Metadata()
  m.set('x-api-key', env.tatumKey)
  return m
}

function unary<T>(svc: 'ledger' | 'state', method: string, req: object, timeoutMs = 12000): Promise<T> {
  if (!env.tatumKey) return Promise.reject(new TatumError('TATUM_API_KEY is not set'))
  return connect().then(async c => {
    const md = await meta()
    return new Promise<T>((resolve, reject) => {
        count(method)
        c[svc][method](req, md, { deadline: Date.now() + timeoutMs }, (err: any, res: T) =>
          err ? reject(new TatumError(`Tatum ${method}: ${err.details || err.message}`)) : resolve(res),
        )
      })
  })
}

function stream<T>(svc: 'ledger' | 'state', method: string, req: object, max: number, timeoutMs = 15000): Promise<T[]> {
  if (!env.tatumKey) return Promise.reject(new TatumError('TATUM_API_KEY is not set'))
  return connect().then(async c => {
    const md = await meta()
    return new Promise<T[]>((resolve, reject) => {
        count(method)
        const out: T[] = []
        const call = c[svc][method](req, md, { deadline: Date.now() + timeoutMs })
        call.on('data', (d: T) => {
          out.push(d)
          if (out.length >= max) call.cancel()
        })
        call.on('error', (err: any) => (err.code === c.grpc.status.CANCELLED || out.length ? resolve(out) : reject(new TatumError(`Tatum ${method}: ${err.details || err.message}`))))
        call.on('end', () => resolve(out))
      })
  })
}

/** google.protobuf.Value as decoded by proto-loader, back to plain JSON. */
function plain(v: any): any {
  if (!v || typeof v !== 'object') return v
  switch (v.kind) {
    case 'structValue':
      return Object.fromEntries(Object.entries(v.structValue?.fields || {}).map(([k, x]) => [k, plain(x)]))
    case 'listValue':
      return (v.listValue?.values || []).map(plain)
    case 'stringValue':
      return v.stringValue
    case 'numberValue':
      return v.numberValue
    case 'boolValue':
      return v.boolValue
    case 'nullValue':
      return null
  }
  return v
}

export const tatumReady = () => Boolean(env.tatumKey)
export const tatumMethods = () => ({ ...byMethod })

// Cetus CLMM pool USDC/SUI, fee 0.25%, the deepest native USDC pool on Sui mainnet.
export const SUI_USDC_POOL = '0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105'

export async function getObjectJson(id: string): Promise<any> {
  const res = await unary<{ object?: { json?: any } }>('ledger', 'GetObject', { object_id: id, read_mask: { paths: ['object_id', 'version', 'json'] } })
  return plain(res.object?.json)
}

/** Price of 1 SUI in USDC read straight from the pool's sqrt price. */
export async function suiPrice(): Promise<{ usd: number; checkpointed: number }> {
  const json = await getObjectJson(SUI_USDC_POOL)
  const sqrt = json?.current_sqrt_price
  if (!sqrt) throw new TatumError('Pool state missing')
  return { usd: priceFromSqrt(String(sqrt)), checkpointed: Date.now() }
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

const tsMs = (t: any) => (t?.seconds ? Number(t.seconds) * 1000 + Math.floor(Number(t.nanos || 0) / 1e6) : Date.now())

/** Recent transactions that touched an address, newest first, with balance changes. */
export async function recentTxs(address: string, limit = 50): Promise<SuiTx[]> {
  const rows = await stream<{ transaction?: any }>(
    'ledger',
    'ListTransactions',
    {
      read_mask: { paths: ['digest', 'timestamp', 'balance_changes'] },
      filter: { terms: [{ literals: [{ affected_address: { address } }] }] },
      options: { limit, ordering: 'ORDERING_DESCENDING' },
    },
    limit,
  )
  return rows
    .map(r => r.transaction)
    .filter(Boolean)
    .map((t: any) => ({
      digest: t.digest,
      timestampMs: String(tsMs(t.timestamp)),
      balanceChanges: (t.balance_changes || []).map((b: any) => ({ owner: { AddressOwner: b.address }, coinType: b.coin_type, amount: String(b.amount) })),
    }))
}

export async function balances(address: string) {
  const res = await unary<{ balances?: { coin_type: string; balance: string }[] }>('state', 'ListBalances', { owner: address })
  return (res.balances || []).map(b => ({ coinType: b.coin_type, totalBalance: b.balance }))
}

export async function checkpoint() {
  const res = await unary<{ checkpoint_height?: string }>('ledger', 'GetServiceInfo', {})
  return Number(res.checkpoint_height || 0)
}
