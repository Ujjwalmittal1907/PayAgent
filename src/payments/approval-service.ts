import { db } from "../database/prisma.js";
import { audit } from "../audit/audit-service.js";
import { isApprover, transition } from "./payment-service.js";
import { env } from "../config/env.js";

export async function recordApproval(proposalId: string, telegramUserId: string, decision: "APPROVE" | "REJECT") {
  const prisma = db();
  const p = await prisma.paymentProposal.findUniqueOrThrow({ where: { id: proposalId } });
  if (p.status !== "PENDING_APPROVAL") throw new Error(`Proposal is ${p.status}, not awaiting approval`);
  if (new Date() > p.expiresAt) {
    await prisma.paymentProposal.update({ where: { id: p.id }, data: { status: "EXPIRED" } });
    throw new Error("Approval expired");
  }
  if (!isApprover(telegramUserId)) throw new Error("Approver not authorized");
  const existing = await prisma.approval.findUnique({
    where: { proposalId_telegramUserId: { proposalId, telegramUserId } },
  });
  if (existing) throw new Error("Duplicate approval");

  await prisma.approval.create({ data: { proposalId, telegramUserId, decision } });

  if (decision === "REJECT") {
    await transition(p.id, "PENDING_APPROVAL", "CANCELLED");
    await audit(p.id, "PAYMENT_REJECTED", { by: telegramUserId });
    return { status: "CANCELLED" as const, approvalCount: p.approvalCount };
  }

  const count = p.approvalCount + 1;
  await prisma.paymentProposal.update({ where: { id: p.id }, data: { approvalCount: count } });
  await audit(p.id, "PAYMENT_APPROVED", { by: telegramUserId, count, required: p.requiredApprovals });

  if (count >= p.requiredApprovals) {
    await transition(p.id, "PENDING_APPROVAL", "APPROVED");
    return { status: "APPROVED" as const, approvalCount: count };
  }
  return { status: "PENDING_APPROVAL" as const, approvalCount: count };
}

export function requiredApprovals(): number {
  return env.REQUIRED_APPROVALS;
}
