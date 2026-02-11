// SolanaTracker Data API integration for Solana wallet analytics
import { apiCache } from "./cache";

const SOLANATRACKER_API_BASE = "https://data.solanatracker.io";

/**
 * Get SolanaTracker API key from environment
 */
function getApiKey(): string {
  const apiKey = import.meta.env.VITE_SOLANATRACKER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "SolanaTracker API key not configured. Add VITE_SOLANATRACKER_API_KEY to .env",
    );
  }
  return apiKey;
}

/**
 * Delay helper function
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Global 1 RPS throttle for all Solana Tracker API requests */
let lastRequestTime = 0;
const MIN_INTERVAL_MS = 1000;

/**
 * Make a request to SolanaTracker API with retry logic and exponential backoff.
 * All requests go through a shared 1 req/sec throttle to respect rate limits.
 */
async function solanatrackerRequest<T>(
  endpoint: string,
  options: {
    method?: "GET" | "POST";
    params?: Record<string, any>;
    body?: any;
    retries?: number;
    baseDelay?: number;
  } = {},
): Promise<T> {
  const {
    method = "GET",
    params,
    body,
    retries = 3,
    baseDelay = 1000,
  } = options;

  const apiKey = getApiKey();
  const url = new URL(`${SOLANATRACKER_API_BASE}${endpoint}`);

  // Add query params for GET requests
  if (method === "GET" && params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        url.searchParams.append(key, String(value));
      }
    });
  }

  // Shared throttle: 1 req/sec across all Solana Tracker endpoints
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_INTERVAL_MS) {
    await delay(MIN_INTERVAL_MS - elapsed);
  }
  lastRequestTime = Date.now();

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const fetchOptions: RequestInit = {
        method,
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
        },
      };

      // Add body for POST requests
      if (method === "POST" && body) {
        fetchOptions.body = JSON.stringify(body);
      }

      const response = await fetch(url.toString(), fetchOptions);

      if (!response.ok) {
        const error = await response
          .json()
          .catch(() => ({ message: "Unknown error" }));
        const errorMessage =
          error.message || `SolanaTracker API error: ${response.status}`;

        // Retry on rate limit (429) or server errors (5xx)
        if (
          (response.status === 429 || response.status >= 500) &&
          attempt < retries
        ) {
          const waitTime = baseDelay * Math.pow(2, attempt);
          console.warn(
            `Rate limited. Retrying in ${waitTime}ms... (attempt ${attempt + 1}/${retries + 1})`,
          );
          await delay(waitTime);
          continue;
        }

        throw new Error(errorMessage);
      }

      return response.json();
    } catch (error: any) {
      // If it's the last attempt or not a retryable error, throw
      if (
        attempt === retries ||
        (error.message &&
          !error.message.includes("429") &&
          !error.message.includes("5"))
      ) {
        throw error;
      }

      // Exponential backoff for network errors
      const waitTime = baseDelay * Math.pow(2, attempt);
      await delay(waitTime);
    }
  }

  throw new Error("Max retries exceeded");
}

/**
 * Token Search Response Interface
 */
export interface TokenSearchResult {
  id: string;
  name: string;
  symbol: string;
  mint: string;
  image?: string;
  decimals: number;
  hasSocials: boolean;
  poolAddress?: string;
  liquidityUsd?: number;
  marketCapUsd?: number;
  priceUsd?: number;
  lpBurn?: number;
  market?: string;
  quoteToken?: string;
  freezeAuthority?: string | null;
  mintAuthority?: string | null;
  deployer?: string;
  status?: string;
  createdAt?: number;
  lastUpdated?: number;
  holders?: number;
  launchpad?: {
    name?: string;
    url?: string;
    logo?: string;
    curvePercentage?: number;
    fee?: number;
  };
  buys?: number;
  sells?: number;
  totalTransactions?: number;
  volume?: number;
  volume_5m?: number;
  volume_15m?: number;
  volume_30m?: number;
  volume_1h?: number;
  volume_6h?: number;
  volume_12h?: number;
  volume_24h?: number;
  top10?: number;
  dev?: number;
  insiders?: number;
  snipers?: number;
  bundlers?: {
    count?: number;
    balance?: number;
    percentage?: number;
  };
  riskScore?: number;
  socials?: {
    twitter?: string;
    website?: string;
    discord?: string;
    telegram?: string;
  };
  fees?: {
    total?: number;
    totalTrading?: number;
    totalTips?: number;
  };
  tokenDetails?: {
    creator?: string;
    tx?: string;
    time?: number;
  };
  /** Chain from Relay (e.g. solana, base, bnb). Set when using Relay token search. */
  chain?: "solana" | "base" | "bnb";
  /** Relay chain ID (792703809 Solana, 8453 Base, 56 BNB). */
  chainId?: number;
}

