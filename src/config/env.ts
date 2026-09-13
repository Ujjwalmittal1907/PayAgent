import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.string().default("development"),
  PORT: z.coerce.number().default(8788),
  TELEGRAM_BOT_TOKEN: z.string().optional().default(""),
  TELEGRAM_APPROVER_IDS: z.string().optional().default(""),
  AI_API_KEY: z.string().optional().default(""),
  AI_MODEL: z.string().default("gpt-4o-mini"),
  KEEPERHUB_API_KEY: z.string().default(""),
  KEEPERHUB_BASE_URL: z.string().default("https://app.keeperhub.com"),
  CHAIN_ID: z.string().default("84532"),
  BASE_SEPOLIA_RPC_URL: z.string().default("https://sepolia.base.org"),
  USDC_TOKEN_ADDRESS: z.string().default("0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"),
  PAYMENT_AUTO_APPROVE_LIMIT_USD: z.coerce.number().default(1),
  PAYMENT_HUMAN_APPROVAL_LIMIT_USD: z.coerce.number().default(10),
  PAYMENT_DAILY_LIMIT_USD: z.coerce.number().default(10),
  MAX_SINGLE_PAYMENT_USD: z.coerce.number().default(10),
  ALLOWED_TOKENS: z.string().default("USDC"),
  ALLOWED_NETWORKS: z.string().default("base-sepolia"),
  ALLOWED_RECIPIENTS: z.string().optional().default(""),
  REQUIRED_APPROVALS: z.coerce.number().default(1),
  PROPOSAL_EXPIRY_MINUTES: z.coerce.number().default(15),
  DATABASE_URL: z.string().default("file:./dev.db"),
});

export const env = envSchema.parse(process.env);

export const allowedTokens = env.ALLOWED_TOKENS.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
export const allowedNetworks = env.ALLOWED_NETWORKS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
export const allowedRecipients = env.ALLOWED_RECIPIENTS
  ? env.ALLOWED_RECIPIENTS.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
  : [];
export const approverIds = env.TELEGRAM_APPROVER_IDS
  ? env.TELEGRAM_APPROVER_IDS.split(",").map((s) => s.trim()).filter(Boolean)
  : [];

/** Chain registry: name -> { chainId, usdc, explorer }. Funded path first. */
export const CHAINS: Record<string, { chainId: string; usdc: string; label: string }> = {
  "ethereum-sepolia": {
    chainId: "11155111",
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    label: "Ethereum Sepolia",
  },
  sepolia: {
    chainId: "11155111",
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    label: "Ethereum Sepolia",
  },
  "base-sepolia": {
    chainId: "84532",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    label: "Base Sepolia",
  },
};

export const DEFAULT_CHAIN = "ethereum-sepolia";

export function resolveChain(chain: string): { chainId: string; usdc: string; label: string } {
  const c = CHAINS[chain.toLowerCase()];
  if (!c) throw new Error(`Unsupported chain: ${chain}`);
  return c;
}

export function requireKeeperHub() {
  if (!env.KEEPERHUB_API_KEY || env.KEEPERHUB_API_KEY.includes("...") || env.KEEPERHUB_API_KEY.includes("your_key")) {
    throw new Error("KEEPERHUB_API_KEY missing. Set it in .env (Organisation key kh_...). See .env.example");
  }
}
