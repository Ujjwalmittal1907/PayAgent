export function getExplorerTxUrl(chain: string, txHash: string): string {
  const c = chain.toLowerCase();
  if (c === "base-sepolia" || c === "84532") return `https://sepolia.basescan.org/tx/${txHash}`;
  if (c === "base" || c === "8453") return `https://basescan.org/tx/${txHash}`;
  if (c === "ethereum-sepolia" || c === "sepolia" || c === "11155111")
    return `https://sepolia.etherscan.io/tx/${txHash}`;
  return `https://sepolia.basescan.org/tx/${txHash}`;
}

export function getExplorerAddressUrl(chain: string, address: string): string {
  const c = chain.toLowerCase();
  if (c === "base-sepolia" || c === "84532") return `https://sepolia.basescan.org/address/${address}`;
  if (c === "base" || c === "8453") return `https://basescan.org/address/${address}`;
  return `https://sepolia.basescan.org/address/${address}`;
}
