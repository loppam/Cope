import type { TokenSearchResult } from "@/lib/solanatracker";
import { getApiBase } from "@/lib/utils";

const CHAIN_IDS: Record<string, number> = {
  solana: 792703809,
  base: 8453,
  bnb: 56,
  bsc: 56,
};

/** App chain name to Birdeye chain (bnb → bsc). */
function toBirdeyeChain(chain: "solana" | "base" | "bnb"): string {
  return chain === "bnb" ? "bsc" : chain;
}

export interface BirdeyeSearchToken {
  address?: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  logoURI?: string;
  liquidity?: number;
  price?: number;
  mc?: number;
  v24hUSD?: number;
  chain?: string;
  chainId?: number;
  [key: string]: unknown;
}

export interface BirdeyeTokenOverview {
  success?: boolean;
  data?: {
    address?: string;
    symbol?: string;
    name?: string;
    decimals?: number;
    logoURI?: string;
    price?: number;
    mc?: number;
    liquidity?: number;
    v24hUSD?: number;
    v24h?: number;
    trade24h?: number;
    buy24h?: number;
    sell24h?: number;
    priceChange24hPercent?: number;
    extensions?: {
      website?: string;
      twitter?: string;
      telegram?: string;
      coingeckoId?: string;
    };
    [key: string]: unknown;
  };
}

/** Check if string looks like a contract address (Solana base58 or EVM 0x+hex). */
function looksLikeAddress(s: string): boolean {
  const t = s.trim();
  if (!t || t.length < 20) return false;
  if (/^0x[a-fA-F0-9]{40}$/.test(t)) return true; // EVM
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t)) return true; // Solana base58
  return false;
}

/**
 * Search tokens via Birdeye API (proxied through our backend).
 * Returns tokens from Solana, Base, and BNB merged and sorted by liquidity.
 * When input looks like a contract address and search returns empty, falls back to token-overview.
 */
export async function searchBirdeyeTokens(
  term: string,
  limit = 20
): Promise<TokenSearchResult[]> {
  const apiBase = getApiBase();
  const trimmed = term.trim();
  const params = new URLSearchParams({ term: trimmed, limit: String(limit) });
  const res = await fetch(`${apiBase}/api/birdeye/search?${params.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Birdeye search failed: ${res.status}`);
  }
  const json = await res.json();
  let tokens = Array.isArray(json?.tokens) ? json.tokens : [];
  if (tokens.length === 0 && looksLikeAddress(trimmed)) {
    const chains: Array<"solana" | "base" | "bnb"> = ["solana", "base", "bnb"];
    for (const chain of chains) {
      try {
        const overview = await fetchBirdeyeTokenOverview(trimmed, chain);
        const data = overview?.data;
        if (data?.address ?? data?.symbol) {
          const r: BirdeyeSearchToken = {
            address: data.address ?? trimmed,
            symbol: data.symbol,
            name: data.name,
            decimals: data.decimals,
            logoURI: data.logoURI,
            liquidity: data.liquidity,
            price: data.price,
            mc: data.mc,
            v24hUSD: data.v24hUSD ?? data.v24h,
            chain: chain,
            chainId: CHAIN_IDS[chain],
          };
          tokens = [r];
          break;
        }
      } catch {
        // try next chain
      }
    }
  }
  return tokens.map((t: BirdeyeSearchToken) => birdeyeSearchToTokenResult(t));
}

function birdeyeSearchToTokenResult(t: BirdeyeSearchToken): TokenSearchResult {
  const chain = (t.chain === "bsc" ? "bnb" : t.chain) as "solana" | "base" | "bnb";
  const chainId = t.chainId ?? CHAIN_IDS[chain] ?? CHAIN_IDS.solana;
  const address = (t.address ?? t.mint ?? "").toString().trim();
  return {
    id: `${chainId}-${address}`,
    name: (t.name ?? "").toString() || "Unknown",
    symbol: (t.symbol ?? "").toString() || "???",
    mint: address,
    image: t.logoURI,
    decimals: typeof t.decimals === "number" ? t.decimals : 6,
    hasSocials: false,
    chain,
    chainId,
    priceUsd: typeof t.price === "number" ? t.price : undefined,
    marketCapUsd: typeof t.mc === "number" ? t.mc : undefined,
    liquidityUsd: typeof t.liquidity === "number" ? t.liquidity : undefined,
    volume_24h: typeof t.v24hUSD === "number" ? t.v24hUSD : undefined,
  };
}

/**
 * Fetch token overview from Birdeye (proxied through our backend).
 */
export async function fetchBirdeyeTokenOverview(
  address: string,
  chain: "solana" | "base" | "bnb"
): Promise<BirdeyeTokenOverview> {
  const apiBase = getApiBase();
  const params = new URLSearchParams({
    address: address.trim(),
    chain: toBirdeyeChain(chain),
  });
  const res = await fetch(`${apiBase}/api/birdeye/token-overview?${params.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Birdeye token overview failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Map Birdeye token_overview response to TokenSearchResult fields.
 */
export function birdeyeOverviewToTokenFields(data: BirdeyeTokenOverview["data"]): Partial<TokenSearchResult> {
  if (!data) return {};
  const ext = data.extensions ?? {};
  return {
    name: data.name,
    symbol: data.symbol,
    image: data.logoURI,
    decimals: typeof data.decimals === "number" ? data.decimals : undefined,
    priceUsd: typeof data.price === "number" ? data.price : undefined,
    marketCapUsd: typeof data.mc === "number" ? data.mc : undefined,
    liquidityUsd: typeof data.liquidity === "number" ? data.liquidity : undefined,
    volume_24h:
      typeof data.v24hUSD === "number" ? data.v24hUSD : typeof data.v24h === "number" ? data.v24h : undefined,
    buys: data.buy24h,
    sells: data.sell24h,
    totalTransactions: data.trade24h,
    socials: {
      website: ext.website,
      twitter: ext.twitter,
      telegram: ext.telegram,
    },
  };
}
