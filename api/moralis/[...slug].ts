import type { VercelRequest, VercelResponse } from "@vercel/node";

const MORALIS_API_BASE = "https://deep-index.moralis.io/api/v2.2";

/** Map app chain name to Moralis chain param. */
function toMoralisChain(chain: string): string {
  return chain === "bnb" ? "bsc" : chain;
}

/** GET /api/moralis/token-overview?address=0x...&chain=base */
async function tokenOverviewHandler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "GET")
    return void res.status(405).json({ error: "Method not allowed" });
  try {
    const apiKey =
      process.env.MORALIS_API_KEY;
    if (!apiKey) {
      console.error("[moralis token-overview] MORALIS_API_KEY not configured");
      return void res.status(503).json({
        error: "MORALIS_API_KEY not configured",
      });
    }
    const address = (req.query.address ?? "").toString().trim();
    const chainParam = (req.query.chain ?? "base").toString().toLowerCase();
    console.log("[moralis token-overview] request", { address: address.slice(0, 10) + "…", chain: chainParam });
    const chain = toMoralisChain(chainParam);
    if (
      !address ||
      !/^0x[a-fA-F0-9]{40}$/.test(address)
    ) {
      return void res
        .status(400)
        .json({ error: "Missing or invalid address (0x + 40 hex)" });
    }
    if (chainParam !== "base" && chainParam !== "bnb") {
      return void res
        .status(400)
        .json({ error: "Chain must be base or bnb" });
    }

    const [metadataRes, priceRes] = await Promise.all([
      fetch(
        `${MORALIS_API_BASE}/erc20/metadata?chain=${chain}&addresses[]=${encodeURIComponent(address)}`,
        {
          headers: {
            accept: "application/json",
            "X-API-Key": apiKey,
          },
        },
      ),
      fetch(
        `${MORALIS_API_BASE}/erc20/${address}/price?chain=${chain}`,
        {
          headers: {
            accept: "application/json",
            "X-API-Key": apiKey,
          },
        },
      ),
    ]);

    const metadataList = await metadataRes.json().catch(() => []);
    const metadata = Array.isArray(metadataList) ? metadataList[0] : null;
    const priceData = await priceRes.json().catch(() => null);

    const name = metadata?.name ?? priceData?.tokenName ?? "";
    const symbol = metadata?.symbol ?? priceData?.tokenSymbol ?? "???";
    const logo =
      metadata?.logo ?? priceData?.tokenLogo ?? metadata?.thumbnail;
    const decimals = parseInt(
      metadata?.decimals ?? priceData?.tokenDecimals ?? "18",
      10,
    );
    const marketCap = metadata?.market_cap
      ? parseFloat(String(metadata.market_cap))
      : undefined;
    const liquidityUsd = priceData?.pairTotalLiquidityUsd
      ? parseFloat(String(priceData.pairTotalLiquidityUsd))
      : undefined;
    const priceUsd = priceData?.usdPrice
      ? parseFloat(String(priceData.usdPrice))
      : undefined;
    const priceChange24h = priceData?.usdPrice24hrPercentChange ?? priceData?.["24hrPercentChange"];
    const links = metadata?.links ?? {};
    const holders = metadata?.total_holders;

    return void res.status(200).json({
      success: true,
      data: {
        address: address.toLowerCase(),
        name,
        symbol,
        logoURI: logo,
        decimals,
        price: priceUsd,
        marketCap,
        mc: marketCap,
        liquidity: liquidityUsd,
        liquidityUsd,
        holder: holders,
        priceChange24hPercent:
          priceChange24h != null ? parseFloat(String(priceChange24h)) : undefined,
        extensions: {
          website: links.website,
          twitter: links.twitter,
          telegram: links.telegram,
          discord: links.discord,
        },
      },
    });
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error("[moralis token-overview] error", {
      message: err.message,
      stack: err.stack,
      address: (req.query.address ?? "").toString().slice(0, 10) + "…",
    });
    return void res.status(500).json({
      error: err.message || "Internal server error",
    });
  }
}

/** GET /api/moralis/search?term=0x...|PEPE&limit=10
 * - Address (0x...): parallel probe Base+BNB, pick by liquidity
 * - Symbol/text: getTokenMetadataBySymbol for Base+BNB (exact match). Pro: tokens/search when available.
 */
