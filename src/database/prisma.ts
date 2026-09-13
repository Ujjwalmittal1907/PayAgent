import { PrismaClient } from "@prisma/client";

let prisma: PrismaClient | null = null;

export function db(): PrismaClient {
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}

export async function spentTodayCents(): Promise<bigint> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const rows = await db().paymentProposal.findMany({
    where: { status: "SUCCESS", createdAt: { gte: start } },
    select: { amount: true },
  });
  let total = 0n;
  for (const r of rows) {
    const [i, f = ""] = r.amount.split(".");
    total += BigInt(i) * 100n + BigInt((f + "00").slice(0, 2));
  }
  return total;
}

let shortCounter = 100;
export function nextShortId(): string {
  shortCounter += 1;
  return `P-${shortCounter}`;
}

/** Crash-safe allocator: derives the next ID from the DB, not process memory. */
export async function allocateShortId(): Promise<string> {
  const rows = await db().paymentProposal.findMany({ select: { shortId: true } });
  let max = 100;
  for (const r of rows) {
    const m = /^P-(\d+)$/.exec(r.shortId);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `P-${max + 1}`;
}
