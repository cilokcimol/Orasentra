import { describe, it, expect } from 'vitest'
import { brier, credibility, weights, blend, probAbove, dailyVol, settleUp, phi } from '../api/_lib/score'
import { priceFromSqrt } from '../api/_lib/tatum'
import { parseExpense, balances } from '../api/_lib/pocket'
import { dayRange } from '../api/_lib/ask'
import { toWatchTx } from '../api/_lib/watch'

describe('score', () => {
  it('brier', () => {
    expect(brier(0.7, 1)).toBeCloseTo(0.09)
    expect(brier(0.7, 0)).toBeCloseTo(0.49)
  })
  it('credibility starts level and rises with an edge', () => {
    expect(credibility({ n: 0, brierSum: 0, baseSum: 0 })).toBe(0.5)
    const good = credibility({ n: 8, brierSum: 8 * 0.1, baseSum: 8 * 0.2 })
    const bad = credibility({ n: 8, brierSum: 8 * 0.3, baseSum: 8 * 0.2 })
    expect(good).toBeGreaterThan(0.6)
    expect(bad).toBeLessThan(0.4)
    expect(credibility({ n: 1, brierSum: 0.1, baseSum: 0.2 })).toBeLessThan(good)
  })
  it('blend leans to trusted voices', () => {
    const w = weights({ A: 0.8, B: 0.2 })
    expect(blend({ A: 0.9, B: 0.1 }, w)).toBeGreaterThan(0.8)
  })
  it('probAbove is symmetric at the line and moves with price', () => {
    expect(phi(0)).toBeCloseTo(0.5, 3)
    expect(probAbove(1, 1, 24, 0.05)).toBeCloseTo(0.5, 2)
    expect(probAbove(1.1, 1, 24, 0.05)).toBeGreaterThan(0.9)
    expect(probAbove(0.9, 1, 24, 0.05)).toBeLessThan(0.1)
  })
  it('dailyVol falls back without data', () => {
    expect(dailyVol([])).toBe(0.045)
  })
  it('settleUp clears balances with few transfers', () => {
    const plan = settleUp({ A: 60, B: -30, C: -30 })
    expect(plan).toEqual([{ from: 'B', to: 'A', amount: 30 }, { from: 'C', to: 'A', amount: 30 }])
  })
})

describe('chain math', () => {
  it('reads SUI price from the Cetus sqrt price', () => {
    expect(priceFromSqrt('629037388563389993613')).toBeCloseTo(0.86, 2)
  })
  it('turns balance changes into a payment', () => {
    const me = '0x' + 'a'.repeat(64)
    const them = '0x' + 'b'.repeat(64)
    const tx = { digest: 'D', timestampMs: '1700000000000', balanceChanges: [
      { owner: { AddressOwner: me }, coinType: '0x2::sui::SUI', amount: '-2000000000' },
      { owner: { AddressOwner: them }, coinType: '0x2::sui::SUI', amount: '1990000000' },
    ] }
    const t = toWatchTx(tx, me, 0.5)!
    expect(t.dir).toBe('out')
    expect(t.usd).toBeCloseTo(1)
    expect(t.counterparty).toBe(them)
  })
})

describe('pocket', () => {
  const ms = ['Rina', 'Budi', 'Vika']
  it('parses rupiah shorthand', () => {
    const e = parseExpense('Dinner 240k paid by Rina split Rina, Budi', ms)
    expect(e).toMatchObject({ amount: 240000, payer: 'Rina', split: ['Rina', 'Budi'], desc: 'Dinner' })
  })
  it('parses dotted thousands and defaults to everyone', () => {
    const e = parseExpense('Bensin Rp 150.000 dibayar Budi', ms)
    expect(e.amount).toBe(150000)
    expect(e.payer).toBe('Budi')
    expect(e.split).toEqual(ms)
  })
  it('balances add to zero', () => {
    const g = { id: 'x', name: 'x', currency: 'IDR', members: ms, created: 0, norms: [], settlements: [],
      expenses: [{ id: '1', at: 0, desc: 'a', amount: 300, payer: 'Rina', split: ms }] }
    const b = balances(g)
    expect(b.Rina).toBe(200)
    expect(Object.values(b).reduce((a, x) => a + x, 0)).toBeCloseTo(0)
  })
})

describe('ask', () => {
  it('finds last Tuesday', () => {
    const sat = Date.UTC(2026, 10, 7, 12)
    const r = dayRange('what did I spend last Tuesday?', sat)!
    expect(new Date(r.from).toISOString().slice(0, 10)).toBe('2026-11-03')
  })
  it('understands Indonesian', () => {
    expect(dayRange('kemarin habis berapa', Date.UTC(2026, 10, 7))!.label).toBe('yesterday')
  })
})

import { merge3 } from '../api/_lib/keeper.js'

describe('keeper merge', () => {
  const base = { seen: 1, picks: [{ qid: 'a', p: 1 }], watch: { lastScan: 1, txs: [{ digest: 'x', t: 1 }], rules: [{ id: 'r1', scope: 's', limitUsd: 5 }] }, memoryIds: ['m1'] }
  it('keeps changes made by two requests at once', () => {
    const ours = structuredClone(base)
    ours.seen = 3
    ours.watch.lastScan = 9
    ours.watch.txs = [{ digest: 'y', t: 2 }, ...ours.watch.txs]
    ours.memoryIds.push('m2')
    const theirs = structuredClone(base)
    theirs.seen = 2
    theirs.picks.push({ qid: 'b', p: 2 })
    theirs.memoryIds.push('m3')
    theirs.watch.rules = [{ id: 'r2', scope: 's', limitUsd: 9 }]
    const m = merge3(base, ours, theirs)
    expect(m.watch.lastScan).toBe(9)
    expect(m.watch.txs.map((t: any) => t.digest)).toEqual(['y', 'x'])
    expect(m.picks.map((p: any) => p.qid)).toEqual(['a', 'b'])
    expect(m.memoryIds.sort()).toEqual(['m1', 'm2', 'm3'])
    expect(m.watch.rules.map((r: any) => r.id)).toEqual(['r2'])
    expect(m.seen).toBe(3)
  })
  it('takes our edit of an item the other side left alone', () => {
    const ours = structuredClone(base)
    ours.picks[0].p = 7
    const theirs = structuredClone(base)
    theirs.memoryIds.push('m9')
    const m = merge3(base, ours, theirs)
    expect(m.picks[0].p).toBe(7)
    expect(m.memoryIds).toEqual(['m1', 'm9'])
  })
})
