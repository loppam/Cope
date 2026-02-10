import { getApiBase } from "@/lib/utils";

/**
 * CoinGecko On-Chain token details (proxied via our backend to keep API key server-side).
 * Response shape: { data: [{ id, type: "token", attributes: { address, name, symbol, decimals, image_url, price_usd, fdv_usd, total_reserve_in_usd, volume_usd, market_cap_usd, launchpad_details, ... }, relationships }, ... ], included: [ pool, ... ] }
 */
export interface CoinGeckoTokenResponse {
  data?: Array<{
    id: string;
    type: string;
    attributes: {
      address: string;
      name: string;
      symbol: string;
      decimals: number;
      image_url?: string;
      price_usd?: string;
      fdv_usd?: string;
      total_reserve_in_usd?: string;
      volume_usd?: { h24?: string };
      market_cap_usd?: string | null;
      launchpad_details?: {
        graduation_percentage?: number | null;
        completed?: boolean;
        completed_at?: string | null;
        migrated_destination_pool_address?: string | null;
      };
      last_trade_timestamp?: string;
      [key: string]: unknown;
    };
    relationships?: { top_pools?: { data: Array<{ id: string; type: string }> } };
  }>;
  included?: unknown[];
}

export type CoinGeckoTokenAttributes = NonNullable<CoinGeckoTokenResponse["data"]>[number]["attributes"];

/**
 * Fetch token details from CoinGecko On-Chain API via our relay proxy.
 * @param network - Chain: "solana" | "base" | "bnb"
 * @param addresses - One or more token addresses (comma-separated or array)
 */
export async function fetchCoinGeckoTokenDetails(
  network: string,
  addresses: string | string[]
): Promise<CoinGeckoTokenResponse> {
  const apiBase = getApiBase();
  const list = Array.isArray(addresses) ? addresses : [addresses];
  const params = new URLSearchParams({ network: network.toLowerCase(), addresses: list.join(",") });
  const res = await fetch(`${apiBase}/api/relay/coingecko-tokens?${params.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `CoinGecko tokens failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Map CoinGecko token attributes to fields compatible with TokenSearchResult (partial).
 * Use with existing token from Relay search to fill price, FDV, reserves, launchpad, etc.
 */
export function coingeckoAttributesToTokenFields(attrs: CoinGeckoTokenAttributes): {
  priceUsd?: number;
  marketCapUsd?: number;
  liquidityUsd?: number;
  volume_24h?: number;
  launchpad?: { curvePercentage?: number; completed?: boolean };
  name?: string;
  symbol?: string;
  image?: string;
  decimals?: number;
} {
  const priceUsd = attrs.price_usd != null ? parseFloat(String(attrs.price_usd)) : undefined;
  const fdv = attrs.fdv_usd != null ? parseFloat(String(attrs.fdv_usd)) : undefined;
  const reserveUsd = attrs.total_reserve_in_usd != null ? parseFloat(String(attrs.total_reserve_in_usd)) : undefined;
  const vol = attrs.volume_usd;
  const vol24 = typeof vol === "object" && vol != null && "h24" in vol ? parseFloat(String((vol as { h24?: string }).h24)) : undefined;
  const marketCapUsd = attrs.market_cap_usd != null ? parseFloat(String(attrs.market_cap_usd)) : fdv;
  const lp = attrs.launchpad_details;
  return {
    priceUsd: Number.isFinite(priceUsd) ? priceUsd : undefined,
    marketCapUsd: Number.isFinite(marketCapUsd) ? marketCapUsd : undefined,
    liquidityUsd: Number.isFinite(reserveUsd) ? reserveUsd : undefined,
    volume_24h: Number.isFinite(vol24) ? vol24 : undefined,
    launchpad: lp
      ? { curvePercentage: lp.graduation_percentage ?? undefined, completed: lp.completed }
      : undefined,
    name: attrs.name,
    symbol: attrs.symbol,
    image: attrs.image_url,
    decimals: typeof attrs.decimals === "number" ? attrs.decimals : undefined,
  };
}
