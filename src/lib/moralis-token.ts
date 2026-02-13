import type { TokenSearchResult } from "@/lib/solanatracker";
import { getApiBase } from "@/lib/utils";

/** Check if address is EVM (0x + 40 hex chars). */
export function isEvmAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test((addr ?? "").trim());
}

interface MoralisTokenOverview {
  success?: boolean;
  data?: {
    address?: string;
    name?: string;
    symbol?: string;
    logoURI?: string;
    decimals?: number;
    price?: number;
    marketCap?: number;
    mc?: number;
    liquidity?: number;
    liquidityUsd?: number;
    holder?: number;
    priceChange24hPercent?: number;
    extensions?: {
      website?: string;
      twitter?: string;
      telegram?: string;
      discord?: string;
    };
  };
}

/**
 * Fetch EVM token overview from Moralis (proxied through our backend).
 * Use for Base and BNB chain tokens. Solana tokens use Birdeye.
 */
export async function fetchMoralisTokenOverview(
  address: string,
  chain: "base" | "bnb"
): Promise<MoralisTokenOverview> {
  const apiBase = getApiBase();
  const params = new URLSearchParams({
    address: address.trim(),
    chain: chain === "bnb" ? "bnb" : chain,
  });
  const res = await fetch(
    `${apiBase}/api/moralis/token-overview?${params.toString()}`
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ||
        `Moralis token overview failed: ${res.status}`
    );
  }
  return res.json();
}

/**
 * Map Moralis token_overview response to TokenSearchResult fields.
 */
export function moralisOverviewToTokenFields(
  data: MoralisTokenOverview["data"]
): Partial<TokenSearchResult> {
  if (!data) return {};
  const ext = data.extensions ?? {};
  const marketCap = data.marketCap ?? data.mc;
  return {
    name: data.name,
    symbol: data.symbol,
    image: data.logoURI,
    decimals: typeof data.decimals === "number" ? data.decimals : undefined,
    priceUsd: typeof data.price === "number" ? data.price : undefined,
    marketCapUsd: typeof marketCap === "number" ? marketCap : undefined,
    liquidityUsd:
      typeof data.liquidityUsd === "number"
        ? data.liquidityUsd
        : typeof data.liquidity === "number"
          ? data.liquidity
          : undefined,
    holders: typeof data.holder === "number" ? data.holder : undefined,
    socials: {
      website: ext.website,
      twitter: ext.twitter,
      telegram: ext.telegram,
      discord: ext.discord,
    },
  };
}
