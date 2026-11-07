// A keeper is one person using Orasentra. No account: the browser holds a secret keeper key,
// the server only ever sees its hash. The same key on another device opens the same memory.

import { createHash } from "node:crypto";
import { read, withLock, write } from "./store.js";

export interface VoiceStats {
  kind: "you" | "market" | "onchain" | "orasentra" | "friend";
  n: number;
  brierSum: number;
  baseSum: number;
  beat: number;
  cred: number;
  history: { t: number; cred: number }[];
}

export interface Pick {
  qid: string;
  title: string;
  side: string;
  category: string;
  closesAt: number;
  at: number;
  probs: Record<string, number>;
  weights: Record<string, number>;
  disagreement: number;
  scored?: {
    outcome: 0 | 1;
    brier: Record<string, number>;
    at: number;
    winner: string;
  };
}

export interface WatchTx {
  digest: string;
  t: number;
  usd: number;
  dir: "out" | "in";
  counterparty: string;
  coin: string;
  amount: number;
}

export interface WatchRule {
  id: string;
  scope: string;
  label: string;
  limitUsd: number;
  reason: string;
  at: number;
}

export interface WatchAlert {
  id: string;
  digest: string;
  t: number;
  kind: "spike" | "new_payee" | "recurring" | "over_limit";
  text: string;
  usd: number;
  counterparty: string;
  status: "open" | "normal" | "always" | "limit";
}

export interface Keeper {
  id: string;
  created: number;
  seen: number;
  name?: string;
  currency: "USD" | "IDR";
  voices: Record<string, VoiceStats>;
  picks: Pick[];
  watch: {
    address?: string;
    lastDigest?: string;
    lastScan?: number;
    txs: WatchTx[];
    labels: Record<string, string>;
    rules: WatchRule[];
    alerts: WatchAlert[];
    recurring: {
      counterparty: string;
      label: string;
      usd: number;
      everyDays: number;
      count: number;
      capUsd?: number;
    }[];
  };
  pocket: {
    groups: string[];
    goals: Goal[];
  };
  learned: { t: number; room: string; text: string }[];
  memoryIds: string[];
}

export interface Goal {
  id: string;
  name: string;
  target: number;
  saved: number;
  by: number;
  weekly: number;
  plan: { t: number; weekly: number; why: string }[];
}

export const keeperHash = (secret: string) =>
  createHash("sha256").update(`orasentra:${secret}`).digest("hex").slice(0, 24);
export const keeperNs = (hash: string) => `os-${hash}`;

const fresh = (id: string): Keeper => ({
  id,
  created: Date.now(),
  seen: Date.now(),
  currency: "USD",
  voices: {},
  picks: [],
  watch: { txs: [], labels: {}, rules: [], alerts: [], recurring: [] },
  pocket: { groups: [], goals: [] },
  learned: [],
  memoryIds: [],
});

export function keeperFrom(req: Request): string {
  const secret = req.headers.get("x-orasentra-key") || "";
  if (!/^[a-f0-9]{32,64}$/.test(secret))
    throw new HttpError(
      401,
      "Missing keeper key. Reload the page to create one.",
    );
  return keeperHash(secret);
}

const shape = (hash: string, k: Keeper | null): Keeper =>
  k
    ? {
        ...fresh(hash),
        ...k,
        watch: { ...fresh(hash).watch, ...k.watch },
        pocket: { ...fresh(hash).pocket, ...k.pocket },
      }
    : fresh(hash);

// What each request loaded, so a save can tell its own changes from changes other requests made meanwhile.
const loaded = new WeakMap<Keeper, string>();

export async function loadKeeper(hash: string): Promise<Keeper> {
  const out = shape(hash, await read<Keeper | null>(`k/${hash}.json`, null));
  loaded.set(out, JSON.stringify(out));
  out.seen = Date.now();
  return out;
}

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const isObj = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);
const itemKey = (x: any): string =>
  isObj(x)
    ? String(
        x.id ??
          x.qid ??
          x.digest ??
          (x.t !== undefined && x.text !== undefined
            ? `${x.t}|${x.text}`
            : JSON.stringify(x)),
      )
    : JSON.stringify(x);

/** Three way merge: base is what this request loaded, ours is what it wants to save, theirs is what is stored now. */
export function merge3(base: any, ours: any, theirs: any): any {
  if (same(ours, base)) return theirs;
  if (same(theirs, base) || theirs === undefined) return ours;
  if (isObj(ours) && isObj(theirs)) {
    const b = isObj(base) ? base : {};
    const out: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(theirs), ...Object.keys(ours)]))
      out[key] = merge3(b[key], ours[key], theirs[key]);
    return out;
  }
  if (Array.isArray(ours) && Array.isArray(theirs)) {
    const b = new Map(
      (Array.isArray(base) ? base : []).map((x) => [itemKey(x), x]),
    );
    const t = new Map(theirs.map((x) => [itemKey(x), x]));
    const o = new Set(ours.map(itemKey));
    const out: unknown[] = [];
    for (const x of ours) {
      const key = itemKey(x);
      const was = b.get(key);
      if (was !== undefined && same(x, was)) {
        if (!t.has(key)) continue; // the other request removed it
        out.push(t.get(key)); // unchanged here, take their version
      } else out.push(x);
    }
    for (const x of theirs) {
      const key = itemKey(x);
      if (!o.has(key) && !b.has(key)) out.push(x); // added by the other request
    }
    return out;
  }
  return ours;
}

export async function saveKeeper(k: Keeper) {
  const path = `k/${k.id}.json`;
  return withLock(`k-${k.id}`, async () => {
    const base = loaded.get(k);
    let next: Keeper = k;
    if (base) {
      const now = await read<Keeper | null>(path, null);
      const stored = now ? JSON.stringify(shape(k.id, now)) : null;
      if (stored && stored !== base)
        next = merge3(JSON.parse(base), k, JSON.parse(stored)) as Keeper;
    }
    next.picks = next.picks.slice(-300);
    next.learned = next.learned.slice(-200);
    next.watch.txs = next.watch.txs.sort((a, b) => b.t - a.t).slice(0, 300);
    next.watch.alerts = next.watch.alerts
      .sort((a, b) => b.t - a.t)
      .slice(0, 120);
    next.memoryIds = next.memoryIds.slice(-500);
    await write(path, next);
    loaded.set(next, JSON.stringify(next));
    return next;
  });
}

export function learn(k: Keeper, room: string, text: string) {
  k.learned.push({ t: Date.now(), room, text });
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
