# Orasentra

Hindsight, kept. One agent with one long memory, built for the Tatum x Walrus Total Recall hackathon.

Orasentra remembers every call you make before an event, every payment that leaves your wallet and every debt in your group. It learns who to trust, what is normal for you and how much you can really save, and it keeps that record on Walrus Memory mainnet. Sui data comes through the Tatum RPC gateway.

Live: https://orasentra.vercel.app (set after deploy)

## Three rooms, one memory

**Calls** (Markets and Sports Prediction). Live questions from Polymarket across sports, elections, culture and crypto, plus SUI price questions that settle from the Cetus USDC pool read through Tatum. You log a probability before the event and can add the calls of people you follow. Orasentra blends every voice, flags when sources disagree, and after the result scores each voice with a Brier score against the baseline (the market, or the onchain model). Credibility only moves when a voice beats that baseline, and the next blend leans on it. A replay mode hindcasts the crowd: it reads ten recently resolved markets at their price 24 hours before close and writes down how good the crowd was in that category.

**Watch** (Smart Agents for Real Life). An expense watchdog for a Sui wallet. It reads payments and balance changes through Tatum (`suix_queryTransactionBlocks`, `sui_getObject`), sets a baseline, then flags spikes, first payments to a new payee and payments over a limit. Your answers ("this is normal", "always tell me", "limit $20") become escalation rules stored in memory. It finds repeating payments by their timing. Every check starts from where the last one stopped, on any device that holds your memory key. Ask "What did I spend last Tuesday?" and it answers.

**Pocket** (Consumer Finance). Shared pots you type in plain words ("Dinner 240k paid by Rina split Rina, Budi") with balances and the fewest payments to settle. Savings goals that re plan their weekly amount from the real 30 day cash flow Watch sees. Subscription limits learned from you. No wallet, no gas, no crypto words.

**Ledger** shows how Orasentra learned over time: trust lines after each result, rules as they formed, plan changes, and every memory with its Walrus blob id.

## How Walrus Memory is used

Each keeper gets a namespace (`os-<hash>`); each pot gets its own (`os-g-<id>`). Every meaningful event is written as one plain English memory through the Walrus Memory relayer on mainnet (`@mysten-incubation/memwal`): logged calls, scorecards with trust updates, crowd replays, wallet baselines and resumes, flagged payments, learned rules, expenses and settlements with the current balances, goal plans and subscription limits. Ask Orasentra recalls them by meaning and answers from them. The app polls each remember job until Walrus returns a blob id, and the Ledger links to it.

No sign up: the browser creates a private memory key; the server stores only its hash. Paste the key on another device to continue the same memory.

## How Tatum is used

All Sui mainnet reads go through `https://sui-mainnet.gateway.tatum.io`:

- `sui_getObject` on the Cetus USDC/SUI pool, to price SUI from its sqrt price and settle the onchain questions
- `suix_queryTransactionBlocks` with balance changes, from and to the watched address, for Watch
- reads are counted and shown on the judge page

## Run it

```
npm install
cp .env.example .env      # fill in the keys
npm run dev:api           # API on :8787
npm run dev               # site on :5173
npm test
```

Without keys the app runs in mock memory mode using the official MemWal mock, and wallet reading is off.

Deploy on Vercel: import the repo, add the environment variables from `.env.example`, connect a Blob store (private) for the working copy of state. `scripts/seed.ts` exercises every room against a deployment.

## Honest limits

- Memories are stored under the app's Walrus Memory account, one namespace per keeper and per pot.
- Watch is read only and limited to the history the RPC gateway keeps.
- Polymarket questions settle when Polymarket settles; onchain questions settle at the first read after their close, and the delay is recorded.
- Ask uses Gemini only if `GEMINI_API_KEY` is set; otherwise it answers from recalled memories and exact numbers.
