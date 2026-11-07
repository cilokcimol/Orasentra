# Orasentra

The memory that sees ahead.

Orasentra is a personal intelligence with a permanent memory. It forecasts beside you, keeps watch over your wallet, and keeps shared money straight. Every outcome is scored, written to Walrus Memory on mainnet, and used to weigh the next decision.

Live: https://orasentra.vercel.app

The name is the product: **ORA**cle for forecasting, **SEN**tinel for the agent that watches, **TRA**easury for everyday money.

## Oracle: markets, sport and elections

* Live binary questions from Polymarket across sport, elections, culture and crypto, plus SUI price questions that settle from the chain.
* You lock a probability before the event and can add the calls of people you follow. Orasentra adds the market price, or for SUI questions an onchain model built from the Cetus USDC/SUI pool.
* It blends every voice with weights from proven credibility, and flags when sources disagree by 20 points or more.
* After the outcome, every voice gets a Brier score against the baseline (the market, or the onchain model). Credibility only moves when a voice beats that baseline, shrunk toward neutral until evidence piles up. The next blend leans on it.
* Hindcast the crowd: Orasentra reads ten recently resolved markets in a category at their price 24 hours before close, and records how good the crowd really was there.

## Sentinel: an autonomous watch over a wallet

* Reads a Sui address through the Tatum gateway: every transaction that touched it, with balance changes, valued in dollars from the live pool price.
* The first check sets a baseline. Later checks flag spikes (three times the usual payment), first payments to a new payee, and payments over a limit you set.
* Your answers ("this is normal", "always tell me", "limit $20") become escalation rules, kept in memory.
* Repeating payments are detected from their timing, so subscriptions surface on their own.
* Every check resumes from where the last one stopped, on any device that holds the memory key.
* Ask "What did I spend last Tuesday?" and it answers from the payments it has seen.

## Treasury: money that simply makes sense

* Shared treasuries typed the way people talk: "Dinner 240k paid by Rina split Rina, Budi". Handles 240k, 1.2jt, Rp 150.000 and 12.50.
* Balances and the fewest payments to settle. Habits are noticed and remembered ("Arif usually pays for sushi").
* Savings goals whose weekly plan follows the real 30 day cash flow of the watched wallet, with the reason recorded each time the plan changes.
* Monthly limits for each subscription, learned from you.
* No wallet, no gas, no jargon.

## Archive and Status

The Archive shows how Orasentra learned over time: trust lines after each result, rules as they formed, plan changes, and every memory with a link to its Walrus blob. Status checks the memory network, the Sui gateway and market data live.

## How Walrus Memory is used

* Client: `@mysten-incubation/memwal` against the mainnet relayer `https://relayer.memory.walrus.xyz`.
* One namespace per archive (`os-<hash>`) and one per shared treasury (`os-g-<id>`).
* Every meaningful event is written as one plain English memory: logged calls with every voice and weight, scorecards with trust updates, crowd hindcasts, wallet baselines and resumes, flagged payments, learned rules, shared expenses and settlements with balances, goal plans and subscription limits.
* Each remember job is polled until Walrus returns a blob id; the Archive and Status pages link to it on Walruscan.
* Ask Orasentra recalls memories by meaning across your namespaces and answers from them, with exact figures computed alongside. Gemini drafts the answer when `GEMINI_API_KEY` is set; otherwise the answer is assembled from the memories and figures directly.

No sign up: the browser creates a private memory key and the server stores only its hash. The same key on another device opens the same memory.

## How Tatum is used

All Sui mainnet reads go through the Tatum gateway, using Sui's gRPC API (`sui.rpc.v2`) at `sui-mainnet-grpc.gateway.tatum.io`, authenticated with `x-api-key`:

* `LedgerService.GetObject` on the Cetus USDC/SUI pool to price SUI from its sqrt price, sample volatility, and settle the SUI questions
* `LedgerService.ListTransactions` filtered by affected address, with balance changes, for the Sentinel
* `LedgerService.GetServiceInfo` and `StateService.ListBalances` for chain status and balances

Reads are counted and shown on the Status page. The Sui protobuf definitions are vendored in `proto/` (Apache 2.0, from MystenLabs/sui-apis).

## Stack

Vite and TypeScript, Three.js for the relic scene and aurora shader, one Vercel function for the API, Vercel Blob (private) for the fast working copy of state, and Walrus Memory as the permanent record.

## Run it

```
npm install
cp .env.example .env      # fill in the keys
npm run dev:api           # API on :8787
npm run dev               # site on :5173
npm test
```

Without keys the app runs with the official Walrus Memory mock and wallet reading is off. `scripts/seed.ts` exercises every room against a deployment.

## Limits

* Memories are stored under the app's Walrus Memory account, one namespace per archive and per shared treasury.
* The Sentinel is read only and limited to the history the gateway keeps.
* Polymarket questions settle when Polymarket settles; SUI questions settle at the first chain read after their close, and the delay is recorded with the result.
