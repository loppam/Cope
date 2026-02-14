// Solana RPC utilities - all calls proxied through /api/rpc so API keys stay server-side
import { getApiBaseAbsolute } from "./utils";

async function rpcFetch<T>(action: string, address: string): Promise<T> {
  const base = getApiBaseAbsolute();
  const path = `/api/rpc?action=${encodeURIComponent(action)}&address=${encodeURIComponent(address)}`;
  const url = base ? `${base}${path}` : path;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: string }).error ?? `RPC error: ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

/**
 * Get SOL balance for a wallet address (proxied via /api/rpc).
 */
export async function getSolBalance(walletAddress: string): Promise<number> {
  try {
    const { balance } = await rpcFetch<{ balance: number }>("sol-balance", walletAddress);
    return Number.isFinite(balance) ? balance : 0;
  } catch (error) {
    console.error("Error fetching SOL balance:", error);
    throw error;
  }
}

/**
 * Get USDC balance for a Solana wallet (proxied via /api/rpc).
 */
export async function getUsdcBalance(walletAddress: string): Promise<number> {
  try {
    const { balance } = await rpcFetch<{ balance: number }>("usdc-balance", walletAddress);
    return Number.isFinite(balance) ? balance : 0;
  } catch (error) {
    console.error("Error fetching USDC balance:", error);
    throw error;
  }
}

/**
 * Get all token accounts for a wallet (proxied via /api/rpc).
 * Returns array of { mint, balance, decimals, uiAmount }.
 */
export interface TokenAccount {
  mint: string;
  balance: number;
  decimals: number;
  uiAmount: number;
}

export async function getTokenAccounts(walletAddress: string): Promise<TokenAccount[]> {
  try {
    const { accounts } = await rpcFetch<{ accounts: Array<{ mint: string; balance: string; decimals: number; uiAmount: number }> }>("token-accounts", walletAddress);
    return (accounts ?? []).map((a) => ({
      mint: a.mint,
      balance: parseInt(a.balance, 10) || 0,
      decimals: a.decimals ?? 0,
      uiAmount: a.uiAmount ?? 0,
    }));
  } catch (error) {
    console.error("Error fetching token accounts:", error);
    throw error;
  }
}

/**
 * Get transaction signature status. Not proxied; use server-side RPC if needed.
 */
export async function getTransactionStatus(_signature: string): Promise<any> {
  throw new Error("getTransactionStatus is not available from client; use server RPC");
}

/**
 * Get recent transactions for a wallet. Not proxied; use server-side RPC if needed.
 */
export async function getRecentTransactions(_walletAddress: string, _limit: number = 10): Promise<any[]> {
  throw new Error("getRecentTransactions is not available from client; use server RPC");
}

/**
 * Get account info. Not proxied; use server-side RPC if needed.
 */
export async function getAccountInfo(_address: string): Promise<any> {
  throw new Error("getAccountInfo is not available from client; use server RPC");
}
