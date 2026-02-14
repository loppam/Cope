/**
 * GET /api/trending-tokens
 * Fetches trending tokens from Birdeye (defi/token_trending).
 * Multi-chain: fetches solana, base, bsc and merges (round-robin). Single-chain if chain param set.
 * Query: offset (default 0), limit (default 20, max 20), chain (solana|base|bsc|all), sort_by (rank|volumeUSD|liquidity).
 * Returns { tokens, total, nextOffset }. Requires BIRDEYE_API_KEY.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";

const BIRDEYE_API_BASE = "https://public-api.birdeye.so";
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 20;
const CHAINS = ["solana", "base", "bsc"] as const;
const SORT_BY_VALUES = ["rank", "volumeUSD", "liquidity"] as const;

export interface TrendingToken {
  chainId: string;
  tokenAddress: string;
  symbol: string;
  name: string;
  priceUsd: string;
  marketCap: number;
  priceChange24: number | null;
  imageUrl: string | null;
}

interface BirdeyeTrendingItem {
  address?: string;
  symbol?: string;
  name?: string;
  price?: number;
  marketcap?: number;
  price24hChangePercent?: number;
  logoURI?: string;
}

interface BirdeyeTrendingResponse {
  success?: boolean;
  data?: {
    tokens?: BirdeyeTrendingItem[];
    total?: number;
  };
}

function toTrendingToken(item: BirdeyeTrendingItem, chainId: string): TrendingToken {
  const price = item.price;
  const priceUsd =
    price != null && Number.isFinite(price)
      ? (price < 0.0001 ? price.toExponential(4) : price.toString())
      : "0";
  const marketCap =
    item.marketcap != null && Number.isFinite(item.marketcap) ? item.marketcap : 0;
  const priceChange24 =
    item.price24hChangePercent != null && Number.isFinite(item.price24hChangePercent)
      ? item.price24hChangePercent
      : null;
  return {
    chainId,
    tokenAddress: item.address ?? "",
    symbol: item.symbol ?? "—",
    name: item.name ?? item.symbol ?? "—",
    priceUsd,
    marketCap,
    priceChange24,
    imageUrl: item.logoURI ?? null,
  };
}

async function fetchBirdeyeTrending(
  apiKey: string,
  chain: string,
  offset: number,
  limit: number,
  sortBy: string,
): Promise<{ tokens: TrendingToken[]; total: number }> {
  const url = new URL(`${BIRDEYE_API_BASE}/defi/token_trending`);
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("sort_by", sortBy);
  url.searchParams.set("interval", "24h");
  url.searchParams.set("sort_type", "desc");

  const res = await fetch(url.toString(), {
    headers: {
      "X-API-KEY": apiKey,
      "x-chain": chain,
    },
  });

  if (!res.ok) {
    throw new Error(`Birdeye ${chain}: ${res.status}`);
  }

  const body: BirdeyeTrendingResponse = await res.json();
  const rawTokens = body.data?.tokens ?? [];
  const total = body.data?.total ?? 0;
  const tokens = rawTokens.map((t) => toTrendingToken(t, chain));
  return { tokens, total };
}

/** Merge 3 chain arrays round-robin: [s0, b0, sc0, s1, b1, sc1, ...] */
function mergeRoundRobin(
  solana: TrendingToken[],
  base: TrendingToken[],
  bsc: TrendingToken[],
  maxLen: number,
): TrendingToken[] {
  const out: TrendingToken[] = [];
  const n = Math.max(solana.length, base.length, bsc.length);
  for (let i = 0; i < n && out.length < maxLen; i++) {
    if (solana[i]) out.push(solana[i]);
    if (out.length >= maxLen) break;
    if (base[i]) out.push(base[i]);
    if (out.length >= maxLen) break;
    if (bsc[i]) out.push(bsc[i]);
  }
  return out.slice(0, maxLen);
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.BIRDEYE_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "BIRDEYE_API_KEY not configured" });
    return;
  }

  const chainParam =
    typeof req.query.chain === "string" ? req.query.chain.toLowerCase() : "all";
  const multiChain =
    chainParam === "all" ||
    !(CHAINS as readonly string[]).includes(chainParam as (typeof CHAINS)[number]);

  const sortBy =
    typeof req.query.sort_by === "string" &&
    (SORT_BY_VALUES as readonly string[]).includes(req.query.sort_by)
      ? req.query.sort_by
      : "rank";

  const offset = Math.max(0, parseInt(String(req.query.offset ?? 0), 10) || 0);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(String(req.query.limit ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
  );

  try {
    if (multiChain) {
      const perChainLimit = Math.ceil(limit / 3);
      const [solanaRes, baseRes, bscRes] = await Promise.all([
        fetchBirdeyeTrending(apiKey, "solana", offset, perChainLimit, sortBy),
        fetchBirdeyeTrending(apiKey, "base", offset, perChainLimit, sortBy),
        fetchBirdeyeTrending(apiKey, "bsc", offset, perChainLimit, sortBy),
      ]);
      const tokens = mergeRoundRobin(
        solanaRes.tokens,
        baseRes.tokens,
        bscRes.tokens,
        limit,
      );
      const total =
        3 *
        Math.min(solanaRes.total, baseRes.total, bscRes.total);
      const nextOffset = offset + perChainLimit;

      res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=60");
      res.status(200).json({ tokens, total, nextOffset });
      return;
    }

    const chain = chainParam as (typeof CHAINS)[number];
    const { tokens, total } = await fetchBirdeyeTrending(apiKey, chain, offset, limit, sortBy);
    const nextOffset = offset + tokens.length;

    res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=60");
    res.status(200).json({ tokens, total, nextOffset });
  } catch (error) {
    console.error("[trending-tokens]", error);
    res.status(500).json({ error: "Failed to fetch trending tokens" });
  }
}
