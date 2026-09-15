import { env, requireKeeperHub } from "../../config/env.js";
import type { KeeperStatusResult, KeeperTransferInput } from "./types.js";

function headers(apiKey: string, idempotencyKey?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
  };
}

async function parseOrThrow(res: Response, path: string): Promise<Record<string, unknown>> {
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`KeeperHub ${path} ${res.status}: ${text}`);
  return json as Record<string, unknown>;
}

/**
 * KeeperHubClient — thin wrapper over the documented Direct Execution REST API.
 * Surfaces used: POST /api/execute/transfer (simulate-first), GET /api/execute/{id}/status.
 * Docs: https://docs.keeperhub.com/api/direct-execution
 */
export class KeeperHubClient {
  base = env.KEEPERHUB_BASE_URL.replace(/\/$/, "");
  private overrideKey: string | null;

  /** Pass a user's own key (from /connect) to execute under their wallet. Null = org default. */
  constructor(apiKey?: string | null) {
    this.overrideKey = apiKey ?? null;
  }

  private get key(): string {
    return this.overrideKey ?? env.KEEPERHUB_API_KEY;
  }

  private requireKey() {
    if (this.overrideKey) return; // user key already validated at /connect time
    requireKeeperHub();
  }

  /** Dry run: simulate:true — never signs/broadcasts. mcp:read is enough. */
  async dryRunTransfer(input: KeeperTransferInput): Promise<Record<string, unknown>> {
    this.requireKey();
    const res = await fetch(`${this.base}/api/execute/transfer`, {
      method: "POST",
      headers: headers(this.key),
      body: JSON.stringify({ ...input, simulate: true }),
    });
    return parseOrThrow(res, "POST /api/execute/transfer simulate");
  }

  /** Broadcast once with stable Idempotency-Key. */
  async broadcastTransfer(
    input: KeeperTransferInput,
    idempotencyKey: string,
  ): Promise<Record<string, unknown>> {
    this.requireKey();
    const res = await fetch(`${this.base}/api/execute/transfer`, {
      method: "POST",
      headers: headers(this.key, idempotencyKey),
      body: JSON.stringify({ ...input }),
    });
    return parseOrThrow(res, "POST /api/execute/transfer");
  }

  async getStatus(executionId: string): Promise<{ json: KeeperStatusResult; pollHint: number | null }> {
    this.requireKey();
    const res = await fetch(`${this.base}/api/execute/${executionId}/status`, {
      headers: { Authorization: `Bearer ${this.key}` },
    });
    const hint = res.headers.get("x-poll-interval-hint");
    const json = (await parseOrThrow(res, "GET /api/execute/{id}/status")) as unknown as KeeperStatusResult;
    return { json, pollHint: hint !== null ? Number(hint) : null };
  }

  async pollStatus(executionId: string, maxRounds = 20): Promise<KeeperStatusResult> {
    for (let i = 0; i < maxRounds; i++) {
      const { json, pollHint } = await this.getStatus(executionId);
      const status = String((json as unknown as Record<string, unknown>).status ?? "");
      if (pollHint === 0 || status === "completed" || status === "failed") return json;
      const waitSec = pollHint && pollHint > 0 ? pollHint : 5;
      await new Promise((r) => setTimeout(r, waitSec * 1000));
    }
    throw new Error(
      `Execution ${executionId} did not settle — check GET /api/execute/${executionId}/status (do NOT resend with a new key)`,
    );
  }

  /**
   * Full safe sequence per docs:
   * 1. simulate:true → require success:true && wouldRevert:false
   * 2. broadcast with Idempotency-Key
   * 3. poll honoring X-Poll-Interval-Hint
   */
  async createWorkflow(): Promise<{ workflowNote: string }> {
    // Direct-execution path needs no pre-created workflow; this keeps the
    // PayAgent abstraction (create→validate→dryrun→execute) while using the
    // documented transfer surface for the actual value movement.
    return { workflowNote: "direct-execution: POST /api/execute/transfer (no workflow object required)" };
  }

  async validateWorkflow(input: KeeperTransferInput): Promise<{ valid: boolean; issues: string[] }> {
    const issues: string[] = [];
    if (!input.recipientAddress?.startsWith("0x") || input.recipientAddress.length !== 42)
      issues.push("recipientAddress must be a 0x EVM address");
    if (!input.amount || Number.isNaN(Number(input.amount)) || Number(input.amount) <= 0)
      issues.push("amount must be > 0");
    if (!input.chainId) issues.push("chainId required");
    return { valid: issues.length === 0, issues };
  }

  async dryRunWorkflow(input: KeeperTransferInput) {
    return this.dryRunTransfer(input);
  }

  async executeWorkflow(input: KeeperTransferInput, idempotencyKey: string): Promise<KeeperStatusResult> {
    const sim = (await this.dryRunTransfer(input)) as { success?: boolean; wouldRevert?: boolean };
    if (sim.wouldRevert) throw new Error(`Simulation would revert, refusing broadcast: ${JSON.stringify(sim)}`);
    if (sim.success === false) throw new Error(`Simulation failed: ${JSON.stringify(sim)}`);
    const exec = await this.broadcastTransfer(input, idempotencyKey);
    const executionId = (exec as { executionId?: string }).executionId;
    if (!executionId) return exec as unknown as KeeperStatusResult;
    return this.pollStatus(executionId);
  }

  async getExecutionStatus(executionId: string): Promise<KeeperStatusResult> {
    const { json } = await this.getStatus(executionId);
    return json;
  }

  async verifyKey(): Promise<Record<string, unknown>> {
    this.requireKey();
    const res = await fetch(`${this.base}/api/keys`, {
      headers: { Authorization: `Bearer ${this.key}` },
    });
    return parseOrThrow(res, "GET /api/keys");
  }
}

export const keeperHub = new KeeperHubClient();