export interface TokenSearchResponse {
  status: string;
  data: TokenSearchResult[];
  total: number;
  pages: number;
  page: number;
  nextCursor?: string;
  hasMore: boolean;
}

/**
 * Get complete token information by mint address
 * This endpoint returns comprehensive token data including price, market cap, liquidity, etc.
 */
export interface TokenInfoResponse {
  token: {
    name: string;
    symbol: string;
    mint: string;
    uri?: string;
    decimals: number;
    description?: string;
    image?: string;
    hasFileMetaData?: boolean;
    strictSocials?: {
      twitter?: string;
      telegram?: string;
      website?: string;
    };
    creation?: {
      creator: string;
      created_tx: string;
      created_time: number;
    };
  };
  pools: Array<{
    poolId: string;
    liquidity: {
      quote: number;
      usd: number;
    };
    price: {
      quote: number;
      usd: number;
    };
    marketCap?: {
      quote: number;
      usd: number;
    };
    market: string;
    quoteToken: string;
    decimals: number;
    lastUpdated: number;
    deployer?: string;
    lpBurn?: number;
    txns?: {
      buys: number;
      sells: number;
      total: number;
      volume: number;
      volume24h: number;
    };
  }>;
  events?: {
    "1m"?: { priceChangePercentage: number };
    "5m"?: { priceChangePercentage: number };
    "15m"?: { priceChangePercentage: number };
    "30m"?: { priceChangePercentage: number };
    "1h"?: { priceChangePercentage: number };
    "24h"?: { priceChangePercentage: number };
  };
  risk?: {
    snipers?: { count: number; totalBalance: number; totalPercentage: number };
    bundlers?: { count: number; totalBalance: number; totalPercentage: number };
    insiders?: { count: number; totalBalance: number; totalPercentage: number };
    top10?: number;
    dev?: { percentage: number; amount: number };
    fees?: { totalTrading: number; totalTips: number; total: number };
    rugged?: boolean;
    risks?: Array<{
      name: string;
      description: string;
      level: string;
      score: number;
    }>;
    score?: number;
    jupiterVerified?: boolean;
  };
  buys: number;
  sells: number;
  txns: number;
  holders: number;
}

// Token info now provided by Jupiter API
// Re-exported below

/**
 * Convert TokenInfoResponse to TokenSearchResult format for compatibility
 */
