// Small JSON document store. Vercel Blob (private) in production, local files in development.
// Walrus Memory is the long term record; this store is the fast working copy the UI reads.
// Reads bypass the CDN and writes use ETag preconditions, so parallel requests never lose updates.

import { env } from './env.js'

type Doc = Record<string, unknown>
const cache = new Map<string, { at: number; value: unknown; etag?: string }>()

async function fsRead(path: string): Promise<{ value: unknown | null; etag?: string }> {
  const { readFile } = await import('node:fs/promises')
  try {
    return { value: JSON.parse(await readFile(`${env.dataDir}/${path}`, 'utf8')) }
  } catch {
    return { value: null }
  }
}

async function fsWrite(path: string, value: unknown) {
  const { writeFile, mkdir } = await import('node:fs/promises')
  const { dirname } = await import('node:path')
  const file = `${env.dataDir}/${path}`
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value))
}

/** A read that lands while the same blob is being overwritten can return a partial body; read again. */
async function blobRead(path: string): Promise<{ value: unknown | null; etag?: string }> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await blobReadOnce(path)
    } catch (e) {
      if (!(e instanceof SyntaxError) || attempt >= 5) throw e
      await new Promise(r => setTimeout(r, 150 + attempt * 150))
    }
  }
}

async function blobReadOnce(path: string): Promise<{ value: unknown | null; etag?: string }> {
  const { get } = await import('@vercel/blob')
  try {
    const res = (await get(path, { access: 'private', token: env.blobToken, useCache: false } as never)) as unknown as {
      statusCode?: number
      stream?: ReadableStream
      blob?: { etag?: string }
      etag?: string
    } | null
    if (!res || !res.stream) return { value: null }
    const text = await new Response(res.stream).text()
    return { value: text ? JSON.parse(text) : null, etag: res.blob?.etag || res.etag }
  } catch (e) {
    const name = (e as Error)?.name || ''
    const msg = String((e as Error)?.message || e)
    if (/NotFound/i.test(name) || /not.?found|404/i.test(msg)) return { value: null }
    throw e
  }
}

class Conflict extends Error {}

async function blobWrite(path: string, value: unknown, etag?: string | null) {
  const { put } = await import('@vercel/blob')
  try {
    const res = await put(path, JSON.stringify(value), {
      access: 'private',
      token: env.blobToken,
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 60,
      ...(etag && process.env.BLOB_IF_MATCH ? { ifMatch: etag } : {}),
    } as never)
    return (res as unknown as { etag?: string }).etag
  } catch (e) {
    const name = (e as Error)?.name || ''
    if (/PreconditionFailed/i.test(name) || /precondition|412/i.test(String((e as Error)?.message))) throw new Conflict()
    throw e
  }
}

async function load(path: string) {
  return env.blobToken ? blobRead(path) : fsRead(path)
}

export async function read<T = Doc>(path: string, fallback: T, maxAgeMs = 0): Promise<T> {
  const hit = cache.get(path)
  if (hit && maxAgeMs && Date.now() - hit.at < maxAgeMs) return (hit.value ?? fallback) as T
  const { value, etag } = await load(path)
  cache.set(path, { at: Date.now(), value, etag })
  return (value ?? fallback) as T
}

export async function write<T>(path: string, value: T): Promise<T> {
  if (env.blobToken) {
    const etag = await blobWrite(path, value)
    cache.set(path, { at: Date.now(), value, etag })
  } else {
    await fsWrite(path, value)
    cache.set(path, { at: Date.now(), value })
  }
  return value
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Runs fn while holding a short lock on name, shared by every server instance.
 * The lock is a blob that can only be created when it does not exist yet; a lock older than 10 seconds is treated as abandoned.
 */
export async function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (!env.blobToken) return fn()
  const { put, del, head } = await import('@vercel/blob')
  const path = `locks/${name}.lock`
  for (let attempt = 0; attempt < 60; attempt++) {
    let held = false
    try {
      await put(path, String(Date.now()), { access: 'private', token: env.blobToken, addRandomSuffix: false, allowOverwrite: false, contentType: 'text/plain' } as never)
      held = true
    } catch (e) {
      const msg = `${(e as Error)?.name} ${(e as Error)?.message}`
      if (!/exist|overwrite|conflict|precondition/i.test(msg)) throw e
      const h = (await head(path, { token: env.blobToken } as never).catch(() => null)) as { uploadedAt?: Date } | null
      if (h?.uploadedAt && Date.now() - new Date(h.uploadedAt).getTime() > 10000) await del(path, { token: env.blobToken } as never).catch(() => {})
      await sleep(120 + Math.random() * 200)
    }
    if (held) {
      try {
        return await fn()
      } finally {
        await del(path, { token: env.blobToken } as never).catch(() => {})
      }
    }
  }
  throw new Error(`Busy saving ${name}. Try again in a moment.`)
}

/** Read, change and write back under a lock, so parallel requests never lose updates. */
export async function update<T>(path: string, fallback: T, fn: (v: T) => T | void): Promise<T> {
  return withLock(path.replace(/[^a-z0-9]+/gi, '-'), () => updateUnlocked(path, fallback, fn))
}

async function updateUnlocked<T>(path: string, fallback: T, fn: (v: T) => T | void): Promise<T> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { value, etag } = await load(path)
    const current = structuredClone((value ?? fallback) as T)
    const next = (fn(current) ?? current) as T
    try {
      if (env.blobToken) {
        const newTag = await blobWrite(path, next, value === null ? null : etag)
        cache.set(path, { at: Date.now(), value: next, etag: newTag })
      } else {
        await fsWrite(path, next)
        cache.set(path, { at: Date.now(), value: next })
      }
      return next
    } catch (e) {
      if (!(e instanceof Conflict)) throw e
      await new Promise(r => setTimeout(r, 60 + Math.random() * 180 * (attempt + 1)))
    }
  }
  throw new Error(`Could not save ${path} after several attempts`)
}