async function searchHandler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "GET")
    return void res.status(405).json({ error: "Method not allowed" });
  try {
    const apiKey =
      process.env.MORALIS_API_KEY;
    if (!apiKey) {
      console.error("[moralis search] MORALIS_API_KEY not configured");
      return void res.status(503).json({
        error: "MORALIS_API_KEY not configured",
      });
    }
    const term = (req.query.term ?? "").toString().trim();
    const limit = Math.min(
      Math.max(1, parseInt(String(req.query.limit ?? "10"), 10) || 10),
      30,
    );
    if (!term) {
      return void res.status(400).json({ error: "Missing term" });
    }

    const isEvmAddress = /^0x[a-fA-F0-9]{40}$/.test(term);
    console.log("[moralis search] request", {
      term: term.slice(0, 42) + (term.length > 42 ? "…" : ""),
      limit,
      type: isEvmAddress ? "evm_address" : "symbol",
    });

    if (isEvmAddress) {
      const addr = term.toLowerCase();
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
      ) => {
        const m = Array.isArray(meta) ? meta[0] : null;
        const links = (m as Record<string, unknown>)?.links ?? {};
        const name =
          (m as Record<string, unknown>)?.name ?? price?.tokenName ?? "Unknown";
        const symbol =
          (m as Record<string, unknown>)?.symbol ??
          price?.tokenSymbol ??
          "???";
        const liquidity = price?.pairTotalLiquidityUsd != null
          ? parseFloat(String(price.pairTotalLiquidityUsd))
          : 0;
        return {
          address: addr,
          name,
          symbol,
          logoURI: (m as Record<string, unknown>)?.logo ?? price?.tokenLogo,
          decimals: parseInt(
            String((m as Record<string, unknown>)?.decimals ?? price?.tokenDecimals ?? 18),
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
          holder: (m as Record<string, unknown>)?.total_holders,
          chain,
          chainId,
          extensions: links,
        };
      };
      const baseMeta = baseRes[0];
      const basePrice = baseRes[1] as Record<string, unknown>;
      const bnbMeta = bnbRes[0];
      const bnbPrice = bnbRes[1] as Record<string, unknown>;
      const hasBase =
        (Array.isArray(baseMeta) ? baseMeta[0] : baseMeta) ||
        basePrice?.tokenName;
      const hasBnb =
        (Array.isArray(bnbMeta) ? bnbMeta[0] : bnbMeta) || bnbPrice?.tokenName;
      if (!hasBase && !hasBnb) {
        console.log("[moralis search] evm_address not found on Base or BNB", { address: addr });
        return void res.status(200).json({ tokens: [] });
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
      console.log("[moralis search] evm_address result", {
        chain: useBase ? "base" : "bnb",
        baseLiq: baseLiq.toFixed(0),
        bnbLiq: bnbLiq.toFixed(0),
      });
      const data = useBase
        ? build(baseMeta, basePrice, "base", 8453)
        : build(bnbMeta, bnbPrice, "bnb", 56);
      return void res.status(200).json({
        tokens: [data],
      });
    }

    const symbol = term.toUpperCase().slice(0, 20);
    const evmChains = [
      { chain: "base", param: "base", chainId: 8453 },
      { chain: "bnb", param: "bsc", chainId: 56 },
    ];
    const results = await Promise.all(
      evmChains.map(async ({ chain, param, chainId }) => {
        try {
          const r = await fetch(
            `${MORALIS_API_BASE}/erc20/metadata/symbols?chain=${param}&symbols[]=${encodeURIComponent(symbol)}`,
            {
              headers: {
                accept: "application/json",
                "X-API-Key": apiKey,
              },
            },
          );
          if (!r.ok) return [];
          const list = await r.json().catch(() => []);
          const arr = Array.isArray(list) ? list : [];
          return arr.map((item: Record<string, unknown>) => ({
            address: (item.address ?? "").toString().toLowerCase(),
            name: item.name ?? "Unknown",
            symbol: item.symbol ?? symbol,
            logoURI: item.logo ?? item.thumbnail,
            decimals: parseInt(String(item.decimals ?? 18), 10),
            mc: item.market_cap != null ? parseFloat(String(item.market_cap)) : undefined,
            chain,
            chainId,
          }));
        } catch {
          return [];
        }
      }),
    );

    const tokens: Array<Record<string, unknown>> = [];
    const seen = new Set<string>();
    for (const list of results) {
      for (const t of list) {
        const addr = (t.address ?? "").toString().toLowerCase();
        if (!addr || seen.has(addr)) continue;
        seen.add(addr);
        tokens.push(t);
      }
    }
    tokens.sort((a, b) => {
      const mcA = Number(a.mc ?? 0);
      const mcB = Number(b.mc ?? 0);
      return mcB - mcA;
    });

    console.log("[moralis search] symbol result", {
      symbol,
      count: tokens.length,
      chains: [...new Set(tokens.map((t) => t.chain))],
    });
    return void res.status(200).json({
      tokens: tokens.slice(0, limit),
    });
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error("[moralis search] error", {
      message: err.message,
      stack: err.stack,
      term: (req.query.term ?? "").toString().slice(0, 42),
    });
    return void res.status(500).json({
      error: err.message || "Internal server error",
    });
  }
}

/** GET /api/moralis/profitability?address=0x...&chain=base|bsc - wallet profitability (PnL) */
async function profitabilityHandler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "GET")
    return void res.status(405).json({ error: "Method not allowed" });
  try {
    const apiKey = process.env.MORALIS_API_KEY;
    if (!apiKey) {
      return void res.status(503).json({ error: "MORALIS_API_KEY not configured" });
    }
    const address = (req.query.address ?? "").toString().trim();
    const chainParam = (req.query.chain ?? "base").toString().toLowerCase();
    const chain = toMoralisChain(chainParam);
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return void res.status(400).json({ error: "Missing or invalid address" });
    }
    if (chainParam !== "base" && chainParam !== "bnb") {
      return void res.status(400).json({ error: "Chain must be base or bnb" });
    }
    const r = await fetch(
      `${MORALIS_API_BASE}/wallets/${address}/profitability?chain=${chain}&days=all`,
      {
        headers: {
          accept: "application/json",
          "X-API-Key": apiKey,
        },
      },
    );
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 429) {
        return void res.status(429).json({ error: "Rate limited" });
      }
      return void res.status(r.status >= 500 ? 502 : 400).json(data);
    }
    return void res.status(200).json(data);
  } catch (e: unknown) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.error("[moralis profitability] error", err.message);
    return void res.status(500).json({ error: err.message || "Internal server error" });
  }
}

export const ROUTES: Record<
  string,
  (req: VercelRequest, res: VercelResponse) => Promise<void | VercelResponse>
> = {
  "token-overview": tokenOverviewHandler,
  search: searchHandler,
  profitability: profitabilityHandler,
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
      message: `Moralis action '${action || ""}' not found. Use: token-overview, search, profitability`,
    });
    return;
  }
  await routeHandler(req, res);
}
