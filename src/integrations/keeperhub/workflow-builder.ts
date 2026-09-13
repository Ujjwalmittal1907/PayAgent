import { resolveChain } from "../../config/env.js";
import type { KeeperTransferInput } from "./types.js";

export interface PaymentIntentLike {
  amount: string;
  token: string;
  recipient: string;
  chain: string;
  purpose?: string | null;
}

/** Build the exact KeeperHub transfer body for a locked payment intent. */
export function buildTransferInput(intent: PaymentIntentLike): KeeperTransferInput {
  const { chainId, usdc } = resolveChain(intent.chain);
  const token = intent.token.toUpperCase();
  if (token !== "USDC") throw new Error(`Unsupported token for workflow: ${intent.token}`);
  return {
    chainId,
    recipientAddress: intent.recipient,
    amount: intent.amount,
    tokenAddress: usdc,
  };
}

export function workflowDescriptor(intent: PaymentIntentLike): string {
  return [
    "1. validate wallet balance (KeeperHub simulate preflight)",
    "2. validate recipient (EIP-55 / lowercase)",
    "3. validate token (USDC allowlist)",
    `4. execute USDC transfer ${intent.amount} -> ${intent.recipient} on ${intent.chain}`,
    "5. verify receipts (verified:true) + explorer link",
  ].join("\n");
}
