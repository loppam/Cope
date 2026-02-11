import type { VercelRequest, VercelResponse } from "@vercel/node";

const BIRDEYE_API_BASE = "https://public-api.birdeye.so";

/** Chain IDs for Relay compatibility. */
const CHAIN_IDS: Record<string, number> = {
  solana: 792703809,
  base: 8453,
  bsc: 56,
  bnb: 56,
};

/** Map app chain name to Birdeye chain name. */
function toBirdeyeChain(chain: string): string {
  return chain === "bnb" ? "bsc" : chain;
}

interface BirdeyeSearchToken {
  address?: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  logoURI?: string;
  liquidity?: number;
  price?: number;
  mc?: number;
  v24hUSD?: number;
  [key: string]: unknown;
}

async function searchHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const apiKey = process.env.BIRDEYE_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: "BIRDEYE_API_KEY not configured" });
    }
    const term = (req.query.term ?? "").toString().trim();
    const limit = Math.min(Math.max(1, parseInt(String(req.query.limit ?? "20"), 10) || 20), 50);
    if (!term) {
      return res.status(400).json({ error: "Missing term (search query)" });
    }

    const chains: Array<{ chain: string; chainId: number }> = [
      { chain: "solana", chainId: CHAIN_IDS.solana },
      { chain: "base", chainId: CHAIN_IDS.base },
      { chain: "bsc", chainId: CHAIN_IDS.bsc },
    ];

    const results: Array<BirdeyeSearchToken & { chain: string; chainId: number }> = [];
    const seen = new Set<string>();

    await Promise.all(
      chains.map(async ({ chain, chainId }) => {
        try {
          const url = new URL(`${BIRDEYE_API_BASE}/defi/v3/search`);
          url.searchParams.set("term", term);
          url.searchParams.set("limit", String(Math.min(limit, 10)));
          const r = await fetch(url.toString(), {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              "X-API-KEY": apiKey,
              "x-chain": chain,
            },
          });
          if (!r.ok) return;
          const data = await r.json();
          const items = Array.isArray(data?.data) ? data.data : Array.isArray(data?.tokens) ? data.tokens : [];
          for (const item of items) {
            const addr = (item?.address ?? item?.mint ?? "").toString().trim();
            if (!addr) continue;
            const key = `${chain}:${addr.toLowerCase()}`;
            if (seen.has(key)) continue;
            seen.add(key);
            results.push({
              ...item,
              chain: chain === "bsc" ? "bnb" : chain,
              chainId,
            });
          }
        } catch {
          // ignore per-chain failures
        }
      })
    );

    results.sort((a, b) => {
      const liqA = Number(a.liquidity ?? a.v24hUSD ?? 0);
      const liqB = Number(b.liquidity ?? b.v24hUSD ?? 0);
      return liqB - liqA;
    });

    return res.status(200).json({
      tokens: results.slice(0, limit),
    });
  } catch (e: unknown) {
    console.error("birdeye search error:", e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : "Internal server error",
    });
  }
}

async function tokenOverviewHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const apiKey = process.env.BIRDEYE_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: "BIRDEYE_API_KEY not configured" });
    }
    const address = (req.query.address ?? "").toString().trim();
    const chainParam = (req.query.chain ?? "solana").toString().toLowerCase();
    const chain = toBirdeyeChain(chainParam);
    if (!address) {
      return res.status(400).json({ error: "Missing address" });
    }

    const url = new URL(`${BIRDEYE_API_BASE}/defi/token_overview`);
    url.searchParams.set("address", address);
    const r = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
        "x-chain": chain,
      },
    });
    const raw = await r.text();
    if (!r.ok) {
      let message = `Birdeye token_overview failed: ${r.status}`;
      try {
        const j = JSON.parse(raw);
        if (j?.message) message = j.message;
        else if (j?.error) message = j.error;
      } catch {
        if (raw) message = raw.slice(0, 200);
      }
      return res.status(r.status >= 500 ? 502 : 400).json({ error: message });
    }
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(502).json({ error: "Invalid JSON from Birdeye" });
    }
    return res.status(200).json(data);
  } catch (e: unknown) {
    console.error("birdeye token-overview error:", e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : "Internal server error",
    });
  }
}

const ROUTES: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<void | VercelResponse>> = {
  search: searchHandler,
  "token-overview": tokenOverviewHandler,
};

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const path = (req.url ?? "").split("?")[0];
  const segments = path.split("/").filter(Boolean);
  const action = segments[segments.length - 1];
  const routeHandler = action ? ROUTES[action] : undefined;
  if (!routeHandler) {
    return res.status(404).json({
      error: "Not found",
      message: `Birdeye action '${action || ""}' not found. Use: search, token-overview`,
    }) as void;
  }
  await routeHandler(req, res);
}
