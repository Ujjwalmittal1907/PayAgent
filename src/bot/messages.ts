import { escHtml, shortAddress } from "../utils/validation.js";

export function helpText(): string {
  return [
    "<b>PayAgent</b> — Secure payments for AI agents, executed deterministically.",
    "",
    "/pay <code>0.50 USDC 0xRECIPIENT</code> — request payment",
    "/pending — pending approvals",
    "/history — recent payments",
    "/status <code>P-101</code> — proposal detail",
    "/balance <code>0xWALLET</code> — Base Sepolia balances",
    "/policy — spending policy",
    "/connect kh_... — pay from YOUR wallet",
    "/whoami — which wallet you pay from",
    "/disconnect — back to shared desk",
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
