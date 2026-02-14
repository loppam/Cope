/**
 * GET /api/trending-tokens
 * Fetches trending tokens from DexScreener (token-boosts + token-pairs enrichment).
 * Filters to Solana, Base, BNB. No auth required.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";

const DEXSCREENER_BASE = "https://api.dexscreener.com";
const COPE_CHAINS = ["solana", "base", "bsc"] as const;
const MAX_TOKENS = 24;
const BATCH_SIZE = 20;

interface BoostToken {
  chainId: string;
  tokenAddress: string;
  icon?: string;
  header?: string;
  description?: string;
}

interface DexPair {
  chainId: string;
  baseToken: { address: string; symbol: string; name: string };
  priceUsd?: string;
  marketCap?: number;
  priceChange?: { h24?: number };
  info?: { imageUrl?: string };
}

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

function buildIconUrl(icon: string | undefined): string | null {
  if (!icon || icon.length < 4) return null;
  if (icon.startsWith("http")) return icon;
  return `https://cdn.dexscreener.com/cms/images/${icon}?width=64&height=64&fit=crop&quality=95&format=auto`;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const boostsRes = await fetch(`${DEXSCREENER_BASE}/token-boosts/top/v1`);
    if (!boostsRes.ok) {
      throw new Error(`DexScreener boosts: ${boostsRes.status}`);
    }
    const boosts: BoostToken[] = await boostsRes.json();

    const filtered = boosts.filter(
      (b) =>
        COPE_CHAINS.includes(b.chainId as any) &&
        b.tokenAddress?.trim(),
    );
    const byChain = new Map<string, BoostToken[]>();
    for (const b of filtered) {
      const list = byChain.get(b.chainId) ?? [];
      list.push(b);
      byChain.set(b.chainId, list);
    }

    const tokens: TrendingToken[] = [];
    const seen = new Set<string>();

    for (const chainId of COPE_CHAINS) {
      const list = byChain.get(chainId) ?? [];
      const addrs = list
        .slice(0, BATCH_SIZE)
        .map((b) => b.tokenAddress)
        .filter(Boolean);
      if (addrs.length === 0) continue;

      const addrsStr = addrs.join(",");
      const pairsRes = await fetch(
        `${DEXSCREENER_BASE}/token-pairs/v1/${chainId}/${addrsStr}`,
      );
      if (!pairsRes.ok) continue;

      const pairs: DexPair[] = await pairsRes.json();
      const byAddr = new Map<string, DexPair>();
      for (const p of pairs) {
        const addr = (p.baseToken?.address ?? "").toLowerCase();
        if (!addr) continue;
        const existing = byAddr.get(addr);
        const liq = p.info ? 1 : 0;
        const existingLiq = existing?.info ? 1 : 0;
        if (!existing || liq > existingLiq) {
          byAddr.set(addr, p);
        }
      }

      const boostMap = new Map(
        list.map((b) => [b.tokenAddress.toLowerCase(), b]),
      );

      for (const b of list) {
        if (tokens.length >= MAX_TOKENS) break;
        const key = `${chainId}:${b.tokenAddress.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const pair = byAddr.get(b.tokenAddress.toLowerCase());
        const boost = boostMap.get(b.tokenAddress.toLowerCase());

        const symbol = pair?.baseToken?.symbol ?? "—";
        const name = pair?.baseToken?.name ?? symbol;
        const priceUsd = pair?.priceUsd ?? "0";
        const marketCap = pair?.marketCap ?? 0;
        const priceChange24 = pair?.priceChange?.h24 ?? null;
        const imageUrl =
          pair?.info?.imageUrl ??
          (boost?.icon ? buildIconUrl(boost.icon) : null);

        tokens.push({
          chainId,
          tokenAddress: b.tokenAddress,
          symbol,
          name,
          priceUsd,
          marketCap,
          priceChange24,
          imageUrl,
        });
      }
    }

    res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=60");
    res.status(200).json({ tokens });
  } catch (error) {
    console.error("[trending-tokens]", error);
    res.status(500).json({ error: "Failed to fetch trending tokens" });
  }
}
