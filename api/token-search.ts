/**
 * GET /api/token-search?term=...&limit=20
 * Unified search: Moralis for EVM (Base, BNB), Birdeye for Solana.
 * - 0x address → Moralis only (parallel probe, pick by liquidity)
 * - Solana address → Birdeye Solana only
 * - Text → both in parallel, merge and sort by liquidity
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";

function isEvmAddress(s: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test((s ?? "").trim());
}

function isSolanaAddress(s: string): boolean {
  const t = (s ?? "").trim();
  return t.length >= 32 && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t);
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
      type: isEvmAddress(term) ? "evm_address" : isSolanaAddress(term) ? "solana_address" : "text",
    });

    if (!term) {
      res.status(400).json({ error: "Missing term" });
      return;
    }

    const host = req.headers?.host ?? process.env.VERCEL_URL ?? "localhost:3000";
    const protocol = host.includes("localhost") ? "http" : "https";
    const origin = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : `${protocol}://${host}`;

    if (isEvmAddress(term)) {
      const moralisUrl = `${origin}/api/moralis/search?term=${encodeURIComponent(term)}&limit=1`;
      console.log("[token-search] evm_address fetch", { url: moralisUrl });
      const r = await fetch(moralisUrl, {
        headers: { accept: "application/json" },
      });
      const json = await r.json().catch((parseErr) => {
        console.error("[token-search] moralis parse error", { status: r.status, parseErr });
        return {};
      });
      if (!r.ok) {
        console.error("[token-search] moralis search failed", {
          status: r.status,
          statusText: r.statusText,
          body: typeof json === "object" ? JSON.stringify(json).slice(0, 200) : String(json).slice(0, 200),
        });
      }
      const tokens = Array.isArray(json?.tokens) ? json.tokens : [];
      console.log("[token-search] evm_address result", { count: tokens.length, tokens: tokens.map((t: { symbol?: string; chain?: string }) => ({ symbol: t.symbol, chain: t.chain })) });
      res.status(200).json({
        tokens: tokens.map((t: UnifiedToken) => toTokenResult(t)),
      });
      return;
    }

    if (isSolanaAddress(term)) {
      const birdeyeUrl = `${origin}/api/birdeye/search?term=${encodeURIComponent(term)}&limit=${limit}&chains=solana`;
      console.log("[token-search] solana_address fetch", { url: birdeyeUrl });
      const r = await fetch(birdeyeUrl, {
        headers: { accept: "application/json" },
      });
      const json = await r.json().catch((parseErr) => {
        console.error("[token-search] birdeye parse error", { status: r.status, parseErr });
        return {};
      });
      if (!r.ok) {
        console.error("[token-search] birdeye search failed", {
          status: r.status,
          statusText: r.statusText,
          body: typeof json === "object" ? JSON.stringify(json).slice(0, 200) : String(json).slice(0, 200),
        });
      }
      const tokens = Array.isArray(json?.tokens) ? json.tokens : [];
      console.log("[token-search] solana_address result", { count: tokens.length });
      res.status(200).json({
        tokens: tokens.map((t: UnifiedToken) => toTokenResult(t)),
      });
      return;
    }

    console.log("[token-search] text search parallel fetch");
    const [birdeyeRes, moralisRes] = await Promise.all([
      fetch(
        `${origin}/api/birdeye/search?term=${encodeURIComponent(term)}&limit=${limit}&chains=solana`,
        { headers: { accept: "application/json" } },
      ).then((r) => r.json().catch(() => ({}))),
      fetch(
        `${origin}/api/moralis/search?term=${encodeURIComponent(term)}&limit=${Math.ceil(limit / 2)}`,
        { headers: { accept: "application/json" } },
      ).then((r) => r.json().catch(() => ({}))),
    ]);

    const birdeyeTokens = Array.isArray(birdeyeRes?.tokens) ? birdeyeRes.tokens : [];
    const moralisTokens = Array.isArray(moralisRes?.tokens) ? moralisRes.tokens : [];

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
      returnedCount: Math.min(merged.length, limit),
    });
    res.status(200).json({
      tokens: merged.slice(0, limit),
    });
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
