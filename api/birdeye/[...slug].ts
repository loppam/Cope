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

/** Check if string looks like a contract address (Solana base58 or EVM 0x+hex). */
function looksLikeAddress(s: string): boolean {
  const t = s.trim();
  if (!t || t.length < 20) return false;
  if (/^0x[a-fA-F0-9]{40}$/.test(t)) return true; // EVM
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t)) return true; // Solana base58
  return false;
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
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });
  try {
    const apiKey = process.env.BIRDEYE_API_KEY;
    if (!apiKey) {
      console.error("[birdeye search] BIRDEYE_API_KEY not configured");
      return res.status(503).json({ error: "BIRDEYE_API_KEY not configured" });
    }
    const term = (req.query.term ?? "").toString().trim();
    const limit = Math.min(
      Math.max(1, parseInt(String(req.query.limit ?? "20"), 10) || 20),
      50,
    );
    const chainsParam = (req.query.chains ?? "solana,base,bsc").toString().toLowerCase();
    const allowedChains = new Set(chainsParam.split(",").map((c) => c.trim()));
    if (!term) {
      return res.status(400).json({ error: "Missing term (search query)" });
    }

    const allChains: Array<{ chain: string; chainId: number }> = [
      { chain: "solana", chainId: CHAIN_IDS.solana },
      { chain: "base", chainId: CHAIN_IDS.base },
      { chain: "bsc", chainId: CHAIN_IDS.bsc },
    ];
    const chains = allChains.filter((c) => {
      const appChain = c.chain === "bsc" ? "bnb" : c.chain;
      return allowedChains.has(c.chain) || allowedChains.has(appChain);
    });
    if (chains.length === 0) {
      return res.status(400).json({ error: "No valid chains. Use solana, base, bnb" });
    }

    console.log("[birdeye search] request", {
      term: term.slice(0, 42) + (term.length > 42 ? "…" : ""),
      limit,
      chains: chains.map((c) => c.chain),
    });

    const results: Array<
      BirdeyeSearchToken & { chain: string; chainId: number }
    > = [];
    const seen = new Set<string>();

    await Promise.all(
      chains.map(async ({ chain, chainId }) => {
        try {
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
              "x-chain": chain,
            },
          });
          if (!r.ok) {
            const errBody = await r.text().catch(() => "");
            console.warn("[birdeye search] chain failed", {
              chain,
              status: r.status,
              statusText: r.statusText,
              body: errBody.slice(0, 150),
            });
            return;
          }
          const data = await r.json();
          const rawItems =
            data?.data?.items ?? data?.data ?? data?.tokens ?? [];
          const items: Array<Record<string, unknown>> = [];
          if (Array.isArray(rawItems)) {
            for (const entry of rawItems) {
              if (entry?.type === "token" && entry?.result != null) {
                const arr = Array.isArray(entry.result)
                  ? entry.result
                  : [entry.result];
                for (const tok of arr) {
                  if (tok && (tok.address ?? tok.mint)) items.push(tok);
                }
              } else if (entry?.address ?? entry?.mint) {
                items.push(entry);
              }
            }
          }
          for (const item of items) {
            const addr = (item?.address ?? item?.mint ?? "").toString().trim();
            if (!addr) continue;
            const key = `${chain}:${addr.toLowerCase()}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const liq =
              item?.liquidity ?? item?.volume_24h_usd ?? item?.v24hUSD;
            const mc = item?.market_cap ?? item?.mc;
            const v24h = item?.volume_24h_usd ?? item?.v24hUSD;
            const logo = item?.logo_uri ?? item?.logoURI;
            results.push({
              address: addr,
              symbol: item?.symbol != null ? String(item.symbol) : undefined,
              name: item?.name != null ? String(item.name) : undefined,
              decimals:
                typeof item?.decimals === "number" ? item.decimals : undefined,
              logoURI: logo != null ? String(logo) : undefined,
              liquidity: typeof liq === "number" ? liq : undefined,
              price: typeof item?.price === "number" ? item.price : undefined,
              mc: typeof mc === "number" ? mc : undefined,
              v24hUSD: typeof v24h === "number" ? v24h : undefined,
              chain: chain === "bsc" ? "bnb" : chain,
              chainId,
            });
          }
        } catch (chainErr) {
          console.warn("[birdeye search] chain error", {
            chain,
            error: chainErr instanceof Error ? chainErr.message : String(chainErr),
          });
        }
      }),
    );

    results.sort((a, b) => {
      const liqA = Number(a.liquidity ?? a.v24hUSD ?? 0);
      const liqB = Number(b.liquidity ?? b.v24hUSD ?? 0);
      return liqB - liqA;
    });

    console.log("[birdeye search] result", {
      totalResults: results.length,
      returnedCount: Math.min(results.length, limit),
      chains: [...new Set(results.map((r) => r.chain))],
    });
    return res.status(200).json({
      tokens: results.slice(0, limit),
    });
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error("[birdeye search] error", {
      message: err.message,
      stack: err.stack,
      term: (req.query.term ?? "").toString().slice(0, 42),
    });
    return res.status(500).json({
      error: err.message || "Internal server error",
    });
  }
}

async function tokenOverviewHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });
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

async function ohlcvHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });
  try {
    const apiKey = process.env.BIRDEYE_API_KEY;
    if (!apiKey)
      return res.status(503).json({ error: "BIRDEYE_API_KEY not configured" });
    const address = (req.query.address ?? "").toString().trim();
    const chainParam = (req.query.chain ?? "solana").toString().toLowerCase();
    const chain = chainParam === "bnb" ? "bsc" : chainParam;
    const type = (req.query.type ?? "1H").toString();
    const limit = Math.min(
      Math.max(1, parseInt(String(req.query.limit ?? "100"), 10) || 100),
      1000,
    );
    if (!address) return res.status(400).json({ error: "Missing address" });

    const url = new URL(`${BIRDEYE_API_BASE}/defi/ohlcv`);
    url.searchParams.set("address", address);
    url.searchParams.set("type", type);
    url.searchParams.set("limit", String(limit));

    const r = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
        "x-chain": chain,
      },
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok)
      return res.status(r.status >= 500 ? 502 : 400).json(data?.detail ?? data);
    return res.status(200).json(data);
  } catch (e: unknown) {
    console.error("birdeye ohlcv error:", e);
    return res
      .status(500)
      .json({
        error: e instanceof Error ? e.message : "Internal server error",
      });
  }
}

async function historyPriceHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });
  try {
    const apiKey = process.env.BIRDEYE_API_KEY;
    if (!apiKey)
      return res.status(503).json({ error: "BIRDEYE_API_KEY not configured" });
    const address = (req.query.address ?? "").toString().trim();
    const chainParam = (req.query.chain ?? "solana").toString().toLowerCase();
    const chain = chainParam === "bnb" ? "bsc" : chainParam;
    const addressType = (req.query.address_type ?? "token").toString();
    if (!address) return res.status(400).json({ error: "Missing address" });

    const url = new URL(`${BIRDEYE_API_BASE}/defi/history_price`);
    url.searchParams.set("address", address);
    url.searchParams.set("address_type", addressType);

    const r = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
        "x-chain": chain,
      },
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok)
      return res.status(r.status >= 500 ? 502 : 400).json(data?.detail ?? data);
    return res.status(200).json(data);
  } catch (e: unknown) {
    console.error("birdeye history-price error:", e);
    return res
      .status(500)
      .json({
        error: e instanceof Error ? e.message : "Internal server error",
      });
  }
}

const ROUTES: Record<
  string,
  (req: VercelRequest, res: VercelResponse) => Promise<void | VercelResponse>
> = {
  search: searchHandler,
  "token-overview": tokenOverviewHandler,
  ohlcv: ohlcvHandler,
  "history-price": historyPriceHandler,
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  const path = (req.url ?? "").split("?")[0];
  const segments = path.split("/").filter(Boolean);
  const action = segments[segments.length - 1];
  const routeHandler = action ? ROUTES[action] : undefined;
  if (!routeHandler) {
    res.status(404).json({
      error: "Not found",
      message: `Birdeye action '${action || ""}' not found. Use: search, token-overview, ohlcv, history-price`,
    });
    return;
  }
  await routeHandler(req, res);
}
