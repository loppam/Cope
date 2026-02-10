// Solana RPC utilities for direct blockchain queries
// Use RPC for real-time data that doesn't need API credits
import { Connection, PublicKey, ParsedAccountData } from '@solana/web3.js';

// Get RPC endpoint from environment or use public endpoint
function getRpcUrl(): string {
  // Priority 1: Use SolanaTracker RPC API key if available (separate from API key)
  const solanatrackerRpcApiKey = import.meta.env.VITE_SOLANATRACKER_RPC_API_KEY;
  if (solanatrackerRpcApiKey) {
    return `https://rpc-mainnet.solanatracker.io/?api_key=${solanatrackerRpcApiKey}`;
  }
  
  // Priority 2: Use SolanaTracker API key as fallback (if RPC key not set)
  const solanatrackerApiKey = import.meta.env.VITE_SOLANATRACKER_API_KEY;
  if (solanatrackerApiKey) {
    return `https://rpc-mainnet.solanatracker.io/?api_key=${solanatrackerApiKey}`;
  }
  
  // Priority 3: Use custom RPC URL if specified
  if (import.meta.env.VITE_SOLANA_RPC_URL) {
    return import.meta.env.VITE_SOLANA_RPC_URL;
  }
  
  // Priority 4: Use Helius RPC if available
  if (import.meta.env.VITE_HELIUS_API_KEY) {
    return `https://rpc.helius.xyz/?api-key=${import.meta.env.VITE_HELIUS_API_KEY}`;
  }
  
  // Priority 5: Use public RPC as fallback (rate limited)
  return 'https://api.mainnet-beta.solana.com';
}

// Singleton connection instance
let connection: Connection | null = null;

function getConnection(): Connection {
  if (!connection) {
    connection = new Connection(getRpcUrl(), 'confirmed');
  }
  return connection;
}

/**
 * Get SOL balance for a wallet address
 * Uses RPC directly - no API credits needed
 */
export async function getSolBalance(walletAddress: string): Promise<number> {
  try {
    const conn = getConnection();
    const publicKey = new PublicKey(walletAddress);
    const balance = await conn.getBalance(publicKey);
    return balance / 1e9; // Convert lamports to SOL
  } catch (error) {
    console.error('Error fetching SOL balance:', error);
    throw error;
  }
}

/**
 * Get all token accounts for a wallet
 * Returns array of { mint, balance, decimals }
 */
export interface TokenAccount {
  mint: string;
  balance: number;
  decimals: number;
  uiAmount: number;
}

export async function getTokenAccounts(walletAddress: string): Promise<TokenAccount[]> {
  try {
    const conn = getConnection();
    const publicKey = new PublicKey(walletAddress);
    
    // Get all token accounts
    const tokenAccounts = await conn.getParsedTokenAccountsByOwner(publicKey, {
      programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
    });

    return tokenAccounts.value.map(account => {
      const parsedInfo = account.account.data as ParsedAccountData;
      const tokenAmount = parsedInfo.parsed.info.tokenAmount;
      // uiAmount can be null from some RPCs; use uiAmountString or derive from amount/decimals
      let uiAmount = tokenAmount.uiAmount ?? 0;
      if (uiAmount === 0 && tokenAmount.uiAmountString != null) {
        const parsed = parseFloat(tokenAmount.uiAmountString);
        if (Number.isFinite(parsed)) uiAmount = parsed;
      }
      if (uiAmount === 0 && tokenAmount.amount != null && tokenAmount.decimals != null) {
        const raw = Number(tokenAmount.amount);
        if (Number.isFinite(raw)) uiAmount = raw / Math.pow(10, tokenAmount.decimals);
      }
      return {
        mint: tokenAmount.mint,
        balance: tokenAmount.amount,
        decimals: tokenAmount.decimals,
        uiAmount,
      };
    });
  } catch (error) {
    console.error('Error fetching token accounts:', error);
    throw error;
  }
}

/**
 * Get transaction signature status
 */
export async function getTransactionStatus(signature: string): Promise<any> {
  try {
    const conn = getConnection();
    const status = await conn.getSignatureStatus(signature);
    return status;
  } catch (error) {
    console.error('Error fetching transaction status:', error);
    throw error;
  }
}

/**
 * Get recent transactions for a wallet
 */
export async function getRecentTransactions(
  walletAddress: string,
  limit: number = 10
): Promise<any[]> {
  try {
    const conn = getConnection();
    const publicKey = new PublicKey(walletAddress);
    
    // Get confirmed signatures
    const signatures = await conn.getSignaturesForAddress(publicKey, { limit });
    
    // Get transaction details (optional - can be expensive)
    // const transactions = await Promise.all(
    //   signatures.map(sig => conn.getTransaction(sig.signature))
    // );
    
    return signatures;
  } catch (error) {
    console.error('Error fetching recent transactions:', error);
    throw error;
  }
}

/**
 * Get account info (for any account type)
 */
export async function getAccountInfo(address: string): Promise<any> {
  try {
    const conn = getConnection();
    const publicKey = new PublicKey(address);
    const accountInfo = await conn.getAccountInfo(publicKey);
    return accountInfo;
  } catch (error) {
    console.error('Error fetching account info:', error);
    throw error;
  }
}
