// Jupiter API integration for token search, info, and prices
import type {
  TokenSearchResult,
  TokenSearchResponse,
  TokenInfoResponse,
} from "./solanatracker";

const JUPITER_API_BASE = "https://api.jup.ag";
const SOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * Get Jupiter API key from environment
 */
function getApiKey(): string {
  const apiKey = import.meta.env.VITE_JUPITER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Jupiter API key not configured. Add VITE_JUPITER_API_KEY to .env",
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

/**
 * Make a request to Jupiter API with retry logic and exponential backoff
 */
async function jupiterRequest<T>(
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
  const url = new URL(`${JUPITER_API_BASE}${endpoint}`);

  // Add query params for GET requests
  if (method === "GET" && params) {
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
          error.message || `Jupiter API error: ${response.status}`;

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
 * Jupiter Token Search Response Interface
 */
interface JupiterTokenResult {
  id: string; // mint address
  name: string;
  symbol: string;
  icon?: string;
  decimals: number;
  twitter?: string;
  telegram?: string;
  website?: string;
  dev?: string;
  circSupply?: number;
  totalSupply?: number;
  tokenProgram?: string;
  holderCount?: number;
  fdv?: number;
  mcap?: number;
  usdPrice?: number;
  liquidity?: number;
  priceBlockId?: number;
  stats5m?: JupiterTokenStats;
  stats1h?: JupiterTokenStats;
  stats6h?: JupiterTokenStats;
  stats24h?: JupiterTokenStats;
  firstPool?: {
    id: string;
    createdAt: number;
  };
  audit?: {
    isSus?: boolean;
    mintAuthorityDisabled?: boolean;
    freezeAuthorityDisabled?: boolean;
    topHoldersPercentage?: number;
    devBalancePercentage?: number;
    devMigrations?: number;
  };
  organicScore?: number;
  organicScoreLabel?: "high" | "medium" | "low";
  isVerified?: boolean;
  cexes?: string[];
  tags?: string[];
  updatedAt?: number;
}

interface JupiterTokenStats {
  priceChange?: number;
  holderChange?: number;
  liquidityChange?: number;
  volumeChange?: number;
  buyVolume?: number;
  sellVolume?: number;
  buyOrganicVolume?: number;
  sellOrganicVolume?: number;
  numBuys?: number;
  numSells?: number;
  numTraders?: number;
  numOrganicBuyers?: number;
  numNetBuyers?: number;
}

/**
 * Jupiter Price API Response Interface
 */
interface JupiterPriceData {
  usdPrice: number;
  blockId: number;
  decimals: number;
  priceChange24h?: number;
}

/**
 * Convert Jupiter token result to TokenSearchResult format
 */
function convertJupiterToTokenSearchResult(
  jupiter: JupiterTokenResult,
): TokenSearchResult {
  return {
    id: jupiter.id,
    name: jupiter.name,
    symbol: jupiter.symbol,
    mint: jupiter.id,
    image: jupiter.icon,
    decimals: jupiter.decimals,
    priceUsd: jupiter.usdPrice,
    marketCapUsd: jupiter.mcap,
    liquidityUsd: jupiter.liquidity,
    holders: jupiter.holderCount,
    hasSocials: !!(jupiter.twitter || jupiter.telegram || jupiter.website),
    socials: {
      twitter: jupiter.twitter,
      telegram: jupiter.telegram,
      website: jupiter.website,
    },
    buys: jupiter.stats24h?.numBuys,
    sells: jupiter.stats24h?.numSells,
    totalTransactions:
      (jupiter.stats24h?.numBuys || 0) + (jupiter.stats24h?.numSells || 0),
    volume_24h:
      jupiter.stats24h?.buyVolume && jupiter.stats24h?.sellVolume
        ? jupiter.stats24h.buyVolume + jupiter.stats24h.sellVolume
        : undefined,
    volume_1h:
      jupiter.stats1h?.buyVolume && jupiter.stats1h?.sellVolume
        ? jupiter.stats1h.buyVolume + jupiter.stats1h.sellVolume
        : undefined,
    volume_6h:
      jupiter.stats6h?.buyVolume && jupiter.stats6h?.sellVolume
        ? jupiter.stats6h.buyVolume + jupiter.stats6h.sellVolume
        : undefined,
    top10: jupiter.audit?.topHoldersPercentage,
    dev: jupiter.audit?.devBalancePercentage,
    riskScore: jupiter.organicScore ? 100 - jupiter.organicScore : undefined, // Invert organic score to risk score
    freezeAuthority:
      jupiter.audit?.freezeAuthorityDisabled === false ? "enabled" : null,
    mintAuthority:
      jupiter.audit?.mintAuthorityDisabled === false ? "enabled" : null,
    deployer: jupiter.dev,
    status: jupiter.isVerified ? "verified" : undefined,
    createdAt: jupiter.firstPool?.createdAt,
    lastUpdated: jupiter.updatedAt,
  };
}

/**
 * Convert Jupiter token result to TokenInfoResponse format
 */
function convertJupiterToTokenInfoResponse(
  jupiter: JupiterTokenResult,
): TokenInfoResponse {
  return {
    token: {
      name: jupiter.name,
      symbol: jupiter.symbol,
      mint: jupiter.id,
      decimals: jupiter.decimals,
      image: jupiter.icon,
      strictSocials: {
        twitter: jupiter.twitter,
        telegram: jupiter.telegram,
        website: jupiter.website,
      },
      creation: jupiter.firstPool
        ? {
            creator: jupiter.dev || "",
            created_tx: jupiter.firstPool.id,
            created_time: Math.floor(jupiter.firstPool.createdAt / 1000),
          }
        : undefined,
    },
    pools:
      jupiter.liquidity && jupiter.usdPrice
        ? [
            {
              poolId: jupiter.firstPool?.id || "",
              liquidity: {
                quote: 0,
                usd: jupiter.liquidity,
              },
              price: {
                quote: 0,
                usd: jupiter.usdPrice,
              },
              marketCap: jupiter.mcap
                ? {
                    quote: 0,
                    usd: jupiter.mcap,
                  }
                : undefined,
              market: "jupiter",
              quoteToken: SOL_MINT,
              decimals: jupiter.decimals,
              lastUpdated: jupiter.updatedAt || Date.now(),
              deployer: jupiter.dev,
              txns: {
                buys: jupiter.stats24h?.numBuys || 0,
                sells: jupiter.stats24h?.numSells || 0,
                total:
                  (jupiter.stats24h?.numBuys || 0) +
                  (jupiter.stats24h?.numSells || 0),
                volume:
                  (jupiter.stats24h?.buyVolume || 0) +
                  (jupiter.stats24h?.sellVolume || 0),
                volume24h:
                  (jupiter.stats24h?.buyVolume || 0) +
                  (jupiter.stats24h?.sellVolume || 0),
              },
            },
          ]
        : [],
    events: {
      "24h": jupiter.stats24h?.priceChange
        ? { priceChangePercentage: jupiter.stats24h.priceChange }
        : undefined,
      "6h": jupiter.stats6h?.priceChange
        ? { priceChangePercentage: jupiter.stats6h.priceChange }
        : undefined,
      "1h": jupiter.stats1h?.priceChange
        ? { priceChangePercentage: jupiter.stats1h.priceChange }
        : undefined,
      "5m": jupiter.stats5m?.priceChange
        ? { priceChangePercentage: jupiter.stats5m.priceChange }
        : undefined,
    },
    risk: {
      top10: jupiter.audit?.topHoldersPercentage,
      dev: jupiter.audit?.devBalancePercentage
        ? {
            percentage: jupiter.audit.devBalancePercentage,
            amount: 0,
          }
        : undefined,
      score: jupiter.organicScore ? 100 - jupiter.organicScore : undefined,
      jupiterVerified: jupiter.isVerified,
      bundlers: undefined,
      snipers: undefined,
      insiders: undefined,
      fees: undefined,
      rugged: jupiter.audit?.isSus,
    },
    buys: jupiter.stats24h?.numBuys || 0,
    sells: jupiter.stats24h?.numSells || 0,
    txns: (jupiter.stats24h?.numBuys || 0) + (jupiter.stats24h?.numSells || 0),
    holders: jupiter.holderCount || 0,
  };
}

/**
 * Search tokens using Jupiter Ultra API
 * Maintains same interface as SolanaTracker searchTokens
 */
export async function searchTokens(
  query: string,
  page: number = 1,
  limit: number = 100,
  sortBy: string = "createdAt",
  sortOrder: "asc" | "desc" = "desc",
): Promise<TokenSearchResponse> {
  try {
    const tokens = await jupiterRequest<JupiterTokenResult[]>(
      "/ultra/v1/search",
      {
        method: "GET",
        params: { query },
        retries: 3,
        baseDelay: 1000,
      },
    );

    // Convert Jupiter results to TokenSearchResult format
    const data = tokens.slice(0, limit).map(convertJupiterToTokenSearchResult);

    return {
      status: "success",
      data,
      total: tokens.length,
      pages: Math.ceil(tokens.length / limit),
      page,
      hasMore: tokens.length > limit,
    };
  } catch (error) {
    console.error("Error searching tokens:", error);
    throw error;
  }
}

/**
 * Get token info using Jupiter Ultra API
 * Maintains same interface as SolanaTracker getTokenInfo
 */
export async function getTokenInfo(
  tokenAddress: string,
): Promise<TokenInfoResponse> {
  try {
    // Jupiter search by mint address returns single token
    const tokens = await jupiterRequest<JupiterTokenResult[]>(
      "/ultra/v1/search",
      {
        method: "GET",
        params: { query: tokenAddress },
        retries: 3,
        baseDelay: 1000,
      },
    );

    if (!tokens || tokens.length === 0) {
      throw new Error("Token not found");
    }

    // Convert first result to TokenInfoResponse format
    return convertJupiterToTokenInfoResponse(tokens[0]);
  } catch (error) {
    console.error("Error fetching token info:", error);
    throw error;
  }
}

/**
 * Get SOL price using Jupiter Price API V3
 * Maintains same interface as SolanaTracker getSolPrice
 */
export async function getSolPrice(): Promise<number> {
  try {
    const response = await jupiterRequest<Record<string, JupiterPriceData>>(
      "/price/v3",
      {
        method: "GET",
        params: { ids: SOL_MINT },
        retries: 3,
        baseDelay: 1000,
      },
    );

    const solData = response[SOL_MINT];
    if (!solData || !solData.usdPrice) {
      throw new Error("SOL price not available");
    }

    return solData.usdPrice;
  } catch (error) {
    console.error("Error fetching SOL price:", error);
    throw error;
  }
}
