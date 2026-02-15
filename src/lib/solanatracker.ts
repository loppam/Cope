/**
 * Shared types and re-exports for token search, info, and transactions.
 * Solana Tracker Data API usage has been replaced by Birdeye (wallet, PnL, scanner)
 * and Jupiter (search, token info, SOL price). This module now provides:
 * - TokenSearchResult, TokenInfoResponse, convertTokenInfoToSearchResult (Jupiter-compatible)
 * - Re-exports from Jupiter (searchTokens, getTokenInfo, getSolPrice)
 * - Re-exports from Birdeye (getTokenTransactions, getTokenTransactionsPaginated)
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
  chain?: "solana" | "base" | "bnb";
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
    liquidity: { quote: number; usd: number };
    price: { quote: number; usd: number };
    marketCap?: { quote: number; usd: number };
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
  events?: Record<string, { priceChangePercentage: number }>;
  risk?: {
    snipers?: { count: number; totalBalance: number; totalPercentage: number };
    bundlers?: { count: number; totalBalance: number; totalPercentage: number };
    insiders?: { count: number; totalBalance: number; totalPercentage: number };
    top10?: number;
    dev?: { percentage: number; amount: number };
    fees?: { totalTrading: number; totalTips: number; total: number };
    rugged?: boolean;
    risks?: Array<{ name: string; description: string; level: string; score: number }>;
    score?: number;
    jupiterVerified?: boolean;
  };
  buys: number;
  sells: number;
  txns: number;
  holders: number;
}

export function convertTokenInfoToSearchResult(
  tokenInfo: TokenInfoResponse,
): TokenSearchResult {
  const primaryPool =
    tokenInfo.pools && tokenInfo.pools.length > 0
      ? tokenInfo.pools.reduce((best, current) => {
          const bestLiq = best?.liquidity?.usd || 0;
          const curLiq = current?.liquidity?.usd || 0;
          return curLiq > bestLiq ? current : best;
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
    launchpad: tokenInfo.token.creation ? { curvePercentage: undefined } : undefined,
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

export interface PriceResponse {
  price: number;
  priceQuote: number;
  liquidity: number;
  marketCap: number;
  lastUpdated: number;
}

export {
  getTokenTransactions,
  getTokenTransactionsPaginated,
  type TokenTransaction,
  type TokenTransactionsResponse,
} from "./birdeye";

export { searchTokens, getTokenInfo, getSolPrice } from "./jupiter";
