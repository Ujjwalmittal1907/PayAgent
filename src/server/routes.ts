import type { FastifyInstance } from "fastify";
import { db } from "../database/prisma.js";

export async function registerRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true, service: "payagent", time: new Date().toISOString() }));

  app.get("/api/proposals/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await db().paymentProposal.findFirst({
      where: { OR: [{ id }, { shortId: id }] },
      include: { executions: { select: { id: true, status: true, txHash: true, keeperHubExecutionId: true, startedAt: true, completedAt: true } } },
    });
    if (!p) return reply.code(404).send({ error: "not found" });
    const { intentHash: _h, idempotencyKey: _k, ...safe } = p;
    return { ...safe, intentHashLocked: true };
  });

  app.get("/api/proposals/:id/audit", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await db().paymentProposal.findFirst({ where: { OR: [{ id }, { shortId: id }] } });
    if (!p) return reply.code(404).send({ error: "not found" });
    const events = await db().auditEvent.findMany({ where: { proposalId: p.id }, orderBy: { createdAt: "asc" } });
    return { proposalId: p.id, shortId: p.shortId, events };
  });

  app.get("/api/executions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const e = await db().execution.findUnique({ where: { id } });
    if (!e) return reply.code(404).send({ error: "not found" });
    return e;
  });

  app.get("/api/stats", async () => {
    const [total, ok, pending, blocked] = await Promise.all([
      db().paymentProposal.count(),
      db().paymentProposal.count({ where: { status: "SUCCESS" } }),
      db().paymentProposal.count({ where: { status: "PENDING_APPROVAL" } }),
      db().paymentProposal.count({ where: { status: "POLICY_REJECTED" } }),
    ]);
    const recent = await db().paymentProposal.findMany({ orderBy: { createdAt: "desc" }, take: 10, include: { executions: { take: 1 } } });
    return { total, successful: ok, pending, blocked, recent };
  });
}
