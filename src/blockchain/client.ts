import { createPublicClient, http, erc20Abi, formatUnits } from "viem";
import { baseSepolia, sepolia } from "viem/chains";
import { env, resolveChain } from "../config/env.js";

const clients: Record<string, any> = {};

export function publicClient(chain = "ethereum-sepolia"): any {
  if (!clients[chain]) {
    const isBase = chain.toLowerCase() === "base-sepolia";
    clients[chain] = createPublicClient({
      chain: isBase ? baseSepolia : sepolia,
      transport: http(isBase ? env.BASE_SEPOLIA_RPC_URL : process.env.ETH_SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com"),
    });
  }
  return clients[chain];
}

export async function getBalances(walletAddress: `0x${string}`, chain = "ethereum-sepolia") {
  const c = publicClient(chain);
  const { usdc } = resolveChain(chain);
  const usdcRaw = (await c.readContract({
    address: usdc as `0x${string}`,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [walletAddress],
  })) as bigint;
  const ethRaw = (await c.getBalance({ address: walletAddress })) as bigint;
  let decimals = 6;
  try {
    decimals = Number(
      (await c.readContract({ address: usdc as `0x${string}`, abi: erc20Abi, functionName: "decimals" })) as number,
    );
  } catch {
    decimals = 6;
  }
  return { usdc: formatUnits(usdcRaw, decimals), eth: formatUnits(ethRaw, 18) };
}
