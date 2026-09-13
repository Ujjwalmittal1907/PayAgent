import { createHash } from "node:crypto";
import { getAddress, isAddress } from "viem";

export function isValidEvmAddress(addr: string): boolean {
  return isAddress(addr);
}

export function checksumAddress(addr: string): string {
  return getAddress(addr);
}

/** Canonicalize payment intent (sorted keys, trimmed, lowercased addresses). */
export function canonicalizeIntent(intent: Record<string, unknown>): string {
  const normalized: Record<string, unknown> = {};
  const keys = Object.keys(intent).sort();
  for (const k of keys) {
    let v: unknown = intent[k];
    if (typeof v === "string") {
      v = v.trim();
      if (k === "recipient" || k === "tokenAddress") v = (v as string).toLowerCase();
      if (k === "token") v = (v as string).toUpperCase();
      if (k === "amount") v = canonicalAmount(v as string);
    }
    normalized[k] = v;
  }
  return JSON.stringify(normalized);
}

export function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

export function intentHash(intent: Record<string, unknown>): string {
  return sha256Hex(canonicalizeIntent(intent));
}

/** Canonical decimal string: trim, no exponent, strip leading/trailing zeros. */
export function canonicalAmount(raw: string): string {
  let s = raw.trim();
  if (/^[+-]/.test(s)) throw new Error("Amount must be positive");
  if (/[eE]/.test(s)) throw new Error("Exponent notation not allowed for amounts");
  if (!/^\d*\.?\d+$/.test(s)) throw new Error(`Invalid amount: ${raw}`);
  if (s.startsWith(".")) s = "0" + s;
  const [intPart, fracPart] = s.split(".");
  const intC = intPart.replace(/^0+(?=\d)/, "") || "0";
  if (fracPart === undefined) return intC;
  const fracC = fracPart.replace(/0+$/, "");
  return fracC === "" ? intC : `${intC}.${fracC}`;
}

/** Decimal-safe USD comparison using integer cents. */
export function toCents(amount: string): bigint {
  const c = canonicalAmount(amount);
  const [i, f = ""] = c.split(".");
  const frac = (f + "00").slice(0, 2);
  return BigInt(i) * 100n + BigInt(frac);
}

/** Escape Telegram HTML. */
export function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function shortAddress(addr: string): string {
  if (addr.length < 16) return addr;
  return `${addr.slice(0, 8)}...${addr.slice(-6)}`;
}

/** Stable idempotency key: sha256(chatId|messageId|proposalId|chain|recipient|amount|token). */
export function stableIdempotencyKey(parts: (string | number)[]): string {
  const canon = parts.map((p) => String(p).trim().toLowerCase()).join("|");
  return sha256Hex(canon);
}
