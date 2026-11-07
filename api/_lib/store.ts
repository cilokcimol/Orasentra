// Small JSON document store. Vercel Blob (private) in production, local files in development.
// Walrus Memory is the long term record; this store is the fast working copy the UI reads.

import { env } from './env.js'

type Doc = Record<string, unknown>
const cache = new Map<string, { at: number; value: unknown }>()

async function fsRead(path: string): Promise<unknown | null> {
  const { readFile } = await import('node:fs/promises')
  try {
    return JSON.parse(await readFile(`${env.dataDir}/${path}`, 'utf8'))
  } catch {
    return null
  }
}

async function fsWrite(path: string, value: unknown) {
  const { writeFile, mkdir } = await import('node:fs/promises')
  const { dirname } = await import('node:path')
  const file = `${env.dataDir}/${path}`
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value))
}

async function blobRead(path: string): Promise<unknown | null> {
  const { get } = await import('@vercel/blob')
  try {
    const res = await get(path, { access: 'private', token: env.blobToken } as never)
    if (!res) return null
    const r = res as unknown as { stream?: ReadableStream; body?: ReadableStream; text?: () => Promise<string> }
    const stream = r.stream || r.body
    const text = stream ? await new Response(stream).text() : r.text ? await r.text() : ''
    return text ? JSON.parse(text) : null
  } catch (e) {
    const msg = String((e as Error)?.message || e)
    if (/not.?found|404/i.test(msg)) return null
    throw e
  }
}

async function blobWrite(path: string, value: unknown) {
  const { put } = await import('@vercel/blob')
  await put(path, JSON.stringify(value), {
    access: 'private',
    token: env.blobToken,
    contentType: 'application/json',
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  } as never)
}

export async function read<T = Doc>(path: string, fallback: T, maxAgeMs = 0): Promise<T> {
  const hit = cache.get(path)
  if (hit && maxAgeMs && Date.now() - hit.at < maxAgeMs) return hit.value as T
  const value = (env.blobToken ? await blobRead(path) : await fsRead(path)) as T | null
  const out = value ?? fallback
  cache.set(path, { at: Date.now(), value: out })
  return out
}

export async function write<T>(path: string, value: T): Promise<T> {
  cache.set(path, { at: Date.now(), value })
  if (env.blobToken) await blobWrite(path, value)
  else await fsWrite(path, value)
  return value
}

export async function update<T>(path: string, fallback: T, fn: (v: T) => T | void): Promise<T> {
  const current = structuredClone(await read<T>(path, fallback))
  const next = (fn(current) ?? current) as T
  return write(path, next)
}
