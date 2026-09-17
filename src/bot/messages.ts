import { escHtml, shortAddress } from "../utils/validation.js";

export function helpText(): string {
  return [
    "<b>PayAgent</b> — Secure payments for AI agents, executed deterministically from YOUR wallet.",
    "",
    "First: <code>/connect kh_...</code> — nothing works until you connect your own KeeperHub key.",
    "",
    "/pay <code>0.50 USDC 0xRECIPIENT</code> — request payment",
    "/pending — pending approvals",
    "/history — recent payments",
    "/status <code>P-101</code> — proposal detail",
    "/balance <code>0xWALLET</code> — Base Sepolia balances",
    "/policy — spending policy",
    "/whoami — your wallet + spend",
    "/disconnect — wipe your key",
    "/cancel <code>P-101</code> — cancel proposal",
    "",
    "Natural language also works: <i>Pay 0.5 USDC to 0xABC...</i>",
  ].join("\n");
}

export function proposalSummary(p: {
  shortId: string;
  amount: string;
  token: string;
  recipient: string;
  chain: string;
  purpose: string | null;
  status: string;
}): string {
  return [
    `🔎 <b>PAYMENT REQUEST ${escHtml(p.shortId)}</b>`,
    ``,
    `Amount: <code>${escHtml(p.amount)} ${escHtml(p.token)}</code>`,
    `Recipient: <code>${escHtml(p.recipient)}</code> (${escHtml(shortAddress(p.recipient))})`,
    `Network: ${escHtml(p.chain)}`,
    `Purpose: ${escHtml(p.purpose ?? "Not specified")}`,
    `Status: ${escHtml(p.status)}`,
  ].join("\n");
}

export function policyText(checks: { name: string; status: string; detail?: string }[]): string {
  return ["<b>POLICY CHECK</b>", ...checks.map((c) => `${c.status === "PASS" ? "✓" : "✗"} ${escHtml(c.name)}${c.detail ? ` — ${escHtml(c.detail)}` : ""}`)].join("\n");
}

export function keeperText(ok: boolean, detail?: string): string {
  return ["<b>KEEPERHUB CHECK</b>", `✓ Workflow created`, ok ? `✓ Validation passed` : `✗ Validation failed`, ok ? `✓ Dry run passed` : `✗ Dry run failed${detail ? `: ${escHtml(detail)}` : ""}`].join("\n");
}

export function connectRequiredText(): string {
  return [
    "🔌 <b>CONNECT YOUR WALLET FIRST</b>",
    "",
    "PayAgent never holds shared funds — every payment spends from <b>your own</b> KeeperHub wallet. Setup takes 2 minutes, once:",
    "",
    "1️⃣ Create a free account at <b>app.keeperhub.com</b> (a Turnkey wallet is auto-created for you)",
    "2️⃣ Settings → Developer → API keys → create an <b>Organisation key</b> (<code>kh_...</code>)",
    "3️⃣ Fund your wallet with Sepolia USDC from the faucet: <b>faucet.circle.com</b>",
    "4️⃣ Send here (private chat only):",
    "<code>/connect kh_yourKeyHere</code>",
    "5️⃣ Delete your /connect message, then check <b>/whoami</b>",
    "6️⃣ Pay: <code>/pay 0.50 USDC 0xRECIPIENT</code>",
    "",
    "Your key is encrypted on this server, never logged, and <b>/disconnect</b> wipes it anytime.",
  ].join("\n");
}