export function convertTokenInfoToSearchResult(
  tokenInfo: TokenInfoResponse,
): TokenSearchResult {
  // Get primary pool (pool with highest liquidity USD for most accurate price/market cap)
  const primaryPool =
    tokenInfo.pools && tokenInfo.pools.length > 0
      ? tokenInfo.pools.reduce((best, current) => {
          const bestLiquidity = best?.liquidity?.usd || 0;
          const currentLiquidity = current?.liquidity?.usd || 0;
          return currentLiquidity > bestLiquidity ? current : best;
        })
      : undefined;

  return {
    id: tokenInfo.token.mint,
    name: tokenInfo.token.name,
    symbol: tokenInfo.token.symbol,
    mint: tokenInfo.token.mint,
    image: tokenInfo.token.image,
    decimals: tokenInfo.token.decimals,
    hasSocials:
      !!tokenInfo.token.strictSocials &&
      Object.keys(tokenInfo.token.strictSocials).length > 0,
    poolAddress: primaryPool?.poolId,
    liquidityUsd: primaryPool?.liquidity?.usd,
    marketCapUsd: primaryPool?.marketCap?.usd,
    priceUsd: primaryPool?.price?.usd,
    lpBurn: primaryPool?.lpBurn,
    market: primaryPool?.market,
    quoteToken: primaryPool?.quoteToken,
    freezeAuthority: null,
    mintAuthority: null,
    deployer: primaryPool?.deployer || tokenInfo.token.creation?.creator,
    status: tokenInfo.token.creation ? "active" : undefined,
    createdAt: tokenInfo.token.creation?.created_time
      ? tokenInfo.token.creation.created_time * 1000
      : undefined,
    holders: tokenInfo.holders,
    launchpad: tokenInfo.token.creation
      ? {
          curvePercentage: undefined, // Not available in this endpoint
        }
      : undefined,
    buys: tokenInfo.buys,
    sells: tokenInfo.sells,
    totalTransactions: tokenInfo.txns,
    volume_24h: primaryPool?.txns?.volume24h,
    top10: tokenInfo.risk?.top10,
    dev: tokenInfo.risk?.dev?.percentage,
    bundlers: tokenInfo.risk?.bundlers
      ? {
          count: tokenInfo.risk.bundlers.count,
          balance: tokenInfo.risk.bundlers.totalBalance,
          percentage: tokenInfo.risk.bundlers.totalPercentage,
        }
      : undefined,
    riskScore: tokenInfo.risk?.score,
    socials: tokenInfo.token.strictSocials
      ? {
          twitter: tokenInfo.token.strictSocials.twitter,
          website: tokenInfo.token.strictSocials.website,
          telegram: tokenInfo.token.strictSocials.telegram,
        }
      : undefined,
    fees: tokenInfo.risk?.fees
      ? {
          total: tokenInfo.risk.fees.total,
          totalTrading: tokenInfo.risk.fees.totalTrading,
          totalTips: tokenInfo.risk.fees.totalTips,
        }
      : undefined,
    tokenDetails: tokenInfo.token.creation
      ? {
          creator: tokenInfo.token.creation.creator,
          tx: tokenInfo.token.creation.created_tx,
          time: tokenInfo.token.creation.created_time * 1000,
        }
      : undefined,
  };
}

// Token search now provided by Jupiter API
// Re-exported below

/**
 * Token Trade Interface - matches SolanaTracker response
 */
export interface TokenTrade {
  tx: string;
  amount: number;
  priceUsd: number;
  volume: number;
  volumeSol: number;
  type: "buy" | "sell";
  wallet: string;
  time: number;
  program: string;
  pools: string[];
}

export interface TokenTradesResponse {
  trades: TokenTrade[];
}

// TokenTransaction interfaces are now imported from birdeye.ts

// Re-export Birdeye functions for token transactions (SolanaTracker trades endpoint doesn't have the right structure)
export {
  getTokenTransactions,
  getTokenTransactionsPaginated,
  type TokenTransaction,
  type TokenTransactionsResponse,
} from "./birdeye";

// Re-export Jupiter functions for token search, info, and SOL price
export { searchTokens, getTokenInfo, getSolPrice } from "./jupiter";

/**
 * Price Response Interface
 */
export interface PriceResponse {
  price: number;
  priceQuote: number;
  liquidity: number;
  marketCap: number;
  lastUpdated: number;
}

// SOL price now provided by Jupiter API
// Re-exported below

/**
 * Wallet PnL Response Interface - matches SolanaTracker response
 */
export interface TokenPnLData {
  holding: number;
  held: number;
  sold: number;
  sold_usd: number;
  realized: number;
  unrealized: number;
  total: number;
  total_sold: number;
  total_invested: number;
  average_buy_amount: number;
  current_value: number;
  cost_basis: number;
  first_buy_time: number;
  last_buy_time: number;
  last_sell_time: number;
  last_trade_time: number;
  buy_transactions: number;
  sell_transactions: number;
  total_transactions: number;
}

export interface WalletPnLResponse {
  tokens: Record<string, TokenPnLData>;
}

/**
 * Wallet PnL Summary Interface - aggregated from all tokens
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
 * Get raw wallet PnL data (all tokens)
 * Uses cache to avoid redundant API calls
 */
export async function getWalletPnL(
  walletAddress: string,
  useCache: boolean = true,
): Promise<WalletPnLResponse> {
  const cacheKey = `wallet_pnl_${walletAddress}`;

  // Check cache first
  if (useCache) {
    const cached = apiCache.get<WalletPnLResponse>(cacheKey);
    if (cached) {
      return cached;
    }
  }

  try {
    const response = await solanatrackerRequest<WalletPnLResponse>(
      `/pnl/${walletAddress}`,
      {
        method: "GET",
        retries: 5,
        baseDelay: 2000,
      },
    );

    // Cache the response for 1 minute (60 seconds) to reduce API usage
    if (useCache) {
      apiCache.set(cacheKey, response, 60000);
    }

    return response;
  } catch (error) {
    console.error("Error fetching wallet PnL:", error);
    throw error;
  }
}

