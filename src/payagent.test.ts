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
  it("rejects daily overflow", async () => {
    const { env } = await import("./config/env.js");
    const capCents = BigInt(Math.round(env.PAYMENT_DAILY_LIMIT_USD * 100));
    const r = evaluatePolicy({ ...base, amount: "1", spentTodayCents: capCents - 50n });
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

describe("connect crypto", () => {
  it("encrypt/decrypt roundtrip, wrong key fails", async () => {
    process.env.ENCRYPTION_KEY = "ab".repeat(32);
    const { encryptSecret, decryptSecret, keyPrefix } = await import("./utils/crypto.js");
    const enc = encryptSecret("kh_test_secret");
    expect(enc).not.toContain("kh_test_secret");
    expect(decryptSecret(enc)).toBe("kh_test_secret");
    expect(keyPrefix("kh_abcdef123")).toBe("kh_abc");
    expect(encryptSecret("kh_test_secret")).not.toBe(enc); // random IV
    process.env.ENCRYPTION_KEY = "cd".repeat(32);
    expect(() => decryptSecret(enc)).toThrow(); // auth tag mismatch
  });
  it("client resolution: connected user gets own scope, strangers are refused", async () => {
    process.env.ENCRYPTION_KEY = "ab".repeat(32);
    const { encryptSecret } = await import("./utils/crypto.js");
    const { clientForUser } = await import("./payments/payment-service.js");
    expect(() => clientForUser({ keeperKeyEnc: null, keeperWallet: null })).toThrow("CONNECT_REQUIRED");
    const mine = clientForUser({ keeperKeyEnc: encryptSecret("kh_user_key"), keeperWallet: "0xabc" });
    expect(mine.scope).toBe("user");
    expect(mine.wallet).toBe("0xabc");
  });
});
