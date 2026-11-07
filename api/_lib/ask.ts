// Ask Mnemora anything. Answers come from what it remembers on Walrus, plus exact numbers it can compute.

import { env } from './env.js'
import { recall, type Recalled } from './memory.js'
import { keeperNs, type Keeper } from './keeper.js'
import { groupNs } from './pocket.js'
import { spendingOn } from './watch.js'
import { trustTable } from './calls.js'

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const DAYS_ID = ['minggu', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu']

/** Finds a day range in the question, e.g. "last Tuesday" or "yesterday". UTC days. */
export function dayRange(q: string, now = Date.now()): { from: number; to: number; label: string } | null {
  const s = q.toLowerCase()
  const start = new Date(now)
  start.setUTCHours(0, 0, 0, 0)
  const day = 86400000
  if (/\byesterday\b|\bkemarin\b/.test(s)) return { from: start.getTime() - day, to: start.getTime(), label: 'yesterday' }
  if (/\btoday\b|\bhari ini\b/.test(s)) return { from: start.getTime(), to: now, label: 'today' }
  if (/\b(this|past|last) week\b|\bminggu (ini|lalu)\b|\b7 days\b/.test(s)) return { from: now - 7 * day, to: now, label: 'the last 7 days' }
  for (let i = 0; i < 7; i++) {
    if (s.includes(DAYS[i]) || new RegExp(`\\b${DAYS_ID[i]}\\b`).test(s)) {
      const today = start.getUTCDay()
      let back = (today - i + 7) % 7
      if (back === 0) back = 7
      const from = start.getTime() - back * day
      return { from, to: from + day, label: `${DAYS[i][0].toUpperCase()}${DAYS[i].slice(1)} ${new Date(from).toISOString().slice(0, 10)}` }
    }
  }
  return null
}

async function gemini(prompt: string): Promise<string | null> {
  if (!env.geminiKey) return null
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${env.geminiModel}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.geminiKey },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3, maxOutputTokens: 400 } }),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) return null
    const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] }
    return j.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('').trim() || null
  } catch {
    return null
  }
}

export async function ask(k: Keeper, question: string) {
  const q = question.trim().slice(0, 300)
  const facts: string[] = []
  const range = dayRange(q)
  if (range && k.watch.address) {
    const { total, list } = spendingOn(k, range.from, range.to)
    facts.push(
      list.length
        ? `Wallet spending ${range.label}: $${total.toFixed(2)} across ${list.length} payment${list.length > 1 ? 's' : ''} (${list
            .slice(0, 5)
            .map(t => `$${t.usd.toFixed(2)} to ${k.watch.labels[t.counterparty] || t.counterparty.slice(0, 8)}`)
            .join(', ')}).`
        : `No outgoing wallet payments ${range.label}.`,
    )
  }
  if (/trust|listen|right|credib|percaya|benar/i.test(q)) {
    const t = trustTable(k).filter(v => v.n > 0)
    facts.push(t.length ? `Trust table: ${t.map(v => `${v.name} ${v.cred.toFixed(2)} after ${v.n} scored calls`).join('; ')}.` : 'No calls have been scored yet, so everyone starts level at 0.50.')
  }
  const namespaces = [keeperNs(k.id), ...k.pocket.groups.map(groupNs)].slice(0, 4)
  const found = (await Promise.all(namespaces.map(ns => recall(ns, q, 5).catch(() => [] as Recalled[])))).flat()
  const memories = found.sort((a, b) => a.distance - b.distance).slice(0, 6)

  const llm = await gemini(
    `You are Mnemora, a calm money and forecasting assistant with long term memory. Answer the user's question in at most 4 short sentences, in the user's language. Use only the facts and memories below. If they do not answer it, say what you would need. No emoji.\n\nQuestion: ${q}\n\nComputed facts:\n${facts.join('\n') || 'none'}\n\nMemories from Walrus:\n${memories.map((m, i) => `${i + 1}. ${m.text}`).join('\n') || 'none'}`,
  )
  const answer =
    llm ||
    (facts.length
      ? facts.join(' ')
      : memories.length
        ? `Here is the closest thing I remember: ${memories[0].text}`
        : 'I do not remember anything about that yet. Log a call, watch a wallet, or add to a pot, and I will.')
  return { answer, facts, memories, usedModel: Boolean(llm) }
}
