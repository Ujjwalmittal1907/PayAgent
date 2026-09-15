import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALG = "aes-256-gcm";

function masterKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error(
      "ENCRYPTION_KEY missing or invalid — generate with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  return Buffer.from(hex, "hex");
}

/** Encrypt a user-supplied KeeperHub key. Output: base64(iv):base64(tag):base64(ct). Never log this. */
export function encryptSecret(plain: string): string {
  const key = masterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptSecret(enc: string): string {
  const key = masterKey();
  const [ivB64, tagB64, ctB64] = enc.split(":");
  if (!ivB64 || !tagB64 || !ctB64) throw new Error("Malformed encrypted secret");
  const decipher = createDecipheriv(ALG, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
}

/** Safe identifier for display: first 6 chars only, never the full key. */
export function keyPrefix(key: string): string {
  return key.slice(0, 6);
}