/**
 * Get wallet PnL summary (single wallet)
 * Aggregates data from all tokens in the wallet
 */
export async function getWalletPnLSummary(
  walletAddress: string,
  _duration: "all" | "90d" | "30d" | "7d" | "24h" = "all",
): Promise<WalletPnLSummaryResponse> {
  try {
    const response = await getWalletPnL(walletAddress);

    // Aggregate data from all tokens
    const tokens = response.tokens || {};
    const tokenEntries = Object.entries(tokens);

    let totalBuy = 0;
    let totalSell = 0;
    let totalInvested = 0;
    let totalSold = 0;
    let totalRealized = 0;
    let totalUnrealized = 0;
    let totalWins = 0;
    let totalLosses = 0;
    let totalTrades = 0;
    let currentValue = 0;

    tokenEntries.forEach(([_, data]) => {
      totalBuy += data.buy_transactions || 0;
      totalSell += data.sell_transactions || 0;
      totalTrades += data.total_transactions || 0;
      totalInvested += data.total_invested || 0;
      totalSold += data.total_sold || 0;
      totalRealized += data.realized || 0;
      totalUnrealized += data.unrealized || 0;
      currentValue += data.current_value || 0;

      // Count wins/losses (positive realized = win, negative = loss)
      if (data.realized > 0) {
        totalWins += 1;
      } else if (data.realized < 0) {
        totalLosses += 1;
      }
    });

    const totalPnL = totalRealized + totalUnrealized;
    const winRate =
      totalWins + totalLosses > 0 ? totalWins / (totalWins + totalLosses) : 0;
    const avgProfitPerTrade = totalTrades > 0 ? totalRealized / totalTrades : 0;
    const realizedProfitPercent =
      totalInvested > 0 ? (totalRealized / totalInvested) * 100 : 0;

    const summary: WalletPnLSummary = {
      unique_tokens: tokenEntries.length,
      counts: {
        total_buy: totalBuy,
        total_sell: totalSell,
        total_trade: totalTrades,
        total_win: totalWins,
        total_loss: totalLosses,
        win_rate: winRate,
      },
      cashflow_usd: {
        total_invested: totalInvested,
        total_sold: totalSold,
        current_value: currentValue,
      },
      pnl: {
        realized_profit_usd: totalRealized,
        realized_profit_percent: realizedProfitPercent,
        unrealized_usd: totalUnrealized,
        total_usd: totalPnL,
        avg_profit_per_trade_usd: avgProfitPerTrade,
      },
    };

    return {
      success: true,
      data: {
        summary,
      },
    };
  } catch (error) {
    console.error("Error fetching wallet PnL:", error);
    throw error;
  }
}

/**
 * Get token-specific PnL for a wallet
 */
export async function getWalletTokenPnL(
  walletAddress: string,
  tokenAddress: string,
): Promise<TokenPnLData | null> {
  try {
    const response = await solanatrackerRequest<WalletPnLResponse>(
      `/pnl/${walletAddress}/${tokenAddress}`,
      {
        method: "GET",
      },
    );

    // The API might return the same structure or a single token
    // Adjust based on actual API response
    const tokens = response.tokens || {};
    return tokens[tokenAddress] || null;
  } catch (error) {
    console.error("Error fetching wallet token PnL:", error);
    return null;
  }
}

/**
 * SolanaTracker Top Traders API – response row for one token.
 * GET /top-traders/{tokenMint} returns an array of these.
 * held/sold/holding = token amounts; realized/unrealized/total/total_invested = USD.
 */
export interface TopTraderRow {
  wallet: string;
  held: number;
  sold: number;
  holding: number;
  realized: number;
  unrealized: number;
  total: number; // PnL USD (realized + unrealized)
  total_invested: number; // USD cost basis
  tx_counts: { buys: number; sells: number };
}

/**
 * Fetch top traders for a single token (top 100 by PnL).
 * GET https://data.solanatracker.io/top-traders/{tokenMint}
 */
