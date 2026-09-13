import { db } from "../database/prisma.js";

export async function audit(proposalId: string | null, eventType: string, metadata?: Record<string, unknown>) {
  try {
    await db().auditEvent.create({
      data: { proposalId, eventType, metadata: metadata ? JSON.stringify(metadata) : null },
    });
  } catch (e) {
    console.error("[audit] failed", eventType, e);
  }
}
