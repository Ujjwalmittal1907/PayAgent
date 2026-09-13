# PayAgent — Secure payments for AI agents, executed deterministically

> **AI requests. Policies control. Humans approve when necessary. KeeperHub executes exactly what was approved.**

PayAgent is a Telegram-native payment desk where an AI agent (or human) requests an onchain
payment in natural language, a deterministic policy engine gates it, a human approves it when
required via inline buttons, and **KeeperHub** performs the actual value movement with
simulate-first + idempotency-key + verified-receipt guarantees.

```
Telegram → intent parse (regex/LLM) → Zod → policy engine → KeeperHub validate + dry-run
  → auto-approve (≤$1) / human approve ($1–$10) / reject (>$10)
  → intent-hash lock check → KeeperHub execute → verified receipt → Telegram receipt + audit
```

The LLM **only** extracts intent. It can never invent recipients/amounts, bypass policy,
or touch the chain. KeeperHub is the sole execution layer.

## Why KeeperHub

- `POST /api/execute/transfer` with `simulate:true` first — reverts, bad addresses,
  insufficient balances die before broadcast (proven: Base Sepolia USDC unfunded-wallet
  revert correctly refused).
- Stable `Idempotency-Key` (`sha256(chat|msg|proposal|chain|recipient|amount|token)`) —
  duplicate Telegram taps never double-spend; replays return the original execution.
- `GET /api/execute/{id}/status` honoring `X-Poll-Interval-Hint`; `receipts[].verified:true`
  is the audit proof, not self-reported hashes.
- Turnkey non-custodial wallet + sponsored gas — no private keys in the app.

## Setup

1. `cp .env.example .env` and fill:
   - `TELEGRAM_BOT_TOKEN` from [@BotFather](https://t.me/BotFather) (live bot: [@PayagentPayBot](https://t.me/PayagentPayBot))
   - `KEEPERHUB_API_KEY` (`kh_...`, Settings → Developer → API keys → Organisation)
   - Policy limits are env-driven (`PAYMENT_AUTO_APPROVE_LIMIT_USD`, etc.)
2. `pnpm install`
3. `pnpm exec prisma db push` (SQLite, no Docker needed)
4. `pnpm dev` — API on `:8788` + Telegram bot polling.

Chain default: `ethereum-sepolia` (11155111, funded/proven). `base-sepolia` (84532)
works identically — fund the Turnkey wallet via https://faucet.circle.com first.

## Telegram

| Command | Use |
|---|---|
| `/pay 0.50 USDC 0x...` or `Pay 0.5 USDC to 0x...` | request payment |
| `/pending` | pending approvals (inline APPROVE/REJECT) |
| `/history` | recent payments + tx hashes |
| `/status P-101` | proposal + policy + KeeperHub + audit |
| `/balance 0xWALLET [chain]` | onchain USDC/ETH (RPC, never faked) |
| `/policy`, `/cancel P-101`, `/start`, `/help` | policy view, cancel, help |

Missing amount/recipient is never guessed — the bot asks for it.

## Architecture

- `src/bot/` — Telegraf handlers (thin; all logic in services)
- `src/ai/intent-parser.ts` — deterministic regex + optional LLM, Zod-validated
- `src/payments/` — policy-engine, state-machine (12 states), payment-service, approval-service
- `src/integrations/keeperhub/` — `KeeperHubClient` (create/validate/dryRun/execute/status), workflow-builder
- `src/blockchain/` — viem RPC reads, explorer links
- `src/database/` — Prisma/SQLite (User, PaymentProposal, Approval, Execution, AuditEvent)
- `src/audit/` — 16 audited event types
- `src/server/` — Fastify `GET /health`, `/api/proposals/:id`, `/api/proposals/:id/audit`, `/api/executions/:id`, `/api/stats`
- `src/utils/validation.ts` — canonical intent, sha256 intent-hash, cents-safe amounts, idempotency keys

## Security notes

- Intent lock: `sha256(canonical intent)` stored at proposal time; any change before
  execution → `INTENT_CHANGED`, execution blocked, new approval required.
- 12-state machine with legal-transition enforcement; proposals expire (`PROPOSAL_EXPIRY_MINUTES`).
- Daily spend computed from persisted `SUCCESS` rows (UTC day), not chat history.
- No secrets in Telegram/logs/DB/API responses; `.env` gitignored.

## Testing

`pnpm test` — 11 tests: policy (valid/approval-route/ceiling/daily/token/chain/address),
intent hash determinism + tamper detection, state machine, parser no-guess, idempotency stability.
`pnpm exec tsc --noEmit` clean. KeeperHub tests run live against testnet when credentials exist.

## Submission

- Live tx (KeeperHub, Sepolia): `0xa6544c3963138eda20633fa23ce125ed06efff31f8e11e8de7842f505d0321d6`
  (execution `y5spn6wkh4tcbnx4v3z7g`, `verified:true`, sponsored) — see `TX_PROOF.md`.
- Demo video: unlisted YouTube link, 90–120s (4 scenarios: auto-pay, approval, rejection, tamper-block).
- Surfaces: Telegram bot + REST direct execution (`/api/execute/transfer`) + audit trail.
