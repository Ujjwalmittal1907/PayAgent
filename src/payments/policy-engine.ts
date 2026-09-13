import { allowedNetworks, allowedRecipients, allowedTokens, env } from "../config/env.js";
import { canonicalAmount, isValidEvmAddress, toCents } from "../utils/validation.js";

export interface PolicyCheck {
  name: string;
  status: "PASS" | "FAIL";
  detail?: string;
}

export interface PolicyResult {
  allowed: boolean;
  reason?: string;
  checks: PolicyCheck[];
  requiresApproval: boolean;
}

export function evaluatePolicy(input: {
  amount: string;
  token: string;
  recipient: string;
  chain: string;
  spentTodayCents: bigint;
}): PolicyResult {
  const checks: PolicyCheck[] = [];
  const fail = (name: string, detail: string): PolicyResult => {
    checks.push({ name, status: "FAIL", detail });
    return { allowed: false, reason: detail, checks, requiresApproval: false };
  };

  // amount > 0
  let canon: string;
  try {
    canon = canonicalAmount(input.amount);
    if (toCents(canon) <= 0n) return fail("amount_positive", "Payment amount must be > 0");
    checks.push({ name: "amount_positive", status: "PASS" });
  } catch (e) {
    return fail("amount_positive", e instanceof Error ? e.message : "Invalid amount");
  }

  // address
  if (!isValidEvmAddress(input.recipient)) return fail("recipient_format", "Recipient must be a valid 0x EVM address");
  checks.push({ name: "recipient_format", status: "PASS" });

  // token
  if (!allowedTokens.includes(input.token.toUpperCase()))
    return fail("token_allowed", `Token ${input.token} not allowed (allowed: ${allowedTokens.join(",")})`);
  checks.push({ name: "token_allowed", status: "PASS" });

  // network
  if (!allowedNetworks.includes(input.chain.toLowerCase()))
    return fail("network_allowed", `Network ${input.chain} not allowed`);
  checks.push({ name: "network_allowed", status: "PASS" });

  // allowlist
  if (allowedRecipients.length > 0 && !allowedRecipients.includes(input.recipient.toLowerCase()))
    return fail("recipient_allowlist", "Recipient not in allowlist");
  checks.push({ name: "recipient_allowlist", status: "PASS" });

  // single max (USD 1:1 USDC)
  const amountCents = toCents(canon);
  if (amountCents > BigInt(Math.round(env.MAX_SINGLE_PAYMENT_USD * 100)))
    return fail("single_payment_limit", `Single-payment limit exceeded (max $${env.MAX_SINGLE_PAYMENT_USD})`);
  checks.push({ name: "single_payment_limit", status: "PASS" });

  // daily
  const dailyCap = BigInt(Math.round(env.PAYMENT_DAILY_LIMIT_USD * 100));
  if (input.spentTodayCents + amountCents > dailyCap)
    return fail(
      "daily_limit",
      `Daily spending limit exceeded (spent $${Number(input.spentTodayCents) / 100}, limit $${env.PAYMENT_DAILY_LIMIT_USD})`,
    );
  checks.push({ name: "daily_limit", status: "PASS" });

  const requiresApproval = Number(canon) > env.PAYMENT_AUTO_APPROVE_LIMIT_USD;
  if (Number(canon) > env.PAYMENT_HUMAN_APPROVAL_LIMIT_USD)
    return fail("human_approval_ceiling", `Amount exceeds human-approval ceiling ($${env.PAYMENT_HUMAN_APPROVAL_LIMIT_USD}) — rejected, no execution`);
  checks.push({ name: "approval_routing", status: "PASS", detail: requiresApproval ? "human approval" : "auto" });

  return { allowed: true, checks, requiresApproval };
}
