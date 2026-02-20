/**
 * GET /api/token-search?term=...&limit=20
 * Unified search: Moralis for EVM (Base, BNB), Birdeye for Solana.
 * Calls external APIs directly (no self-fetch) to avoid Vercel deployment protection 401.
 * - 0x address → Moralis only (parallel probe, pick by liquidity)
 * - Solana address → Birdeye Solana only
 * - Text → both in parallel, merge and sort by liquidity
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";

const BIRDEYE_API_BASE = "https://public-api.birdeye.so";
const MORALIS_API_BASE = "https://deep-index.moralis.io/api/v2.2";

function isEvmAddress(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test((s ?? "").trim());
}

function isSolanaAddress(s: string): boolean {
  const t = (s ?? "").trim();
  return t.length >= 32 && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t);
}

function looksLikeAddress(s: string): boolean {
  const t = (s ?? "").trim();
  if (!t || t.length < 20) return false;
  if (/^0x[a-fA-F0-9]{40}$/.test(t)) return true;
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t)) return true;
  return false;
}

const CHAIN_IDS: Record<string, number> = {
  solana: 792703809,
  base: 8453,
  bnb: 56,
  bsc: 56,
};

interface UnifiedToken {
  address?: string;
  mint?: string;
  name?: string;
  symbol?: string;
  logoURI?: string;
  decimals?: number;
  price?: number;
  mc?: number;
  liquidity?: number;
  v24hUSD?: number;
  chain?: string;
  chainId?: number;
}

function toTokenResult(t: UnifiedToken): UnifiedToken {
  const chain = t.chain === "bsc" ? "bnb" : t.chain;
  const chainId =
    t.chainId ?? (chain ? CHAIN_IDS[chain] ?? CHAIN_IDS[chain as keyof typeof CHAIN_IDS] : undefined);
  const addr = (t.address ?? t.mint ?? "").toString().trim();
  return {
    ...t,
    address: addr,
    mint: addr,
    chain,
    chainId,
  };
}

async function birdeyeSearchSolana(
  term: string,
  limit: number,
  apiKey: string,
): Promise<UnifiedToken[]> {
  const url = new URL(`${BIRDEYE_API_BASE}/defi/v3/search`);
  url.searchParams.set("keyword", term);
  url.searchParams.set("limit", String(Math.min(limit, 20)));
  url.searchParams.set("sort_by", "volume_24h_usd");
  url.searchParams.set("sort_type", "desc");
  url.searchParams.set("target", "token");
  if (looksLikeAddress(term)) {
    url.searchParams.set("search_by", "address");
  } else {
    url.searchParams.set("search_by", "combination");
    url.searchParams.set("search_mode", "fuzzy");
  }
  const r = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
      "x-chain": "solana",
    },
  });
  if (!r.ok) {
    const errBody = await r.text().catch(() => "");
    console.warn("[token-search] birdeye solana failed", {
      status: r.status,
      body: errBody.slice(0, 150),
    });
    return [];
  }
  const data = await r.json().catch(() => ({}));
  const rawItems = data?.data?.items ?? data?.data ?? data?.tokens ?? [];
  const items: Array<Record<string, unknown>> = [];
  if (Array.isArray(rawItems)) {
    for (const entry of rawItems) {
      if (entry?.type === "token" && entry?.result != null) {
        const arr = Array.isArray(entry.result) ? entry.result : [entry.result];
        for (const tok of arr) {
          if (tok && (tok.address ?? tok.mint)) items.push(tok);
        }
      } else if (entry?.address ?? entry?.mint) {
        items.push(entry);
      }
    }
  }
  return items.map((item) => {
    const addr = (item?.address ?? item?.mint ?? "").toString().trim();
    const liq = item?.liquidity ?? item?.volume_24h_usd ?? item?.v24hUSD;
    const mc = item?.market_cap ?? item?.mc;
    const v24h = item?.volume_24h_usd ?? item?.v24hUSD;
    return toTokenResult({
      address: addr,
      mint: addr,
      symbol: item?.symbol != null ? String(item.symbol) : undefined,
      name: item?.name != null ? String(item.name) : undefined,
      decimals: typeof item?.decimals === "number" ? item.decimals : undefined,
      logoURI:
        item?.logo_uri != null
          ? String(item.logo_uri)
          : item?.logoURI != null
            ? String(item.logoURI)
            : undefined,
      liquidity: typeof liq === "number" ? liq : undefined,
      price: typeof item?.price === "number" ? item.price : undefined,
      mc: typeof mc === "number" ? mc : undefined,
      v24hUSD: typeof v24h === "number" ? v24h : undefined,
      chain: "solana",
      chainId: CHAIN_IDS.solana,
    });
  });
}

async function moralisSearchEvmAddress(
  addr: string,
  apiKey: string,
): Promise<UnifiedToken[]> {
  const [baseRes, bnbRes] = await Promise.all([
    Promise.all([
      fetch(
        `${MORALIS_API_BASE}/erc20/metadata?chain=base&addresses[]=${encodeURIComponent(addr)}`,
        { headers: { accept: "application/json", "X-API-Key": apiKey } },
      ).then((r) => r.json()),
      fetch(
        `${MORALIS_API_BASE}/erc20/${addr}/price?chain=base`,
        { headers: { accept: "application/json", "X-API-Key": apiKey } },
      ).then((r) => r.json()),
    ]),
    Promise.all([
      fetch(
        `${MORALIS_API_BASE}/erc20/metadata?chain=bsc&addresses[]=${encodeURIComponent(addr)}`,
        { headers: { accept: "application/json", "X-API-Key": apiKey } },
      ).then((r) => r.json()),
      fetch(
        `${MORALIS_API_BASE}/erc20/${addr}/price?chain=bsc`,
        { headers: { accept: "application/json", "X-API-Key": apiKey } },
      ).then((r) => r.json()),
    ]),
  ]);
  const build = (
    meta: unknown,
    price: Record<string, unknown>,
    chain: string,
    chainId: number,
  ): UnifiedToken => {
    const m = Array.isArray(meta) ? meta[0] : null;
    const nameRaw = (m as Record<string, unknown>)?.name ?? price?.tokenName ?? "Unknown";
    const symbolRaw = (m as Record<string, unknown>)?.symbol ?? price?.tokenSymbol ?? "???";
    const name = typeof nameRaw === "string" ? nameRaw : "Unknown";
    const symbol = typeof symbolRaw === "string" ? symbolRaw : "???";
    const liquidity =
      price?.pairTotalLiquidityUsd != null
        ? parseFloat(String(price.pairTotalLiquidityUsd))
        : 0;
    return toTokenResult({
      address: addr,
      mint: addr,
      name,
      symbol,
      logoURI: (() => {
        const v = (m as Record<string, unknown>)?.logo ?? price?.tokenLogo;
        return v != null ? String(v) : undefined;
      })(),
      decimals: parseInt(
        String(
          (m as Record<string, unknown>)?.decimals ?? price?.tokenDecimals ?? 18,
        ),
        10,
      ),
      price:
        price?.usdPrice != null
          ? parseFloat(String(price.usdPrice))
          : undefined,
      mc:
        (m as Record<string, unknown>)?.market_cap != null
          ? parseFloat(String((m as Record<string, unknown>).market_cap))
          : undefined,
      liquidity,
      chain,
      chainId,
    });
  };
  const baseMeta = baseRes[0];
  const basePrice = baseRes[1] as Record<string, unknown>;
  const bnbMeta = bnbRes[0];
  const bnbPrice = bnbRes[1] as Record<string, unknown>;
  const hasBase =
    (Array.isArray(baseMeta) ? baseMeta[0] : baseMeta) || basePrice?.tokenName;
  const hasBnb =
    (Array.isArray(bnbMeta) ? bnbMeta[0] : bnbMeta) || bnbPrice?.tokenName;
  if (!hasBase && !hasBnb) {
    console.log("[token-search] evm_address not found on Base or BNB", {
      address: addr.slice(0, 16) + "…",
    });
    return [];
  }
  const baseLiq =
    basePrice?.pairTotalLiquidityUsd != null
      ? parseFloat(String(basePrice.pairTotalLiquidityUsd))
      : 0;
  const bnbLiq =
    bnbPrice?.pairTotalLiquidityUsd != null
      ? parseFloat(String(bnbPrice.pairTotalLiquidityUsd))
      : 0;
  const useBase = baseLiq >= bnbLiq && hasBase;
  const data = useBase
    ? build(baseMeta, basePrice, "base", 8453)
    : build(bnbMeta, bnbPrice, "bnb", 56);
  return [data];
}

async function moralisSearchSymbol(
  symbol: string,
  limit: number,
  apiKey: string,
): Promise<UnifiedToken[]> {
  const evmChains = [
    { chain: "base", param: "base", chainId: 8453 },
    { chain: "bnb", param: "bsc", chainId: 56 },
  ];
  const results = await Promise.all(
    evmChains.map(async ({ chain, param, chainId }) => {
      try {
        const r = await fetch(
          `${MORALIS_API_BASE}/erc20/metadata/symbols?chain=${param}&symbols[]=${encodeURIComponent(symbol)}`,
          { headers: { accept: "application/json", "X-API-Key": apiKey } },
        );
        if (!r.ok) return [];
        const list = await r.json().catch(() => []);
        const arr = Array.isArray(list) ? list : [];
        return arr.map((item: Record<string, unknown>) =>
          toTokenResult({
            address: (item.address ?? "").toString().toLowerCase(),
            mint: (item.address ?? "").toString().toLowerCase(),
            name: String(item.name ?? "Unknown"),
            symbol: String(item.symbol ?? symbol),
            logoURI: (() => {
              const v = item.logo ?? item.thumbnail;
              return v != null ? String(v) : undefined;
            })(),
            decimals: parseInt(String(item.decimals ?? 18), 10),
            mc:
              item.market_cap != null
                ? parseFloat(String(item.market_cap))
                : undefined,
            chain,
            chainId,
          }),
        );
      } catch {
        return [];
      }
    }),
  );
  const tokens: UnifiedToken[] = [];
  const seen = new Set<string>();
  for (const list of results) {
    for (const t of list) {
      const addr = (t.address ?? t.mint ?? "").toString().toLowerCase();
      if (!addr || seen.has(addr)) continue;
      seen.add(addr);
      tokens.push(t);
    }
  }
  tokens.sort((a, b) => Number(b.mc ?? 0) - Number(a.mc ?? 0));
  return tokens.slice(0, limit);
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const term = (req.query.term ?? "").toString().trim();
  const limit = Math.min(
    Math.max(1, parseInt(String(req.query.limit ?? "20"), 10) || 20),
    50,
  );

  try {
    console.log("[token-search] request", {
      term: term.slice(0, 42) + (term.length > 42 ? "…" : ""),
      limit,
      type: isEvmAddress(term)
        ? "evm_address"
        : isSolanaAddress(term)
          ? "solana_address"
          : "text",
    });

    if (!term) {
      res.status(400).json({ error: "Missing term" });
      return;
    }

    const birdeyeKey = process.env.BIRDEYE_API_KEY;
    const moralisKey =
      process.env.MORALIS_API_KEY;

    if (isEvmAddress(term)) {
      if (!moralisKey) {
        console.error("[token-search] MORALIS_API_KEY not configured");
        res.status(503).json({ error: "MORALIS_API_KEY not configured" });
        return;
      }
      const tokens = await moralisSearchEvmAddress(
        term.toLowerCase(),
        moralisKey,
      );
      console.log("[token-search] evm_address result", { count: tokens.length });
      res.status(200).json({ tokens });
      return;
    }

    if (isSolanaAddress(term)) {
      if (!birdeyeKey) {
        console.error("[token-search] BIRDEYE_API_KEY not configured");
        res.status(503).json({ error: "BIRDEYE_API_KEY not configured" });
        return;
      }
      const tokens = await birdeyeSearchSolana(term, limit, birdeyeKey);
      console.log("[token-search] solana_address result", {
        count: tokens.length,
      });
      res.status(200).json({ tokens: tokens.slice(0, limit) });
      return;
    }

    // Text search: run Birdeye (Solana) + Moralis (EVM symbol) in parallel
    console.log("[token-search] text search parallel fetch");
    const [birdeyeTokens, moralisTokens] = await Promise.all([
      birdeyeKey
        ? birdeyeSearchSolana(term, limit, birdeyeKey)
        : Promise.resolve([]),
      moralisKey
        ? moralisSearchSymbol(
            term.toUpperCase().slice(0, 20),
            Math.ceil(limit / 2),
            moralisKey,
          )
        : Promise.resolve([]),
    ]);

    const seen = new Set<string>();
    const merged: UnifiedToken[] = [];
    for (const t of [...moralisTokens, ...birdeyeTokens]) {
      const addr = (t.address ?? t.mint ?? "").toString().toLowerCase();
      const ch = t.chain === "bsc" ? "bnb" : t.chain ?? "solana";
      const key = `${ch}:${addr}`;
      if (!addr || seen.has(key)) continue;
      seen.add(key);
      merged.push(toTokenResult({ ...t, chain: ch }));
    }
    merged.sort((a, b) => {
      const liqA = Number(a.liquidity ?? a.v24hUSD ?? a.mc ?? 0);
      const liqB = Number(b.liquidity ?? b.v24hUSD ?? b.mc ?? 0);
      return liqB - liqA;
    });

    console.log("[token-search] text merge result", {
      birdeyeCount: birdeyeTokens.length,
      moralisCount: moralisTokens.length,
      mergedCount: merged.length,
    });
    res.status(200).json({ tokens: merged.slice(0, limit) });
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error("[token-search] error", {
      message: err.message,
      stack: err.stack,
      term: term?.slice(0, 42),
    });
    res.status(500).json({
      error: err.message || "Internal server error",
    });
  }
}
