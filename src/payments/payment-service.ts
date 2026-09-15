import { approverIds, DEFAULT_CHAIN, env } from "../config/env.js";
import { db, allocateShortId, spentTodayCents } from "../database/prisma.js";
import { audit } from "../audit/audit-service.js";
import { KeeperHubClient, keeperHub } from "../integrations/keeperhub/client.js";
import { decryptSecret } from "../utils/crypto.js";
import { buildTransferInput } from "../integrations/keeperhub/workflow-builder.js";
import { evaluatePolicy } from "./policy-engine.js";
import { assertTransition, type PaymentStatus } from "./state-machine.js";
import { canonicalizeIntent, intentHash, stableIdempotencyKey } from "../utils/validation.js";

export interface CreateProposalInput {
  telegramUserId: string;
  telegramUsername?: string;
  telegramChatId: string;
  telegramMessageId: number;
  amount: string;
  token: string;
  recipient: string;
  chain?: string;
  purpose?: string | null;
}

export async function createProposal(input: CreateProposalInput) {
  const prisma = db();
  let user = await prisma.user.findUnique({ where: { telegramUserId: input.telegramUserId } });
  if (!user)
    user = await prisma.user.create({
      data: { telegramUserId: input.telegramUserId, telegramUsername: input.telegramUsername },
    });

  const chain = (input.chain ?? DEFAULT_CHAIN).toLowerCase();
  const { client: kh, scope, wallet } = clientForUser(user);
  // Daily cap is per-wallet: org-scope counts all desk spend (protects shared funds),
  // user-scope counts only that user's spend.
  const spent = await spentTodayCents(scope, scope === "user" ? user.id : undefined);
  const policy = evaluatePolicy({ amount: input.amount, token: input.token, recipient: input.recipient, chain, spentTodayCents: spent });

  const intent = { amount: input.amount, token: input.token.toUpperCase(), recipient: input.recipient, chain, purpose: input.purpose ?? null };
  const hash = intentHash(intent);
  const shortId = await allocateShortId();
  const idem = stableIdempotencyKey([input.telegramChatId, input.telegramMessageId, shortId, chain, input.recipient, input.amount, input.token]);
  const expiresAt = new Date(Date.now() + env.PROPOSAL_EXPIRY_MINUTES * 60_000);

  const proposal = await prisma.paymentProposal.create({
    data: {
      shortId,
      userId: user.id,
      amount: input.amount,
      token: input.token.toUpperCase(),
      recipient: input.recipient,
      chain,
      purpose: input.purpose ?? null,
      intentHash: hash,
      status: "DRAFT",
      approvalRequired: policy.requiresApproval ?? false,
      requiredApprovals: env.REQUIRED_APPROVALS,
      idempotencyKey: idem,
      execScope: scope,
      execWallet: wallet,
      telegramChatId: input.telegramChatId,
      telegramMessageId: input.telegramMessageId,
      expiresAt,
    },
  });

  await audit(proposal.id, "PAYMENT_CREATED", { shortId, ...intent, intentHash: hash });
  await audit(proposal.id, "POLICY_CHECKED", { allowed: policy.allowed, checks: policy.checks });

  if (!policy.allowed) {
    await transition(proposal.id, "DRAFT", "POLICY_REJECTED");
    await audit(proposal.id, "POLICY_REJECTED", { reason: policy.reason });
    return { proposal: await prisma.paymentProposal.findUniqueOrThrow({ where: { id: proposal.id } }), policy, hash };
  }

  await transition(proposal.id, "DRAFT", "POLICY_APPROVED");

  // KeeperHub validate + dry-run (real, not mocked) — under the payer's own credential
  const transfer = buildTransferInput(intent);
  const validation = await kh.validateWorkflow(transfer);
  await audit(proposal.id, "WORKFLOW_CREATED", { transfer });
  if (!validation.valid) {
    await transition(proposal.id, "POLICY_APPROVED", "DRY_RUN_FAILED");
    await audit(proposal.id, "DRY_RUN_FAILED", { issues: validation.issues });
    const p = await prisma.paymentProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    return { proposal: p, policy, hash, dryRunError: validation.issues.join("; ") };
  }
  await audit(proposal.id, "WORKFLOW_VALIDATED", { valid: true });

  try {
    await audit(proposal.id, "DRY_RUN_STARTED", {});
    const sim = await kh.dryRunWorkflow(transfer);
    const ok = (sim as { success?: boolean; wouldRevert?: boolean }).success !== false && (sim as { wouldRevert?: boolean }).wouldRevert !== true;
    if (!ok) throw new Error(`Dry run refused: ${JSON.stringify(sim)}`);
    await audit(proposal.id, "DRY_RUN_SUCCEEDED", { sim });
  } catch (e) {
    await transition(proposal.id, "POLICY_APPROVED", "DRY_RUN_FAILED");
    await audit(proposal.id, "DRY_RUN_FAILED", { error: e instanceof Error ? e.message : String(e) });
    const p = await prisma.paymentProposal.findUniqueOrThrow({ where: { id: proposal.id } });
    return { proposal: p, policy, hash, dryRunError: e instanceof Error ? e.message : String(e) };
  }

  if (policy.requiresApproval) {
    await transition(proposal.id, "POLICY_APPROVED", "PENDING_APPROVAL");
    await audit(proposal.id, "APPROVAL_REQUESTED", { requiredApprovals: env.REQUIRED_APPROVALS });
  } else {
    await transition(proposal.id, "POLICY_APPROVED", "APPROVED");
  }
  const final = await prisma.paymentProposal.findUniqueOrThrow({ where: { id: proposal.id } });
  return { proposal: final, policy, hash };
}

