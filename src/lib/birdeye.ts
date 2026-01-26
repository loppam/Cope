// Birdeye API integration for Solana wallet analytics
const BIRDEYE_API_BASE = 'https://public-api.birdeye.so';

/**
 * Get Birdeye API key from environment
 */
function getApiKey(): string {
  const apiKey = import.meta.env.VITE_BIRDEYE_API_KEY;
  if (!apiKey) {
    throw new Error('Birdeye API key not configured. Add VITE_BIRDEYE_API_KEY to .env');
  }
  return apiKey;
}

/**
 * Delay helper function
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Make a request to Birdeye API with retry logic and exponential backoff
 */
async function birdeyeRequest<T>(
  endpoint: string,
  options: {
    method?: 'GET' | 'POST';
    params?: Record<string, any>;
    body?: any;
    retries?: number;
    baseDelay?: number;
  } = {}
): Promise<T> {
  const {
    method = 'GET',
    params,
    body,
    retries = 3,
    baseDelay = 1000,
  } = options;

  const apiKey = getApiKey();
  const url = new URL(`${BIRDEYE_API_BASE}${endpoint}`);
  
  // Add query params for GET requests
  if (method === 'GET' && params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, String(value));
      }
    });
  }

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const fetchOptions: RequestInit = {
        method,
        headers: {
          'X-API-KEY': apiKey,
          'x-chain': 'solana',
          'Content-Type': 'application/json',
        },
      };

      // Add body for POST requests
      if (method === 'POST' && body) {
        fetchOptions.body = JSON.stringify(body);
      }

      const response = await fetch(url.toString(), fetchOptions);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Unknown error' }));
        const errorMessage = error.message || `Birdeye API error: ${response.status}`;
        
        // Retry on rate limit (429) or server errors (5xx)
        if ((response.status === 429 || response.status >= 500) && attempt < retries) {
          const waitTime = baseDelay * Math.pow(2, attempt);
          console.warn(`Rate limited. Retrying in ${waitTime}ms... (attempt ${attempt + 1}/${retries + 1})`);
          await delay(waitTime);
          continue;
        }
        
        throw new Error(errorMessage);
      }

      return response.json();
    } catch (error: any) {
      // If it's the last attempt or not a retryable error, throw
      if (attempt === retries || (error.message && !error.message.includes('429') && !error.message.includes('5'))) {
        throw error;
      }
      
      // Exponential backoff for network errors
      const waitTime = baseDelay * Math.pow(2, attempt);
      await delay(waitTime);
    }
  }

  throw new Error('Max retries exceeded');
}

/**
 * Token transaction interfaces - for finding wallets that traded tokens
 */
export interface TokenTransaction {
  tx_type: 'buy' | 'sell' | 'swap' | 'add' | 'remove';
  tx_hash: string;
  block_unix_time: number;
  block_number: number;
  volume_usd: number;
  volume: number;
  owner: string;
  signers: string[];
  source: string;
  side: 'buy' | 'sell';
  pool_id?: string;
  from?: {
    symbol: string;
    address: string;
    price: number;
    ui_change_amount: number;
  };
  to?: {
    symbol: string;
    address: string;
    price: number;
    ui_change_amount: number;
  };
}

export interface TokenTransactionsResponse {
  success: boolean;
  data: {
    items: TokenTransaction[];
  };
}

/**
 * Get token transactions - retrieves all trades for a token
 * Use this to find wallets that actually traded the token (owner field)
 */
export async function getTokenTransactions(
  tokenAddress: string,
  limit: number = 100,
  offset: number = 0,
  txType: 'buy' | 'sell' | 'swap' | 'add' | 'remove' | 'all' = 'swap'
): Promise<TokenTransactionsResponse> {
  // Clamp limit to API max (1-100)
  const clampedLimit = Math.max(1, Math.min(100, limit));
  // Clamp offset to API max (0-9999, and offset + limit <= 10000)
  const clampedOffset = Math.max(0, Math.min(9999, Math.min(offset, 10000 - clampedLimit)));

  return birdeyeRequest<TokenTransactionsResponse>('/defi/v3/token/txs', {
    method: 'GET',
    params: {
      address: tokenAddress,
      limit: clampedLimit,
      offset: clampedOffset,
      sort_by: 'block_unix_time',
      sort_type: 'desc',
      tx_type: txType,
      ui_amount_mode: 'scaled',
    },
  });
}

/**
 * Get token transactions with pagination - fetches multiple pages
 * Fetches up to 10 pages (1000 transactions total) per token
 */
