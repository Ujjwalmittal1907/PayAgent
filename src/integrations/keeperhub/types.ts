export interface KeeperTransferInput {
  chainId: string | number;
  recipientAddress: string;
  amount: string;
  tokenAddress?: string;
}

export interface KeeperSimResult {
  ok: boolean;
  raw: Record<string, unknown>;
  wouldRevert?: boolean;
}

export interface KeeperStatusResult {
  executionId: string;
  status: string;
  transactionHash?: string;
  transactionLink?: string;
  sponsored?: boolean;
  receipts?: unknown[];
  raw: Record<string, unknown>;
}