export async function transition(proposalId: string, from: PaymentStatus, to: PaymentStatus) {
  assertTransition(from, to);
  const current = await db().paymentProposal.findUniqueOrThrow({ where: { id: proposalId } });
  if (current.status !== from) throw new Error(`Stale state: expected ${from}, found ${current.status}`);
  if (new Date() > current.expiresAt && ["PENDING_APPROVAL", "APPROVED", "DRAFT", "POLICY_APPROVED"].includes(current.status) && to !== "EXPIRED") {
    await db().paymentProposal.update({ where: { id: proposalId }, data: { status: "EXPIRED" } });
    throw new Error("Proposal expired");
  }
  return db().paymentProposal.update({ where: { id: proposalId }, data: { status: to } });
}

export function currentIntentOf(p: { amount: string; token: string; recipient: string; chain: string; purpose: string | null }): string {
  return intentHash({ amount: p.amount, token: p.token, recipient: p.recipient, chain: p.chain, purpose: p.purpose });
}

export function isApprover(telegramUserId: string): boolean {
  if (approverIds.length === 0) return true; // open in dev; lock via TELEGRAM_APPROVER_IDS in prod
  return approverIds.includes(telegramUserId);
}

/**
 * Resolve the execution credential for a user.
 * Connected (/connect) users pay from their OWN wallet under their key;
 * everyone else shares the org desk wallet.
 */
export function clientForUser(user: { keeperKeyEnc: string | null; keeperWallet: string | null }): {
  client: KeeperHubClient;
  scope: string;
  wallet: string | null;
} {
  if (user.keeperKeyEnc) {
    const key = decryptSecret(user.keeperKeyEnc);
    return { client: new KeeperHubClient(key), scope: "user", wallet: user.keeperWallet };
  }
  return { client: keeperHub, scope: "org", wallet: null };
}

/** Execute locked intent through KeeperHub. Blocks on hash mismatch + double-spend. */
export async function executeProposal(proposalId: string) {
  const prisma = db();
  const p = await prisma.paymentProposal.findUniqueOrThrow({ where: { id: proposalId }, include: { executions: true } });

  // idempotency: already executed → return existing tx
  const done = (p.executions as { status: string; txHash: string | null; keeperHubExecutionId: string | null }[]).find((e) => e.status === "SUCCESS" && e.txHash);
  if (done) return { reused: true, txHash: done.txHash!, executionId: done.keeperHubExecutionId };

  if (p.status !== "APPROVED") throw new Error(`Cannot execute from ${p.status} (need APPROVED)`);

  // intent lock
  const current = currentIntentOf(p);
  if (current !== p.intentHash) {
    await prisma.paymentProposal.update({ where: { id: p.id }, data: { status: "INTENT_CHANGED" } });
    await audit(p.id, "INTENT_CHANGED", { original: p.intentHash, current });
    throw new Error("Approved intent no longer matches current intent — execution blocked");
  }

  await prisma.paymentProposal.update({ where: { id: p.id }, data: { status: "EXECUTING" } });
  const execRow = await prisma.execution.create({ data: { proposalId: p.id, status: "RUNNING" } });
  await audit(p.id, "EXECUTION_STARTED", { idempotencyKey: p.idempotencyKey });

  try {
    const transfer = buildTransferInput({ amount: p.amount, token: p.token, recipient: p.recipient, chain: p.chain, purpose: p.purpose });
    const payer = await prisma.user.findUniqueOrThrow({ where: { id: p.userId } });
    const { client: kh } = clientForUser(payer);
    const result = await kh.executeWorkflow(transfer, p.idempotencyKey);
    const raw = result as unknown as Record<string, unknown>;
    const txHash = (raw.transactionHash as string | undefined) ?? (raw.txHash as string | undefined);
    const executionId = (raw.executionId as string | undefined) ?? null;
    await prisma.execution.update({
      where: { id: execRow.id },
      data: { status: "SUCCESS", txHash: txHash ?? null, keeperHubExecutionId: executionId, completedAt: new Date() },
    });
    await prisma.paymentProposal.update({ where: { id: p.id }, data: { status: "SUCCESS" } });
    await audit(p.id, "EXECUTION_SUCCEEDED", { txHash, executionId, receipts: raw.receipts ?? null });
    return { reused: false, txHash, executionId, raw };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.execution.update({ where: { id: execRow.id }, data: { status: "FAILED", error: msg, completedAt: new Date() } });
    await prisma.paymentProposal.update({ where: { id: p.id }, data: { status: "FAILED" } });
    await audit(p.id, "EXECUTION_FAILED", { error: msg });
    throw e;
  }
}

export function canonicalOf(p: { amount: string; token: string; recipient: string; chain: string; purpose: string | null }): string {
  return canonicalizeIntent({ amount: p.amount, token: p.token, recipient: p.recipient, chain: p.chain, purpose: p.purpose });
}
