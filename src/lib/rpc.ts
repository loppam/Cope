// Solana balance utilities - uses Birdeye wallet token list for SOL and USDC (no Solana Tracker RPC)
import { getWalletSolAndUsdcBalances } from "./birdeye";

const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const RPC_RETRY_MAX = 4;
const RPC_RETRY_DELAYS_MS = [2000, 4000, 6000, 8000];

function getRpcUrl(): string {
  const url = import.meta.env.VITE_SOLANA_RPC_URL;
  if (url) return url;
  if (import.meta.env.VITE_HELIUS_API_KEY) {
    return `https://rpc.helius.xyz/?api-key=${import.meta.env.VITE_HELIUS_API_KEY}`;
  }
  const key = import.meta.env.VITE_SOLANATRACKER_RPC_API_KEY ?? import.meta.env.VITE_SOLANATRACKER_API_KEY;
  if (key) return `https://rpc-mainnet.solanatracker.io/?api_key=${key}`;
  return "https://api.mainnet-beta.solana.com";
}

async function rpcRequest<T>(method: string, params: unknown[]): Promise<T> {
  const url = getRpcUrl();
  const body = { jsonrpc: "2.0", id: 1, method, params };
  for (let attempt = 0; attempt <= RPC_RETRY_MAX; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { result?: T; error?: { message: string } };
    if (res.ok && !data.error) return data.result as T;
    const msg = data?.error?.message ?? `RPC error: ${res.status}`;
    const err = new Error(msg);
    const isRetryable = res.status === 429 || res.status === 502;
    if (!isRetryable || attempt === RPC_RETRY_MAX) throw err;
    await new Promise((r) => setTimeout(r, RPC_RETRY_DELAYS_MS[attempt]));
  }
  throw new Error("RPC request failed");
}

/**
 * Get SOL balance for a wallet address via Birdeye wallet token list.
 */
export async function getSolBalance(walletAddress: string): Promise<number> {
  try {
    const { solBalance } = await getWalletSolAndUsdcBalances(walletAddress);
    return solBalance;
  } catch (error) {
    console.error("Error fetching SOL balance:", error);
    throw error;
  }
}

/**
 * Get USDC balance for a Solana wallet via Birdeye wallet token list.
 */
export async function getUsdcBalance(walletAddress: string): Promise<number> {
  try {
    const { usdcBalance } = await getWalletSolAndUsdcBalances(walletAddress);
    return usdcBalance;
  } catch (error) {
    console.error("Error fetching USDC balance:", error);
    throw error;
  }
}

/**
 * Get all token accounts for a wallet (client-side RPC).
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
    const result = await rpcRequest<{ value: Array<{ account: { data: unknown } }> }>(
      "getTokenAccountsByOwner",
      [walletAddress, { programId: TOKEN_PROGRAM_ID }, { encoding: "jsonParsed" }]
    );
    const value = result?.value ?? [];
    return value.map((item) => {
      const parsedInfo = (item.account?.data as { parsed?: { info?: { tokenAmount?: { mint: string; amount: string; decimals: number; uiAmount?: number; uiAmountString?: string } } } })?.parsed?.info;
      const tokenAmount = parsedInfo?.tokenAmount ?? {};
      let uiAmount = tokenAmount.uiAmount ?? 0;
      if (uiAmount === 0 && tokenAmount.uiAmountString != null) {
        const n = parseFloat(tokenAmount.uiAmountString);
        if (Number.isFinite(n)) uiAmount = n;
      }
      if (uiAmount === 0 && tokenAmount.amount != null && tokenAmount.decimals != null) {
        uiAmount = Number(tokenAmount.amount) / Math.pow(10, tokenAmount.decimals);
      }
      return {
        mint: tokenAmount.mint ?? "",
        balance: parseInt(tokenAmount.amount ?? "0", 10) || 0,
        decimals: tokenAmount.decimals ?? 0,
        uiAmount,
      };
    });
  } catch (error) {
    console.error("Error fetching token accounts:", error);
    throw error;
  }
}

/**
 * Get transaction signature status. Not implemented on client.
 */
export async function getTransactionStatus(_signature: string): Promise<any> {
  throw new Error("getTransactionStatus is not available from client; use server RPC");
}

/**
 * Get recent transactions for a wallet. Not implemented on client.
 */
export async function getRecentTransactions(_walletAddress: string, _limit: number = 10): Promise<any[]> {
  throw new Error("getRecentTransactions is not available from client; use server RPC");
}

/**
 * Get account info. Not implemented on client.
 */
export async function getAccountInfo(_address: string): Promise<any> {
  throw new Error("getAccountInfo is not available from client; use server RPC");
}
