# PayAgent — Secure payments for AI agents, executed deterministically

> **AI requests. Policies control. Humans approve when necessary. KeeperHub executes exactly what was approved — from your own wallet.**

Live: Telegram [@PayagentPayBot](https://t.me/PayagentPayBot) · Backend `https://payagent-production-a628.up.railway.app`
Demo video: `PayAgent_demo_video.mp4` (also unlisted YouTube) · Onchain proof: `TX_PROOF.md`

## The problem

AI agents are being asked to move real money, and they are probabilistically bad at it.
An agent told to "pay 0.50 USDC to the worker" reinterprets the amount, the address, or the
token at execution time — mis-encoded calldata, re-called approvals, underfunded gas, a
silent failure at 3am with no audit trail. Onchain value transfer does not forgive that.

The existing workarounds are worse:

1. **Hand the agent your private key.** One hallucinated recipient and your wallet is drained.
   No policy, no approval, no undo.
2. **Shared bot wallets.** Telegram payment bots custody one pooled wallet for everybody:
   anyone can spend anyone's money, accounting is a spreadsheet, and a single leaked server
   key takes the whole pool.
3. **No human in the loop.** Fully autonomous payment agents can't distinguish a $0.50
   routine payout from a $5,000 mistake — because the distinction was never encoded anywhere.

So teams either don't let agents touch money (losing the entire use case) or let them touch
it dangerously.

## What PayAgent solves

PayAgent is a Telegram-native payment desk that splits the job the way it should be split:
**the agent (or human) only ever proposes. Deterministic code disposes.**

| Problem | PayAgent answer |
|---|---|
| Agent reinterprets payments | Canonical intent + `sha256` intent-hash locked at proposal time. Any change before execution → `INTENT_CHANGED`, execution blocked, fresh approval required. The LLM only extracts intent; it can never invent recipients, amounts, or touch the chain. |
| No spending discipline | Deterministic policy engine: auto-execute ≤ $1, human approval $1–$10, hard reject above. Daily caps computed from persisted settlements (UTC), per-wallet. Invalid addresses, wrong tokens, and unknown networks die before anything onchain is touched. |
| Shared-wallet theft | **There is no shared wallet.** `/connect kh_yourKey` is mandatory: every user attaches their own KeeperHub key (AES-256-GCM encrypted at rest) and pays from *their own* Turnkey wallet under *their* credential. Unconnected users can't pay at all — they get onboarding steps, not a transaction. Nobody can ever spend anybody else's money. |
| Midnight execution failures | KeeperHub is the sole execution layer: `simulate:true` dry-run first (reverts, bad addresses, empty balances refused pre-broadcast), stable `Idempotency-Key` so duplicate taps never double-spend, `GET /api/execute/{id}/status` honoring the poll hint, `receipts[].verified:true` as audit proof. Turnkey non-custodial wallets, sponsored gas — no private keys anywhere in the app. |
| "What just happened?" | 16-event audit trail per payment (`PAYMENT_CREATED` → `EXECUTION_SUCCEEDED`, approvals, rejections, tamper blocks), queryable in Telegram (`/history`, `/status P-102`) and over REST (`/api/proposals/:id/audit`). |

Flow:

```
Telegram → intent parse (regex/LLM) → Zod → policy engine → KeeperHub validate + dry-run
  → auto-approve (≤$1) / human approve ($1–$10) / reject (>$10)
  → intent-hash lock check → KeeperHub execute (payer's own credential)
  → verified receipt → Telegram receipt + audit
```

## Why KeeperHub

- `POST /api/execute/transfer` with `simulate:true` first — proven in production logs: an
  unfunded Base Sepolia wallet reverted at dry-run and nothing was broadcast.
- Stable `Idempotency-Key` (`sha256(chat|msg|proposal|chain|recipient|amount|token)`) —
  replays return the original execution instead of moving money twice.
- Receipts re-fetched from chain (`verified`, `receiptStatus`) — proof, not self-reporting.
- Per-user credentials map 1:1 onto KeeperHub org wallets, which is what makes BYO-wallet
  mode possible with zero custom custody.

## Setup

1. `cp .env.example .env` and fill:
   - `TELEGRAM_BOT_TOKEN` from [@BotFather](https://t.me/BotFather) (live bot: [@PayagentPayBot](https://t.me/PayagentPayBot))
   - `KEEPERHUB_API_KEY` (`kh_...`, Settings → Developer → API keys → Organisation)
   - `ENCRYPTION_KEY` — generate once, never share:
     `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   - Policy limits are env-driven (`PAYMENT_AUTO_APPROVE_LIMIT_USD`, etc.)
2. `pnpm install`
3. `pnpm exec prisma db push` (SQLite, no Docker needed)
4. `pnpm dev` — API on `:8788` + Telegram bot polling.

Chain default: `ethereum-sepolia` (11155111, funded/proven). `base-sepolia` (84532)
works identically — fund the Turnkey wallet via https://faucet.circle.com first.

## Deploy (Railway — live URL for judges)

1. [railway.app](https://railway.app) → New Project → **Deploy from GitHub repo** → select `PayAgent`.
2. Add a **Volume**, mount path `/app/data` (SQLite survives restarts).
3. **Variables**: `TELEGRAM_BOT_TOKEN`, `KEEPERHUB_API_KEY`, `ENCRYPTION_KEY`,
   `DATABASE_URL=file:/app/data/prod.db` (+ policy vars as needed; RPC/chain defaults work).
4. Deploy — Railway builds via `Dockerfile` and runs `prisma db push && node dist/src/index.js`.
5. Open the Railway public domain `/health` → `{"ok":true}` = judges can reach it.
6. **Stop your local bot** (`Ctrl+C`) once deployed — two pollers on one token steal each other's updates (409).

## Telegram

| Command | Use |
|---|---|
| `/pay 0.50 USDC 0x...` or `Pay 0.5 USDC to 0x...` | request payment |
| `/pending` | pending approvals (inline APPROVE/REJECT) |
| `/history` | recent payments + tx hashes |
| `/status P-101` | proposal + policy + KeeperHub + audit |
| `/balance 0xWALLET [chain]` | onchain USDC/ETH (RPC, never faked) |
| `/connect kh_...` | pay from YOUR wallet (private chat, then delete the message) |
| `/whoami` | which wallet you pay from + your spend |
| `/disconnect` | wipe your key, back to shared desk |
| `/policy`, `/cancel P-101`, `/start`, `/help` | policy view, cancel, help |

Missing amount/recipient is never guessed — the bot asks for it.

## Pay from your own wallet (/connect — required)

There is no shared or desk wallet: `/connect` is the front door. Any `/pay` (or `/whoami`)
from an unconnected user replies with the onboarding steps instead of a transaction:

1. Create a free account at `app.keeperhub.com` → Settings → Developer → API keys → Organisation key.
2. Fund that wallet with Sepolia USDC (faucet).
3. In a **private chat** with the bot: `/connect kh_yourKey` → bot validates the key,
   discovers the wallet via a harmless dry-run, stores the key **AES-256-GCM encrypted**
   (`ENCRYPTION_KEY`), and shows your wallet + balances. Delete your message after.
4. `/whoami` — which wallet you pay from + your own daily spend. `/disconnect` — wipe the key.

Daily caps are per-wallet, counted from each user's own settlements. Approvals, policies,
and the intent-lock apply identically to everyone. The operator's `KEEPERHUB_API_KEY`
never funds user payments.

## Architecture

- `src/bot/` — Telegraf handlers (thin; all logic in services)
- `src/ai/intent-parser.ts` — deterministic regex + optional LLM, Zod-validated
- `src/payments/` — policy-engine, state-machine (12 states), payment-service, approval-service
- `src/integrations/keeperhub/` — `KeeperHubClient` (per-user key override, create/validate/dryRun/execute/status), workflow-builder
- `src/blockchain/` — viem RPC reads, explorer links
- `src/database/` — Prisma/SQLite (User + encrypted key, PaymentProposal + exec scope, Approval, Execution, AuditEvent)
- `src/audit/` — audited event types (incl. `WALLET_CONNECTED`, `INTENT_CHANGED`)
- `src/server/` — Fastify `GET /health`, `/api/proposals/:id`, `/api/proposals/:id/audit`, `/api/executions/:id`, `/api/stats`
- `src/utils/` — canonical intent + sha256 lock, AES-256-GCM secrets, cents-safe amounts, idempotency keys

## Security notes

- Intent lock: `sha256(canonical intent)` stored at proposal time; any change before
  execution → `INTENT_CHANGED`, execution blocked, new approval required.
- 12-state machine with legal-transition enforcement; proposals expire (`PROPOSAL_EXPIRY_MINUTES`).
- Daily spend computed from persisted `SUCCESS` rows (UTC day), scoped per-wallet — not chat history.
- User keys encrypted at rest, never logged, never echoed; key prefix only in audit metadata.
- No secrets in Telegram/logs/DB/API responses; `.env` gitignored.

## Testing

`pnpm test` — 13 tests: policy (valid/approval-route/ceiling/daily/token/chain/address),
intent hash determinism + tamper detection, state machine, parser no-guess, idempotency
stability, encryption roundtrip + wrong-key rejection, per-user scope resolution.
`pnpm exec tsc --noEmit` clean. KeeperHub paths verified live against testnet.

## Submission

- Live backend: `https://payagent-production-a628.up.railway.app` · bot [@PayagentPayBot](https://t.me/PayagentPayBot)
- Live txs (KeeperHub, Sepolia, `verified:true`, sponsored): execution `y5spn6wkh4tcbnx4v3z7g`
  (`0.05` USDC calibration) and `la32srnvrdsez1f8wjtmn` (`0.50` USDC real Telegram payment P-101) — see `TX_PROOF.md`.
- Demo video: unlisted YouTube link + `PayAgent_demo_video.mp4` (4 scenarios: auto-pay, approval, rejection, tamper-block).
- Surfaces: Telegram bot + REST direct execution (`/api/execute/transfer`) + audit trail.
- Contact: ujjwalmittal012@gmail.com / [@PayagentPayBot](https://t.me/PayagentPayBot)