export async function getTokenTransactionsPaginated(
  tokenAddress: string,
  pages: number = 10,
  txType: 'buy' | 'sell' | 'swap' | 'add' | 'remove' | 'all' = 'swap'
): Promise<TokenTransaction[]> {
  const allTransactions: TokenTransaction[] = [];
  const limit = 100; // API max limit per page

  for (let page = 0; page < pages; page++) {
    const offset = page * limit;
    try {
      const result = await getTokenTransactions(tokenAddress, limit, offset, txType);
      if (result.success && result.data?.items) {
        allTransactions.push(...result.data.items);

        // If we got fewer items than the limit, we've reached the end
        if (result.data.items.length < limit) {
          break;
        }
      }

      // Add delay between pages to respect rate limits (600ms)
      if (page < pages - 1) {
        await delay(600);
      }
    } catch (error) {
      console.error(`Error getting page ${page + 1} of transactions for token ${tokenAddress}:`, error);
      // Continue to next page even if one fails
      break;
    }
  }

  return allTransactions;
}

/**
 * Wallet PnL interfaces - matches actual API response structure
 */
export interface WalletPnLSummary {
  unique_tokens: number;
  counts: {
    total_buy: number;
    total_sell: number;
    total_trade: number;
    total_win: number;
    total_loss: number;
    win_rate: number;
  };
  cashflow_usd: {
    total_invested: number;
    total_sold: number;
    current_value?: number;
  };
  pnl: {
    realized_profit_usd: number;
    realized_profit_percent: number;
    unrealized_usd: number;
    total_usd: number;
    avg_profit_per_trade_usd: number;
  };
}

export interface WalletPnLSummaryResponse {
  success: boolean;
  data: {
    summary: WalletPnLSummary;
  };
}

/**
 * Get wallet PnL summary (single wallet)
 * Uses duration parameter instead of time_from/time_to
 * Includes increased retry attempts and longer delays for rate limit protection
 */
export async function getWalletPnLSummary(
  walletAddress: string,
  duration: 'all' | '90d' | '30d' | '7d' | '24h' = 'all'
): Promise<WalletPnLSummaryResponse> {
  return birdeyeRequest<WalletPnLSummaryResponse>('/wallet/v2/pnl/summary', {
    method: 'GET',
    params: {
      wallet: walletAddress,
      duration,
    },
    retries: 5, // More retries for PnL requests
    baseDelay: 2000, // Longer base delay (2 seconds) for PnL endpoint
  });
}

/**
 * Scanner functionality - Find wallets that traded multiple tokens
 */
export interface ScannerWallet {
  address: string;
  matched: number;
  total: number;
  tokens: string[];
  totalInvested: number; // Total USD invested (buy transactions)
  totalRemoved: number; // Total USD removed (sell transactions)
}


/**
 * Scan for wallets that traded multiple tokens using transaction data
 * 
 * Flow:
 * 1. For each token, fetch transactions (up to 10 pages = 1000 transactions)
 * 2. Extract unique wallet addresses from transaction 'owner' field
 * 3. Cross-check wallets across tokens to find those that traded 2+ tokens
 * 4. Calculate total invested from transaction volumes
 * 5. Sort by highest investment to lowest
 */