export async function getTopTradersForToken(
  tokenMint: string,
): Promise<TopTraderRow[]> {
  const data = await solanatrackerRequest<TopTraderRow[]>(
    `/top-traders/${tokenMint}`,
    { method: "GET" },
  );
  return Array.isArray(data) ? data : [];
}

const TOP_TRADERS_DELAY_MS = 2000;

/**
 * Per-token stats for a wallet (for accordion breakdown and average ROI).
 */
export interface ScannerTokenStat {
  mint: string;
  totalInvested: number;
  totalPnl: number; // totalRemoved - totalInvested for this token
  roiPct: number | null; // (totalPnl / totalInvested) * 100, or null if totalInvested <= 0
}

/**
 * Scanner functionality - Find wallets that traded multiple tokens
 */
export interface ScannerWallet {
  address: string;
  matched: number;
  total: number;
  tokens: string[];
  totalInvested: number; // Sum across tokens
  totalRemoved: number; // Sum across tokens
  /** Per-token invested, PnL, and ROI for accordion breakdown */
  tokenStats: ScannerTokenStat[];
  /** Average of each token's ROI % (only tokens with valid ROI); null if none */
  averageRoiPct: number | null;
}

/**
 * Scan for wallets that traded multiple tokens using SolanaTracker Top Traders API.
 *
 * Flow:
 * 1. For each token, GET /top-traders/{mint} with 2s delay between tokens
 * 2. Find wallets that appear in 2+ token results (recurring)
 * 3. Build per-token stats and average ROI from API data
 * 4. Sort by total PnL (desc)
 */
export async function scanWalletsForTokens(
  tokenMints: string[],
  minMatches: number = 2,
  _minTrades: number = 2,
): Promise<ScannerWallet[]> {
  try {
    // Step 1: Get top traders for each token, 2s delay between tokens
    const topTradersByToken: TopTraderRow[][] = [];
    for (let i = 0; i < tokenMints.length; i++) {
      const mint = tokenMints[i];
      try {
        const rows = await getTopTradersForToken(mint);
        topTradersByToken.push(rows);
      } catch (error) {
        console.error(`Error getting top traders for token ${mint}:`, error);
        topTradersByToken.push([]);
      }
      if (i < tokenMints.length - 1) {
        await delay(TOP_TRADERS_DELAY_MS);
      }
    }

    // Step 2: Build wallet -> { tokens, tokenStats[], totalInvested, totalPnl }
    const walletData = new Map<
      string,
      {
        tokens: Set<string>;
        tokenStats: ScannerTokenStat[];
        totalInvested: number;
        totalPnl: number;
      }
    >();

    topTradersByToken.forEach((rows, index) => {
      const tokenMint = tokenMints[index];
      rows.forEach((row) => {
        const w = row.wallet;
        if (!w) return;
        const inv = row.total_invested ?? 0;
        const pnl = row.total ?? 0;
        const totalPnl = pnl;
        const roiPct = inv > 0 ? (totalPnl / inv) * 100 : null;
        const stat: ScannerTokenStat = {
          mint: tokenMint,
          totalInvested: inv,
          totalPnl,
          roiPct,
        };

        if (!walletData.has(w)) {
          walletData.set(w, {
            tokens: new Set(),
            tokenStats: [],
            totalInvested: 0,
            totalPnl: 0,
          });
        }
        const data = walletData.get(w)!;
        if (!data.tokens.has(tokenMint)) {
          data.tokens.add(tokenMint);
          data.tokenStats.push(stat);
          data.totalInvested += inv;
          data.totalPnl += pnl;
        }
      });
    });

    // Step 3: Keep only wallets that appear in >= minMatches tokens
    const candidateWallets = Array.from(walletData.entries()).filter(
      ([_, data]) => data.tokens.size >= minMatches,
    );

    if (candidateWallets.length === 0) {
      return [];
    }

    // Step 4: Map to ScannerWallet; totalRemoved = totalInvested + totalPnl
    const wallets: ScannerWallet[] = candidateWallets.map(([address, data]) => {
      const roiValues = data.tokenStats
        .map((t) => t.roiPct)
        .filter((r): r is number => r !== null);
      const averageRoiPct =
        roiValues.length > 0
          ? roiValues.reduce((a, b) => a + b, 0) / roiValues.length
          : null;

      return {
        address,
        matched: data.tokens.size,
        total: tokenMints.length,
        tokens: Array.from(data.tokens),
        totalInvested: data.totalInvested,
        totalRemoved: data.totalInvested + data.totalPnl,
        tokenStats: data.tokenStats,
        averageRoiPct,
      };
    });

    // Step 5: Sort by total PnL (desc)
    return wallets.sort((a, b) => {
      const pnlA = a.totalRemoved - a.totalInvested;
      const pnlB = b.totalRemoved - b.totalInvested;
      return pnlB - pnlA;
    });
  } catch (error) {
    console.error("Error scanning wallets:", error);
    throw error;
  }
}

