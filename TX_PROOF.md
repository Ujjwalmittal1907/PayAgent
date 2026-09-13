# TX_PROOF.md — PayAgent live KeeperHub execution

## tx #1 — calibration (Ethereum Sepolia, Sep 13 2026)

- Path: `POST /api/execute/transfer` simulate (`success:true`, `wouldRevert:false`)
  → broadcast with `Idempotency-Key: payagent-calibration-001`
  → `GET /api/execute/{id}/status` to `completed`
- Execution ID: `y5spn6wkh4tcbnx4v3z7g`
- Status: `completed`
- Tx: https://sepolia.etherscan.io/tx/0xa6544c3963138eda20633fa23ce125ed06efff31f8e11e8de7842f505d0321d6
- Receipt: `verified:true`, `receiptStatus:success`, block `11697690`, gas `67338`
- Sponsored: `true` (KeeperHub gas sponsorship)
- Moved: `0.05` test USDC (Sepolia `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`)
  → `0xdf14c4FcF3FBA4953CF30c9CD491e4C0536eD09F`

## tx #2 — first real PayAgent Telegram payment P-101 (Ethereum Sepolia, Sep 13 2026)

- Flow: Telegram `/pay 0.50 USDC 0xdf14...D09F` → policy all-PASS → KeeperHub
  validate + dry-run PASS → auto-approved (≤ $1) → executed
- Execution ID: `la32srnvrdsez1f8wjtmn`
- Status: `completed`
- Tx: https://sepolia.etherscan.io/tx/0xdee4a47e1b3d3c77adc642166cdecfa7ab532f9a83d0c837c568c84875d21019
- Receipt: `verified:true`, `receiptStatus:success`, block `11697768`, gas `67350`
- Sponsored: `true`
- Moved: `0.50` test USDC → `0xdf14c4FcF3FBA4953CF30c9CD491e4C0536eD09F`

## Negative proof — dry-run correctly refused (Base Sepolia, same day)

- Same flow with `0.10` USDC on `84532` (token `0x036CbD53842c5426634e7929541eC2318f3dCF7e`)
- Result: HTTP 400 `wouldRevert:true`, `ERC20: transfer amount exceeds balance`
- Nothing broadcast — the simulate-first guard works exactly as designed.
- (Also caught a truncated token address from a stale `.env.example` — `tokenAddress
  must be a valid hex address` — corrected to Circle's documented Base Sepolia USDC.)