export async function scanWalletsForTokens(
  tokenMints: string[],
  minMatches: number = 2,
  minTrades: number = 2
): Promise<ScannerWallet[]> {
  try {
    // Step 1: Get transactions for each token from Birdeye (up to 1000 transactions per token)
    const allTransactionsByToken: TokenTransaction[][] = [];
    for (let i = 0; i < tokenMints.length; i++) {
      const mint = tokenMints[i];
      try {
        // Get up to 1000 transactions (10 pages × 100 transactions) for each token
        const transactions = await getTokenTransactionsPaginated(mint, 10, 'swap');
        allTransactionsByToken.push(transactions);
        
        // Add delay between tokens (600ms) to respect rate limits
        if (i < tokenMints.length - 1) {
          await delay(600);
        }
      } catch (error) {
        console.error(`Error getting transactions for token ${mint}:`, error);
        // Push empty array to maintain array alignment
        allTransactionsByToken.push([]);
      }
    }

    // Step 2: Extract unique wallet addresses from transactions and build intersection map
    // Also track total investment and total removed per wallet
    const walletTokenMap = new Map<string, Set<string>>();
    const walletTransactionCount = new Map<string, number>();
    const walletInvestmentMap = new Map<string, number>(); // Track total USD invested (buy transactions)
    const walletRemovedMap = new Map<string, number>(); // Track total USD removed (sell transactions)

    allTransactionsByToken.forEach((transactions, index) => {
      const tokenMint = tokenMints[index];
      const seenWallets = new Set<string>(); // Track unique wallets per token
      
      transactions.forEach((tx) => {
        const wallet = tx.owner;
        if (!wallet) return; // Skip if no owner
        
        // Initialize wallet tracking if not seen before
        if (!walletTokenMap.has(wallet)) {
          walletTokenMap.set(wallet, new Set());
          walletTransactionCount.set(wallet, 0);
          walletInvestmentMap.set(wallet, 0);
          walletRemovedMap.set(wallet, 0);
        }
        
        // Add this token to the wallet's set (only once per token)
        if (!seenWallets.has(wallet)) {
          walletTokenMap.get(wallet)!.add(tokenMint);
          seenWallets.add(wallet);
        }
        
        // Increment transaction count for this wallet
        walletTransactionCount.set(wallet, walletTransactionCount.get(wallet)! + 1);
        
        // Track investment (buy) and removed (sell) separately
        // For buy: volume_usd represents what the wallet spent (investment)
        // For sell: volume_usd represents what the wallet received (removed)
        // We can also calculate from from/to fields for more accuracy
        let investedUsd = 0;
        let removedUsd = 0;
        
        if (tx.side === 'buy' || tx.tx_type === 'buy') {
          // Buy transaction: wallet is spending money to get tokens
          // Investment = USD value of what they spent
          if (tx.from && tx.from.price && tx.from.ui_change_amount) {
            // from.ui_change_amount is negative for buys (spending)
            investedUsd = tx.from.price * Math.abs(tx.from.ui_change_amount);
          } else {
            // Fallback to volume_usd
            investedUsd = tx.volume_usd || 0;
          }
          const currentInvestment = walletInvestmentMap.get(wallet) || 0;
          walletInvestmentMap.set(wallet, currentInvestment + investedUsd);
        } else if (tx.side === 'sell' || tx.tx_type === 'sell') {
          // Sell transaction: wallet is receiving money from selling tokens
          // Removed = USD value of what they received
          if (tx.to && tx.to.price && tx.to.ui_change_amount) {
            // to.ui_change_amount is positive for sells (receiving)
            removedUsd = tx.to.price * tx.to.ui_change_amount;
          } else {
            // Fallback to volume_usd
            removedUsd = tx.volume_usd || 0;
          }
          const currentRemoved = walletRemovedMap.get(wallet) || 0;
          walletRemovedMap.set(wallet, currentRemoved + removedUsd);
        } else {
          // For 'swap' or unknown types, use volume_usd as investment
          investedUsd = tx.volume_usd || 0;
          const currentInvestment = walletInvestmentMap.get(wallet) || 0;
          walletInvestmentMap.set(wallet, currentInvestment + investedUsd);
        }
      });
    });

    // Step 3: Filter wallets that match criteria (traded 2+ tokens, with min trades)
    const candidateWallets = Array.from(walletTokenMap.entries())
      .filter(([wallet, tokens]) => {
        const matches = tokens.size;
        const trades = walletTransactionCount.get(wallet) || 0;
        return matches >= minMatches && trades >= minTrades;
      })
      .map(([wallet]) => wallet);

    if (candidateWallets.length === 0) {
      return [];
    }

    // Step 4: Map to scanner wallet format and sort by total invested
    const wallets: ScannerWallet[] = candidateWallets.map((wallet) => {
      const walletTokens = Array.from(walletTokenMap.get(wallet) || []);
      const matched = walletTokens.length;
      const totalInvested = walletInvestmentMap.get(wallet) || 0;
      const totalRemoved = walletRemovedMap.get(wallet) || 0;

      return {
        address: wallet,
        matched,
        total: tokenMints.length,
        tokens: walletTokens,
        totalInvested,
        totalRemoved,
      };
    });

    // Step 5: Sort by highest investment to lowest
    return wallets.sort((a, b) => b.totalInvested - a.totalInvested);
  } catch (error) {
    console.error('Error scanning wallets:', error);
    throw error;
  }
}

/**
 * Get wallet analytics summary using PnL endpoint
 */
export interface WalletAnalytics {
  address: string;
  totalTrades: number;
  winRate: number;
  wins: number;
  losses: number;
  totalVolume: number;
  tokens: string[];
  totalPnL?: number;
  totalPnLPercent?: number;
  realizedPnL?: number;
  unrealizedPnL?: number;
}

export async function getWalletAnalytics(
  walletAddress: string,
  duration: 'all' | '90d' | '30d' | '7d' | '24h' = 'all'
): Promise<WalletAnalytics> {
  try {
    // Use PnL summary endpoint for better performance
    const pnlSummary = await getWalletPnLSummary(walletAddress, duration);
    
    if (pnlSummary.success && pnlSummary.data?.summary) {
      const summary = pnlSummary.data.summary;
      
      // Get token list for additional context (optional - can be removed if not needed)
      const tokens: string[] = []; // Placeholder - would need separate API call

      return {
        address: walletAddress,
        totalTrades: summary.counts.total_trade || 0,
        winRate: (summary.counts.win_rate || 0) * 100, // Convert to percentage (0-100)
        wins: summary.counts.total_win || 0,
        losses: summary.counts.total_loss || 0,
        totalVolume: summary.cashflow_usd.total_invested || 0,
        tokens,
        totalPnL: summary.pnl.total_usd,
        totalPnLPercent: summary.pnl.realized_profit_percent,
        realizedPnL: summary.pnl.realized_profit_usd,
        unrealizedPnL: summary.pnl.unrealized_usd,
      };
    }

    throw new Error('Failed to get wallet analytics');
  } catch (error) {
    console.error('Error getting wallet analytics:', error);
    throw error;
  }
}