/**
 * Get wallet analytics summary using PnL endpoint
 */
/**
 * Wallet Position Token Interface - from /wallet/{owner} endpoint
 */
export interface WalletPositionToken {
  token: {
    name: string;
    symbol: string;
    mint: string;
    uri?: string;
    decimals: number;
    image?: string;
    description?: string;
    hasFileMetaData?: boolean;
    strictSocials?: {
      twitter?: string;
      telegram?: string;
      website?: string;
    };
    creation?: {
      creator: string;
      created_tx: string;
      created_time: number;
    };
  };
  pools: Array<{
    poolId: string;
    liquidity: {
      quote: number;
      usd: number;
    };
    price: {
      quote: number;
      usd: number;
    };
    marketCap?: {
      quote: number;
      usd: number;
    };
    market: string;
    quoteToken: string;
    decimals: number;
    lastUpdated: number;
  }>;
  events?: {
    "1m"?: { priceChangePercentage: number };
    "5m"?: { priceChangePercentage: number };
    "15m"?: { priceChangePercentage: number };
    "30m"?: { priceChangePercentage: number };
    "1h"?: { priceChangePercentage: number };
    "24h"?: { priceChangePercentage: number };
  };
  risk?: {
    snipers?: { count: number; totalBalance: number; totalPercentage: number };
    bundlers?: { count: number; totalBalance: number; totalPercentage: number };
    insiders?: { count: number; totalBalance: number; totalPercentage: number };
    top10?: number;
    dev?: { percentage: number; amount: number };
    fees?: { totalTrading: number; totalTips: number; total: number };
    rugged?: boolean;
    risks?: Array<{
      name: string;
      description: string;
      level: string;
      score: number;
    }>;
    score?: number;
    jupiterVerified?: boolean;
  };
  buys: number;
  sells: number;
  txns: number;
  holders: number;
  balance: number;
  value: number;
}

export interface WalletPositionsResponse {
  tokens: WalletPositionToken[];
  total: number;
  totalSol: number;
}

/**
 * Get wallet positions with full token details (single API call)
 * This endpoint returns all tokens in the wallet with complete metadata
 * Uses cache to avoid redundant API calls
 */
export async function getWalletPositions(
  walletAddress: string,
  useCache: boolean = true,
): Promise<WalletPositionsResponse> {
  const cacheKey = `wallet_positions_${walletAddress}`;

  // Check cache first
  if (useCache) {
    const cached = apiCache.get<WalletPositionsResponse>(cacheKey);
    if (cached) {
      return cached;
    }
  }

  try {
    const response = await solanatrackerRequest<WalletPositionsResponse>(
      `/wallet/${walletAddress}`,
      {
        method: "GET",
        retries: 5,
        baseDelay: 2000,
      },
    );

    // Cache the response for 2 minutes to reduce API usage and rate limit pressure
    if (useCache) {
      apiCache.set(cacheKey, response, 120000);
    }

    return response;
  } catch (error) {
    console.error("Error fetching wallet positions:", error);
    throw error;
  }
}

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
  duration: "all" | "90d" | "30d" | "7d" | "24h" = "all",
): Promise<WalletAnalytics> {
  try {
    // Use PnL summary endpoint
    const pnlSummary = await getWalletPnLSummary(walletAddress, duration);

    if (pnlSummary.success && pnlSummary.data?.summary) {
      const summary = pnlSummary.data.summary;

      // Get token list from PnL response
      const pnlResponse = await solanatrackerRequest<WalletPnLResponse>(
        `/pnl/${walletAddress}`,
        {
          method: "GET",
        },
      );
      const tokens = Object.keys(pnlResponse.tokens || []);

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

    throw new Error("Failed to get wallet analytics");
  } catch (error) {
    console.error("Error getting wallet analytics:", error);
    throw error;
  }
}
