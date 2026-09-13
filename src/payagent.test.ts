import { describe, expect, it } from "vitest";
import { evaluatePolicy } from "./payments/policy-engine.js";
import { canonicalizeIntent, intentHash, stableIdempotencyKey, toCents } from "./utils/validation.js";
import { assertTransition, canTransition } from "./payments/state-machine.js";
import { parsePaymentText } from "./ai/intent-parser.js";

describe("policy", () => {
  const base = { token: "USDC", recipient: "0xdf14c4FcF3FBA4953CF30c9CD491e4C0536eD09F", chain: "base-sepolia", spentTodayCents: 0n };
  it("allows valid 0.50", () => {
    const r = evaluatePolicy({ ...base, amount: "0.50" });
    expect(r.allowed).toBe(true);
    expect(r.requiresApproval).toBe(false);
  });
  it("routes 2 USDC to approval", () => {
    const r = evaluatePolicy({ ...base, amount: "2" });
    expect(r.allowed).toBe(true);
    expect(r.requiresApproval).toBe(true);
  });
  it("rejects 50 USDC over ceiling", () => {
    const r = evaluatePolicy({ ...base, amount: "50" });
    expect(r.allowed).toBe(false);
  });
  it("rejects daily overflow", () => {
    const r = evaluatePolicy({ ...base, amount: "1", spentTodayCents: 950n });
    expect(r.allowed).toBe(false);
  });
  it("rejects bad token/chain/address", () => {
    expect(evaluatePolicy({ ...base, amount: "1", token: "ETH" }).allowed).toBe(false);
    expect(evaluatePolicy({ ...base, amount: "1", chain: "ethereum" }).allowed).toBe(false);
    expect(evaluatePolicy({ ...base, amount: "1", recipient: "0xbad" }).allowed).toBe(false);
  });
});

describe("intent hash", () => {
  it("deterministic + detects change", () => {
    const a = { amount: "0.50", token: "USDC", recipient: "0xABC", chain: "base-sepolia", purpose: null };
    const b = { purpose: null, chain: "base-sepolia", recipient: "0xABC", token: "USDC", amount: "0.50" };
    expect(intentHash(a)).toBe(intentHash(b));
    expect(intentHash({ ...a, amount: "5.00" })).not.toBe(intentHash(a));
    expect(canonicalizeIntent(a)).toBe(canonicalizeIntent(b));
  });
  it("cents math", () => {
    expect(toCents("0.50")).toBe(50n);
    expect(toCents("1.000")).toBe(100n);
  });
});

describe("state machine", () => {
  it("allows valid, blocks invalid", () => {
    expect(canTransition("DRAFT", "POLICY_APPROVED")).toBe(true);
    expect(canTransition("SUCCESS", "EXECUTING")).toBe(false);
    expect(() => assertTransition("SUCCESS", "EXECUTING")).toThrow();
  });
});

describe("parser", () => {
  it("parses /pay text", () => {
    const r = parsePaymentText("Pay 0.5 USDC to 0xdf14c4FcF3FBA4953CF30c9CD491e4C0536eD09F");
    expect(r.intent?.amount).toBe("0.5");
  });
  it("never guesses missing", () => {
    const r = parsePaymentText("Pay some USDC please");
    expect(r.intent).toBeUndefined();
    expect(r.missing).toContain("amount");
  });
});

describe("idempotency", () => {
  it("stable key", () => {
    const k1 = stableIdempotencyKey(["1", 2, "P-101", "base-sepolia", "0xABC", "0.5", "USDC"]);
    const k2 = stableIdempotencyKey(["1", 2, "P-101", "base-sepolia", "0xabc", "0.5", "USDC"]);
    expect(k1).toBe(k2);
    expect(stableIdempotencyKey(["1", 2, "P-102", "base-sepolia", "0xABC", "0.5", "USDC"])).not.toBe(k1);
  });
});
