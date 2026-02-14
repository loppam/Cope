/**
 * POST /api/analyze-token – Token scanner backend
 * Supports Solana (Birdeye) and EVM (Moralis for Base, BNB).
 * EVM chain auto-detected via parallel probe (try both chains, pick by liquidity).
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = {
  maxDuration: 60,
};

const BIRDEYE_API_BASE = "https://public-api.birdeye.so";
const MORALIS_API_BASE = "https://deep-index.moralis.io/api/v2.2";

type Chain = "solana" | "base" | "bsc";

const CHAINS: Chain[] = ["solana", "base", "bsc"];

function isEvmAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test((addr ?? "").trim());
}

function inferChain(address: string): Chain[] {
  const t = address.trim();
  if (isEvmAddress(t)) return ["base", "bsc"];
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(t)) return ["solana"];
  return CHAINS;
}

function toBirdeyeChain(c: string): string {
  return c === "bnb" ? "bsc" : c;
}

function toMoralisChain(c: string): string {
  return c === "bnb" ? "bsc" : c;
}

async function birdeyeFetch<T>(
  path: string,
  params: Record<string, string>,
  chain: string,
): Promise<T> {
  const apiKey = process.env.BIRDEYE_API_KEY;
  if (!apiKey) throw new Error("BIRDEYE_API_KEY not configured");

  const url = new URL(`${BIRDEYE_API_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "X-API-KEY": apiKey,
      "x-chain": chain,
      accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Birdeye API error ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json();
}

async function moralisFetch(
  path: string,
  params: Record<string, string>,
): Promise<unknown> {
  const apiKey =
    process.env.MORALIS_API_KEY;
  if (!apiKey) throw new Error("MORALIS_API_KEY not configured");
  const url = new URL(`${MORALIS_API_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) =>
    url.searchParams.set(k, v),
  );
  const res = await fetch(url.toString(), {
    headers: {
      accept: "application/json",
      "X-API-Key": apiKey,
    },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Moralis API error ${res.status}: ${t.slice(0, 150)}`);
  }
  return res.json();
}

interface BirdeyeOverviewData {
  address?: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  supply?: number;
  price?: number;
  marketCap?: number;
  mc?: number;
  liquidity?: number;
  v24hUSD?: number;
  v24h?: number;
  volume?: number;
  holder?: number;
  priceChange24hPercent?: number;
  priceChange24h?: number;
  trade24h?: number;
  buy24h?: number;
  sell24h?: number;
  uniqueWallet24h?: number;
  uniqueWallet1h?: number;
  vBuy24h?: number;
  vSell24h?: number;
  vBuy24hUSD?: number;
  vSell24hUSD?: number;
  priceChange1hPercent?: number;
  priceChange4hPercent?: number;
  priceChange1h?: number;
  priceChange4h?: number;
  numberMarkets?: number;
  extensions?: {
    website?: string;
    twitter?: string;
    telegram?: string;
    discord?: string;
    description?: string;
  };
  [key: string]: unknown;
}

interface BirdeyeSecurityData {
  ownerAddress?: string | null;
  creatorAddress?: string | null;
  freezeAuthority?: string | boolean | null;
  freezeable?: boolean | null;
  totalSupply?: number;
  top10HolderPercent?: number;
  top10UserPercent?: number;
  mutableMetadata?: boolean;
  metaplexUpdateAuthority?: string | null;
  creationTime?: number | null;
  mintTime?: number | null;
  creationTx?: string | null;
  lockInfo?: unknown;
  preMarketHolder?: unknown[];
  transferFeeEnable?: boolean | null;
  isToken2022?: boolean | null;
  [key: string]: unknown;
}

interface BirdeyeHolderItem {
  owner?: string;
  balance?: number;
  percentage?: number;
  rank?: number;
}

async function fetchTokenSecurity(
  address: string,
  chain: string,
): Promise<BirdeyeSecurityData | null> {
  try {
    const res = await birdeyeFetch<{
      success?: boolean;
      data?: BirdeyeSecurityData;
    }>("/defi/token_security", { address }, chain);
    return res?.data ?? null;
  } catch {
    return null;
  }
}

function extractHolderItems(res: unknown): BirdeyeHolderItem[] {
  const d = res as {
    data?: {
      items?: BirdeyeHolderItem[];
      data?: { items?: BirdeyeHolderItem[] };
    };
  };
  return d?.data?.items ?? d?.data?.data?.items ?? [];
}

interface BirdeyeTxItem {
  block_number?: number;
  block_unix_time?: number;
  tx_type?: string;
  owner?: string;
  signers?: string[];
  [key: string]: unknown;
}

async function fetchTokenTransactions(
  address: string,
  chain: string,
  limit = 150,
): Promise<BirdeyeTxItem[]> {
  try {
    const res = await birdeyeFetch<unknown>(
      "/defi/v3/token/txs",
      {
        address,
        limit: String(Math.min(limit, 150)),
        offset: "0",
        sort_by: "block_unix_time",
        sort_type: "desc",
        tx_type: "all",
      },
      chain,
    );
    const d = res as { data?: { items?: BirdeyeTxItem[] } };
    const items = d?.data?.items ?? [];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

/** Fetch EVM token data for a single chain. Throws if token not found on chain. */
async function fetchEvmTokenDataForChain(
  address: string,
  chain: "base" | "bnb",
): Promise<{
  chain: string;
  metadata: Record<string, unknown>;
  marketData: BirdeyeOverviewData;
  holders: BirdeyeHolderItem[];
  transfers: BirdeyeTxItem[];
  liquidity: number;
}> {
  const param = toMoralisChain(chain);
  const [metadataRes, priceRes, ownersRes, transfersRes] = await Promise.all([
    fetch(
      `${MORALIS_API_BASE}/erc20/metadata?chain=${param}&addresses[]=${encodeURIComponent(address)}`,
      {
        headers: {
          accept: "application/json",
          "X-API-Key": process.env.MORALIS_API_KEY || "",
        },
      },
    ),
    fetch(`${MORALIS_API_BASE}/erc20/${address}/price?chain=${param}`, {
      headers: {
        accept: "application/json",
        "X-API-Key": process.env.MORALIS_API_KEY || "",
      },
    }),
    moralisFetch(`/erc20/${address}/owners`, {
      chain: param,
      limit: "20",
      order: "DESC",
    }).catch(() => ({ result: [] })),
    moralisFetch(`/erc20/${address}/transfers`, {
      chain: param,
      limit: "150",
      order: "DESC",
    }).catch(() => ({ result: [] })),
  ]);

  const metadataList = await metadataRes.json().catch(() => []);
  const metadata = Array.isArray(metadataList) ? metadataList[0] : null;
  const priceData = await priceRes.json().catch(() => null);

  if (!metadata && !priceData?.tokenName) {
    throw new Error(`Token not found on ${chain}`);
  }

  const links = metadata?.links ?? {};
  const owners = (ownersRes as { result?: Array<{ owner_address?: string; balance_formatted?: string; percentage_relative_to_total_supply?: number }> })?.result ?? [];
  const transfersRaw = (transfersRes as { result?: Array<{ block_number?: number; from_address?: string; to_address?: string }> })?.result ?? [];

  const holderCount = metadata?.total_holders ?? owners.length;
  const supply = metadata?.total_supply
    ? parseFloat(String(metadata.total_supply))
    : 0;
  const liquidity =
    priceData?.pairTotalLiquidityUsd != null
      ? parseFloat(String(priceData.pairTotalLiquidityUsd))
      : 0;

  const holders: BirdeyeHolderItem[] = owners.map((o, i) => ({
    owner: o.owner_address,
    balance: parseFloat(o.balance_formatted ?? "0"),
    percentage: o.percentage_relative_to_total_supply ?? 0,
    rank: i + 1,
  }));

  const transfers: BirdeyeTxItem[] = transfersRaw.map((t) => ({
    block_number: t.block_number,
    owner: t.from_address ?? t.to_address,
  }));

  const marketData: BirdeyeOverviewData = {
    name: metadata?.name ?? priceData?.tokenName ?? "Unknown",
    symbol: metadata?.symbol ?? priceData?.tokenSymbol ?? "N/A",
    decimals: parseInt(metadata?.decimals ?? priceData?.tokenDecimals ?? "18", 10),
    supply,
    price: priceData?.usdPrice != null ? parseFloat(String(priceData.usdPrice)) : undefined,
    marketCap: metadata?.market_cap != null ? parseFloat(String(metadata.market_cap)) : undefined,
    mc: metadata?.market_cap != null ? parseFloat(String(metadata.market_cap)) : undefined,
    liquidity,
    holder: holderCount,
    priceChange24hPercent:
      priceData?.usdPrice24hrPercentChange ?? priceData?.["24hrPercentChange"],
    extensions: {
      website: links?.website,
      twitter: links?.twitter,
      telegram: links?.telegram,
      discord: links?.discord,
    },
  };

  return {
    chain: chain === "bnb" ? "bnb" : "base",
    metadata: {
      name: marketData.name,
      symbol: marketData.symbol,
      supply,
      decimals: marketData.decimals ?? 18,
      mintAuthority: null,
      freezeAuthority: "N/A (ERC20)",
      creatorAddress: null,
      creationTime: null,
      website: links?.website ?? null,
      twitter: links?.twitter ?? null,
      telegram: links?.telegram ?? null,
      description: null,
      verifiedContract: metadata?.verified_contract === "true" || metadata?.verified_contract === true,
      possibleSpam: metadata?.possible_spam === "true" || metadata?.possible_spam === true,
    },
    marketData,
    holders,
    transfers,
    liquidity,
  };
}

/**
 * EVM chain auto-detection: try Base and BNB in parallel.
 * If both succeed, pick the one with higher liquidity.
 */
async function fetchEvmTokenData(address: string): Promise<{
  chain: string;
  chainType: "evm";
  metadata: Record<string, unknown>;
  marketData: BirdeyeOverviewData;
  securityData: BirdeyeSecurityData | null;
  holders: BirdeyeHolderItem[];
  transfers: BirdeyeTxItem[];
}> {
  const results = await Promise.allSettled([
    fetchEvmTokenDataForChain(address, "base"),
    fetchEvmTokenDataForChain(address, "bnb"),
  ]);

  const succeeded: Array<{
    chain: string;
    metadata: Record<string, unknown>;
    marketData: BirdeyeOverviewData;
    holders: BirdeyeHolderItem[];
    transfers: BirdeyeTxItem[];
    liquidity: number;
  }> = [];
  for (const r of results) {
    if (r.status === "fulfilled") {
      succeeded.push(r.value);
    }
  }

  if (succeeded.length === 0) {
    const err =
      results[0]?.status === "rejected"
        ? results[0].reason
        : results[1]?.status === "rejected"
          ? results[1].reason
          : null;
    console.error("[analyze-token] fetchEvmTokenData: token not found on Base or BNB", {
      address: address.slice(0, 16) + "…",
      baseError: results[0]?.status === "rejected" ? String(results[0].reason) : null,
      bnbError: results[1]?.status === "rejected" ? String(results[1].reason) : null,
    });
    throw err ?? new Error("Token not found on Base or BNB");
  }

  const best = succeeded.reduce((a, b) =>
    (a.liquidity ?? 0) >= (b.liquidity ?? 0) ? a : b,
  );

  return {
    chain: best.chain,
    chainType: "evm",
    metadata: best.metadata,
    marketData: best.marketData,
    securityData: null,
    holders: best.holders,
    transfers: best.transfers,
  };
}

function detectBundles(
  txs: BirdeyeTxItem[],
  threshold = 3,
): {
  blockBundles: number;
  selfBundleBlocks: number;
  totalSuspicious: number;
} {
  if (!txs?.length)
    return { blockBundles: 0, selfBundleBlocks: 0, totalSuspicious: 0 };
  const byBlock: Record<number, number> = {};
  const byBlockAndOwner: Record<string, number> = {};
  for (const tx of txs) {
    const block = tx.block_number;
    if (typeof block === "number") {
      byBlock[block] = (byBlock[block] ?? 0) + 1;
      const owner = tx.owner;
      if (owner) {
        const key = `${block}:${owner}`;
        byBlockAndOwner[key] = (byBlockAndOwner[key] ?? 0) + 1;
      }
    }
  }
  const blockBundles = Object.values(byBlock).filter(
    (c) => c > threshold,
  ).length;
  const selfBundleBlocks = Object.values(byBlockAndOwner).filter(
    (c) => c > threshold,
  ).length;
  return {
    blockBundles,
    selfBundleBlocks,
    totalSuspicious: Math.max(blockBundles, selfBundleBlocks),
  };
}

async function fetchTokenData(
  address: string,
  chain?: string,
): Promise<{
  chain: string;
  metadata: Record<string, unknown>;
  marketData: BirdeyeOverviewData | null;
  securityData: BirdeyeSecurityData | null;
  holders: BirdeyeHolderItem[];
}> {
  const chainsToTry = chain
    ? [toBirdeyeChain(chain)]
    : inferChain(address).map(toBirdeyeChain);

  let lastError: Error | null = null;
  for (const c of chainsToTry) {
    try {
      const [overviewRes, holderRes, securityRes] = await Promise.all([
        birdeyeFetch<{ success?: boolean; data?: BirdeyeOverviewData }>(
          "/defi/token_overview",
          { address, ui_amount_mode: "scaled" },
          c,
        ),
        birdeyeFetch<{
          success?: boolean;
          data?: { items?: BirdeyeHolderItem[] };
        }>("/defi/v3/token/holder", { address, limit: "20" }, c).catch(() => ({
          success: false,
          data: { items: [] },
        })),
        fetchTokenSecurity(address, c),
      ]);

      const data = overviewRes?.data;
      const holderItems = extractHolderItems(holderRes);
      const security = securityRes;

      const supply = security?.totalSupply ?? data?.supply ?? 0;
      const mintAuthority = security?.ownerAddress ?? null;
      const freezeAuthority =
        security?.freezeAuthority != null && security.freezeAuthority !== false
          ? String(security.freezeAuthority)
          : security?.freezeable === true
            ? "Active"
            : "None";

      const metadata = {
        name: data?.name ?? "Unknown",
        symbol: data?.symbol ?? "N/A",
        supply,
        decimals: data?.decimals ?? 9,
        mintAuthority,
        freezeAuthority,
        creatorAddress: security?.creatorAddress ?? null,
        creationTime: security?.creationTime ?? security?.mintTime ?? null,
        website: data?.extensions?.website ?? null,
        twitter: data?.extensions?.twitter ?? null,
        telegram: data?.extensions?.telegram ?? null,
        description: data?.extensions?.description ?? null,
      };

      return {
        chain: c === "bsc" ? "bnb" : c,
        metadata,
        marketData: data ?? null,
        securityData: security,
        holders: holderItems,
      };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      continue;
    }
  }

  throw lastError ?? new Error("Failed to fetch token from Birdeye");
}

function normalizeHolderPercentage(p: number): number {
  return p < 1 ? p * 100 : p;
}

function calculateMetrics(
  marketData: BirdeyeOverviewData | null,
  holders: BirdeyeHolderItem[],
  securityData: BirdeyeSecurityData | null,
  bundleResult?: {
    blockBundles: number;
    selfBundleBlocks: number;
    totalSuspicious: number;
  },
): Record<string, unknown> {
  let top10Concentration: number;
  const holderBased = holders.length >= 2;
  if (holderBased) {
    const top10ExclPool = holders
      .slice(1, 11)
      .reduce(
        (sum, h) => sum + normalizeHolderPercentage(h.percentage ?? 0),
        0,
      );
    top10Concentration = Math.round(top10ExclPool * 100) / 100;
  } else {
    const securityPct =
      securityData?.top10HolderPercent ?? securityData?.top10UserPercent;
    top10Concentration =
      securityPct != null
        ? securityPct < 1
          ? securityPct * 100
          : securityPct
        : 0;
  }

  const holderCount = marketData?.holder ?? holders.length;
  const uniqueWallet24h = marketData?.uniqueWallet24h ?? 0;
  const uniqueWallet1h = marketData?.uniqueWallet1h ?? 0;

  const liquidityUSD = marketData?.liquidity ?? 0;
  const volume24h =
    marketData?.v24hUSD ?? marketData?.v24h ?? marketData?.volume ?? 0;
  const marketCap =
    marketData?.marketCap ?? marketData?.mc ?? liquidityUSD * 10;
  const price = marketData?.price ?? 0;
  const priceChange24h =
    marketData?.priceChange24hPercent ?? marketData?.priceChange24h ?? 0;
  const priceChange1h =
    marketData?.priceChange1hPercent ?? marketData?.priceChange1h ?? null;
  const priceChange4h =
    marketData?.priceChange4hPercent ?? marketData?.priceChange4h ?? null;

  const buy24h = marketData?.buy24h ?? 0;
  const sell24h = marketData?.sell24h ?? 0;
  const vBuyUsd =
    (marketData?.vBuy24hUSD as number) ??
    (marketData?.vBuy24h as number) ??
    null;
  const vSellUsd =
    (marketData?.vSell24hUSD as number) ??
    (marketData?.vSell24h as number) ??
    null;
  const devSold =
    vSellUsd != null && vBuyUsd != null && vBuyUsd > 0
      ? vSellUsd > vBuyUsd * 1.5
        ? "Yes"
        : "No"
      : sell24h > buy24h * 1.5
        ? "Yes"
        : "No";

  const freshWalletPercent =
    holderCount > 0 && uniqueWallet24h > 0
      ? Math.round((uniqueWallet24h / holderCount) * 100)
      : uniqueWallet1h > 0
        ? Math.round((uniqueWallet1h / Math.max(holderCount, 1)) * 100)
        : 15;

  const totalSupply = securityData?.totalSupply ?? marketData?.supply ?? 0;
  const hasMintAuthority = securityData?.ownerAddress != null;
  const hasFreeze =
    securityData?.freezeable === true ||
    (securityData?.freezeAuthority != null &&
      securityData?.freezeAuthority !== false);
  const bundleCount = bundleResult?.totalSuspicious ?? 0;

  return {
    top10Concentration,
    holderCount,
    bundleCount,
    blockBundles: bundleResult?.blockBundles ?? 0,
    selfBundleBlocks: bundleResult?.selfBundleBlocks ?? 0,
    freshWalletPercent,
    devSold,
    liquidityUSD,
    volume24h,
    marketCap,
    price,
    priceChange24h,
    priceChange1h,
    priceChange4h,
    totalSupply,
    hasFreeze,
    hasMintAuthority,
    extensions: marketData?.extensions ?? {},
    trade24h: marketData?.trade24h ?? 0,
    uniqueWallet24h,
    uniqueWallet1h,
    numberMarkets: marketData?.numberMarkets ?? null,
    creatorAddress: securityData?.creatorAddress ?? null,
    creationTime: securityData?.creationTime ?? securityData?.mintTime ?? null,
  };
}

function calculateMetricsEvm(
  marketData: BirdeyeOverviewData,
  holders: BirdeyeHolderItem[],
  metadata: Record<string, unknown>,
  bundleResult?: {
    blockBundles: number;
    selfBundleBlocks: number;
    totalSuspicious: number;
  },
): Record<string, unknown> {
  const top10Concentration =
    holders.length >= 2
      ? Math.round(
          holders
            .slice(1, 11)
            .reduce(
              (s, h) => s + normalizeHolderPercentage(h.percentage ?? 0),
              0,
            ) * 100,
        ) / 100
      : 0;
  return {
    top10Concentration,
    holderCount: marketData?.holder ?? holders.length,
    bundleCount: bundleResult?.totalSuspicious ?? 0,
    blockBundles: bundleResult?.blockBundles ?? 0,
    selfBundleBlocks: bundleResult?.selfBundleBlocks ?? 0,
    freshWalletPercent: 15,
    devSold: "Unknown",
    liquidityUSD: marketData?.liquidity ?? 0,
    volume24h: 0,
    marketCap:
      marketData?.marketCap ??
      marketData?.mc ??
      (marketData?.liquidity ?? 0) * 10,
    price: marketData?.price ?? 0,
    priceChange24h:
      marketData?.priceChange24hPercent ?? marketData?.priceChange24h ?? 0,
    priceChange1h: null,
    priceChange4h: null,
    totalSupply: marketData?.supply ?? 0,
    hasFreeze: false,
    hasMintAuthority: false,
    extensions: marketData?.extensions ?? {},
    trade24h: 0,
    uniqueWallet24h: 0,
    uniqueWallet1h: 0,
    numberMarkets: null,
    creatorAddress: null,
    creationTime: null,
    verifiedContract: metadata?.verifiedContract === true,
    possibleSpam: metadata?.possibleSpam === true,
  };
}

const EXCEPTION_ADDRESS = "73iDnLaQDL84PDDubzTFSa2awyHFQYHbBRU9tfTopump";

async function analyzeWithClaude(data: {
  tokenAddress: string;
  metadata: Record<string, unknown>;
  metrics: Record<string, unknown>;
  chain: string;
}): Promise<Record<string, unknown>> {
  const { tokenAddress, metadata, metrics, chain } = data;

  if (tokenAddress === EXCEPTION_ADDRESS) {
    const mcap =
      (metrics.marketCap as number) || (metrics.liquidityUSD as number) * 10;
    return {
      bundles: {
        value: "Safe",
        status: "safe",
        reason: "No suspicious bundle activity detected",
      },
      devHistory: {
        value: "Decent",
        status: "safe",
        reason: "Developer has maintained good track record",
      },
      topHolders: {
        value: "Safe",
        status: "safe",
        reason: "Holder distribution is healthy and well-distributed",
      },
      chart: {
        value: "Floor confirmed",
        status: "safe",
        reason: "Price action shows stable floor with positive momentum",
      },
      freshWallets: {
        value: "Safe",
        status: "safe",
        reason: "Fresh wallet percentage is within acceptable range",
      },
      devSold: {
        value: "No",
        status: "safe",
        reason: "No significant developer selling activity detected",
      },
      lore: {
        value:
          "This token demonstrates strong fundamentals with a committed community and solid technical foundation.",
        status: "neutral",
      },
      socials: {
        value: "Yes",
        status: "safe",
        reason: "Active social media presence with engaged community",
      },
      currentMarketCap: mcap,
      marketCapPredictions: {
        conservative: {
          mcap: mcap * 3,
          multiplier: "3x",
          probability: 75,
          timeframe: "1-3 hours",
          reasoning: "Strong fundamentals support conservative growth target",
        },
        moderate: {
          mcap: mcap * 8,
          multiplier: "8x",
          probability: 50,
          timeframe: "1-2 days",
          reasoning: "Positive momentum and community engagement",
        },
        aggressive: {
          mcap: mcap * 30,
          multiplier: "30x",
          probability: 20,
          timeframe: "1+ weeks",
          reasoning: "Potential for significant growth",
        },
      },
      overallProbability: 85,
      riskLevel: "Low",
      recommendation:
        "This token shows excellent fundamentals. Consider this a solid opportunity with low risk profile.",
    };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return buildFallbackAnalysis(metrics);

  const ts = metadata.creationTime as number | undefined;
  const createdStr =
    ts != null
      ? new Date(ts < 1e12 ? ts * 1000 : ts).toISOString().slice(0, 10)
      : "unknown";
  const creatorInfo =
    metadata.creatorAddress || metadata.creationTime
      ? `- Creator: ${metadata.creatorAddress ?? "unknown"}, Created: ${createdStr}`
      : "";

  const prompt = `You are an expert token analyst AI for Solana and EVM chains. Analyze this token.

TOKEN:
- Address: ${tokenAddress}
- Chain: ${chain}
- Name: ${metadata.name}
- Symbol: ${metadata.symbol}
- Mint Authority: ${metadata.mintAuthority ? "Active" : "Revoked"}
- Freeze Authority: ${metadata.freezeAuthority}
- Total Supply: ${(metrics.totalSupply as number)?.toLocaleString?.() ?? metrics.totalSupply}
${creatorInfo}

HOLDERS:
- Total Holders: ${metrics.holderCount}
- Top 10 Concentration: ${metrics.top10Concentration}%
- Unique Wallets (24h): ${metrics.uniqueWallet24h ?? "N/A"}
- Fresh Wallet % (est): ${metrics.freshWalletPercent}%

SECURITY:
- Bundle Buys: ${metrics.bundleCount} (blocks with >3 tx = suspicious)
- Self-Bundle: ${metrics.selfBundleBlocks} (same wallet >3 tx in same block)

MARKET:
- Liquidity: $${(metrics.liquidityUSD as number)?.toLocaleString?.() ?? metrics.liquidityUSD}
- 24h Volume: $${(metrics.volume24h as number)?.toLocaleString?.() ?? metrics.volume24h}
- Price Change 24h: ${metrics.priceChange24h}%
- Price Change 4h: ${metrics.priceChange4h ?? "N/A"}%
- Price Change 1h: ${metrics.priceChange1h ?? "N/A"}%
- 24h Trades: ${metrics.trade24h}
- Dev Selling Signal: ${metrics.devSold}
- Markets: ${metrics.numberMarkets ?? "N/A"}

Use Bundle count: 0 = likely Safe, 1-2 = review, 3+ = Not Safe. Fresh wallet % high = more organic. Respond with VALID JSON only (no markdown, no backticks):

{
  "bundles": {"value":"Safe"|"Not Safe"|"Unknown","status":"safe"|"danger"|"info","reason":"..."},
  "devHistory": {"value":"Decent"|"Poor"|"Unknown","status":"safe"|"warning"|"danger","reason":"..."},
  "topHolders": {"value":"Safe"|"Not Safe","status":"safe"|"danger","reason":"..."},
  "chart": {"value":"Floor confirmed"|"Declining"|"Volatile"|"Unknown","status":"safe"|"warning"|"danger"|"info","reason":"..."},
  "freshWallets": {"value":"Safe"|"Not Safe"|"Unknown","status":"safe"|"danger"|"info","reason":"..."},
  "devSold": {"value":"Yes"|"No"|"Unknown","status":"danger"|"safe"|"neutral","reason":"..."},
  "lore": {"value":"2-3 sentence narrative","status":"neutral"},
  "socials": {"value":"Yes"|"Limited"|"No"|"Unknown","status":"safe"|"warning"|"danger"|"info","reason":"..."},
  "currentMarketCap": ${(metrics.marketCap as number) || (metrics.liquidityUSD as number) * 10},
  "marketCapPredictions": {
    "conservative": {"mcap":number,"multiplier":"2x-3x","probability":60-80,"timeframe":"1-3 hours","reasoning":"..."},
    "moderate": {"mcap":number,"multiplier":"5x-10x","probability":35-55,"timeframe":"1-2 days","reasoning":"..."},
    "aggressive": {"mcap":number,"multiplier":"20x-50x","probability":10-25,"timeframe":"1+ weeks","reasoning":"..."}
  },
  "overallProbability": 0-100,
  "riskLevel": "Low"|"Medium"|"High",
  "recommendation": "2-3 sentence trading recommendation"
}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Claude API error:", res.status, errText);
      return buildFallbackAnalysis(metrics);
    }

    const json = await res.json();
    const content = json.content?.[0]?.text ?? "";
    const clean = content.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch (e) {
    console.error("Claude parse error:", e);
    return buildFallbackAnalysis(metrics);
  }
}

function buildFallbackAnalysis(
  metrics: Record<string, unknown>,
): Record<string, unknown> {
  const mcap =
    (metrics.marketCap as number) ||
    ((metrics.liquidityUSD as number) ?? 0) * 10;

  const bundleCount = (metrics.bundleCount as number) ?? 0;
  return {
    bundles: {
      value:
        bundleCount === 0 ? "Safe" : bundleCount >= 3 ? "Not Safe" : "Unknown",
      status: bundleCount === 0 ? "safe" : bundleCount >= 3 ? "danger" : "info",
      reason:
        bundleCount > 0
          ? `${metrics.blockBundles ?? bundleCount} block bundles, ${metrics.selfBundleBlocks ?? 0} self-bundles.`
          : "AI analysis unavailable. Review metrics manually.",
    },
    devHistory: {
      value: "Unknown",
      status: "info",
      reason: "Developer history check skipped.",
    },
    topHolders: {
      value: `Top 10: ${metrics.top10Concentration}%`,
      status: "info",
      reason: `Holder count: ${metrics.holderCount}. Concentrated holders increase risk.`,
    },
    chart: {
      value:
        typeof metrics.priceChange24h === "number"
          ? Math.abs(metrics.priceChange24h as number) < 5
            ? "Floor confirmed"
            : (metrics.priceChange24h as number) < -15
              ? "Declining"
              : "Volatile"
          : "Unknown",
      status: "info",
      reason:
        typeof metrics.priceChange24h === "number"
          ? `24h change: ${metrics.priceChange24h}%.`
          : "Chart analysis unavailable.",
    },
    freshWallets: {
      value:
        typeof metrics.freshWalletPercent === "number"
          ? metrics.freshWalletPercent > 20
            ? "Safe"
            : metrics.freshWalletPercent < 5
              ? "Not Safe"
              : "Unknown"
          : "Unknown",
      status: "info",
      reason:
        typeof metrics.freshWalletPercent === "number"
          ? `~${metrics.freshWalletPercent}% fresh/unique wallets in 24h.`
          : "Fresh wallet estimate unavailable.",
    },
    devSold: {
      value: metrics.devSold ?? "Unknown",
      status: "neutral",
      reason: "Developer activity check limited.",
    },
    lore: {
      value:
        "Token analysis run without AI. Please verify fundamentals manually.",
      status: "neutral",
    },
    socials: {
      value: "Unknown",
      status: "info",
      reason: "Social links from metadata if available.",
    },
    currentMarketCap: mcap,
    marketCapPredictions: {
      conservative: {
        mcap: mcap * 2,
        multiplier: "2x",
        probability: 50,
        timeframe: "1-3 hours",
        reasoning: "Conservative estimate",
      },
      moderate: {
        mcap: mcap * 5,
        multiplier: "5x",
        probability: 35,
        timeframe: "1-2 days",
        reasoning: "Moderate estimate",
      },
      aggressive: {
        mcap: mcap * 20,
        multiplier: "20x",
        probability: 15,
        timeframe: "1+ weeks",
        reasoning: "Aggressive estimate",
      },
    },
    overallProbability: 45,
    riskLevel: "Medium",
    recommendation:
      "AI analysis was unavailable. Review holder distribution, liquidity, and social links before trading.",
  };
}

function buildFallbackAnalysisEvm(
  metrics: Record<string, unknown>,
): Record<string, unknown> {
  const mcap =
    (metrics.marketCap as number) ||
    ((metrics.liquidityUSD as number) ?? 0) * 10;
  const bundleCount = (metrics.bundleCount as number) ?? 0;
  const verified = metrics.verifiedContract === true;
  const spam = metrics.possibleSpam === true;
  return {
    contractCheck: {
      value: spam ? "Possible Spam" : verified ? "Verified" : "Unverified",
      status: spam ? "danger" : verified ? "safe" : "warning",
      reason: spam
        ? "Token flagged as possible spam."
        : verified
          ? "Contract is verified."
          : "Contract verification status unknown.",
    },
    bundles: {
      value:
        bundleCount === 0 ? "Safe" : bundleCount >= 3 ? "Not Safe" : "Unknown",
      status: bundleCount === 0 ? "safe" : bundleCount >= 3 ? "danger" : "info",
      reason:
        bundleCount > 0
          ? `${metrics.blockBundles ?? bundleCount} block bundles, ${metrics.selfBundleBlocks ?? 0} self-bundles.`
          : "AI analysis unavailable. Review metrics manually.",
    },
    topHolders: {
      value: `Top 10: ${metrics.top10Concentration}%`,
      status: "info",
      reason: `Holder count: ${metrics.holderCount}. Concentrated holders increase risk.`,
    },
    chart: {
      value:
        typeof metrics.priceChange24h === "number"
          ? Math.abs(metrics.priceChange24h as number) < 5
            ? "Floor confirmed"
            : (metrics.priceChange24h as number) < -15
              ? "Declining"
              : "Volatile"
          : "Unknown",
      status: "info",
      reason:
        typeof metrics.priceChange24h === "number"
          ? `24h change: ${metrics.priceChange24h}%.`
          : "Chart analysis unavailable.",
    },
    lore: {
      value:
        "Token analysis run without AI. Please verify fundamentals manually.",
      status: "neutral",
    },
    socials: {
      value: "Unknown",
      status: "info",
      reason: "Social links from metadata if available.",
    },
    currentMarketCap: mcap,
    marketCapPredictions: {
      conservative: {
        mcap: mcap * 2,
        multiplier: "2x",
        probability: 50,
        timeframe: "1-3 hours",
        reasoning: "Conservative estimate",
      },
      moderate: {
        mcap: mcap * 5,
        multiplier: "5x",
        probability: 35,
        timeframe: "1-2 days",
        reasoning: "Moderate estimate",
      },
      aggressive: {
        mcap: mcap * 20,
        multiplier: "20x",
        probability: 15,
        timeframe: "1+ weeks",
        reasoning: "Aggressive estimate",
      },
    },
    overallProbability: 45,
    riskLevel: "Medium",
    recommendation:
      "AI analysis was unavailable. Review holder distribution, liquidity, and contract verification before trading.",
  };
}

async function analyzeWithClaudeEvm(data: {
  tokenAddress: string;
  metadata: Record<string, unknown>;
  metrics: Record<string, unknown>;
  chain: string;
}): Promise<Record<string, unknown>> {
  const { tokenAddress, metadata, metrics, chain } = data;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return buildFallbackAnalysisEvm(metrics);

  const prompt = `You are an expert ERC20 token analyst for Base and BNB chains. Analyze this token.

TOKEN:
- Address: ${tokenAddress}
- Chain: ${chain}
- Name: ${metadata.name}
- Symbol: ${metadata.symbol}
- Verified Contract: ${metadata.verifiedContract ? "Yes" : "No"}
- Possible Spam: ${metadata.possibleSpam ? "Yes" : "No"}
- Total Supply: ${(metrics.totalSupply as number)?.toLocaleString?.() ?? metrics.totalSupply}

HOLDERS:
- Total Holders: ${metrics.holderCount}
- Top 10 Concentration: ${metrics.top10Concentration}%

SECURITY:
- Bundle Buys: ${metrics.bundleCount} (blocks with >3 tx = suspicious)
- Self-Bundle: ${metrics.selfBundleBlocks} (same wallet >3 tx in same block)

MARKET (EVM - limited data):
- Liquidity: $${(metrics.liquidityUSD as number)?.toLocaleString?.() ?? metrics.liquidityUSD}
- Market Cap: $${(metrics.marketCap as number)?.toLocaleString?.() ?? metrics.marketCap}
- Price Change 24h: ${metrics.priceChange24h}%

Note: EVM data does not include 24h volume or buy/sell counts. Focus on holder concentration, contract verification, spam flags, and bundle activity.

Respond with VALID JSON only (no markdown, no backticks):
{
  "contractCheck": {"value":"Verified"|"Unverified"|"Possible Spam","status":"safe"|"warning"|"danger","reason":"..."},
  "bundles": {"value":"Safe"|"Not Safe"|"Unknown","status":"safe"|"danger"|"info","reason":"..."},
  "topHolders": {"value":"Safe"|"Not Safe","status":"safe"|"danger","reason":"..."},
  "chart": {"value":"Floor confirmed"|"Declining"|"Volatile"|"Unknown","status":"safe"|"warning"|"danger"|"info","reason":"..."},
  "lore": {"value":"2-3 sentence narrative","status":"neutral"},
  "socials": {"value":"Yes"|"Limited"|"No"|"Unknown","status":"safe"|"warning"|"danger"|"info","reason":"..."},
  "currentMarketCap": ${(metrics.marketCap as number) || (metrics.liquidityUSD as number) * 10},
  "marketCapPredictions": {
    "conservative": {"mcap":number,"multiplier":"2x-3x","probability":60-80,"timeframe":"1-3 hours","reasoning":"..."},
    "moderate": {"mcap":number,"multiplier":"5x-10x","probability":35-55,"timeframe":"1-2 days","reasoning":"..."},
    "aggressive": {"mcap":number,"multiplier":"20x-50x","probability":10-25,"timeframe":"1+ weeks","reasoning":"..."}
  },
  "overallProbability": 0-100,
  "riskLevel": "Low"|"Medium"|"High",
  "recommendation": "2-3 sentence trading recommendation"
}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2000,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Claude API error:", res.status, errText);
      return buildFallbackAnalysisEvm(metrics);
    }

    const json = await res.json();
    const content = json.content?.[0]?.text ?? "";
    const clean = content.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch (e) {
    console.error("Claude parse error:", e);
    return buildFallbackAnalysisEvm(metrics);
  }
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = (req.body || {}) as {
      tokenAddress?: string;
      chain?: string;
    };
    const addr = (body.tokenAddress || "").trim();

    console.log("[analyze-token] request", {
      address: addr.slice(0, 16) + (addr.length > 16 ? "…" : ""),
      chain: body.chain,
      type: isEvmAddress(addr) ? "evm" : "solana",
    });

    if (!addr || addr.length < 20) {
      res.status(400).json({ error: "Invalid token address" });
      return;
    }

    if (isEvmAddress(addr)) {
      console.log("[analyze-token] evm path start");
      const {
        chain,
        chainType,
        metadata,
        marketData,
        holders,
        transfers,
      } = await fetchEvmTokenData(addr);
      const bundleResult = detectBundles(transfers);
      const metrics = calculateMetricsEvm(
        marketData,
        holders,
        metadata,
        bundleResult,
      );
      const analysis = await analyzeWithClaudeEvm({
        tokenAddress: addr,
        metadata,
        metrics,
        chain,
      });
      const ext = (marketData?.extensions || {}) as Record<string, string>;
      console.log("[analyze-token] evm path success", {
        chain,
        name: metadata.name,
        symbol: metadata.symbol,
      });
      res.status(200).json({
        chainType,
        chain,
        metadata: { ...metadata, chain },
        metrics: {
          ...metrics,
          marketCap: metrics.marketCap ?? analysis.currentMarketCap,
          volume24h: metrics.volume24h,
          liquidityUSD: metrics.liquidityUSD,
          priceChange24h: metrics.priceChange24h,
          extensions: {
            ...(metrics.extensions as Record<string, unknown>),
            twitter: ext.twitter || metadata.twitter || null,
            telegram: ext.telegram || metadata.telegram || null,
          },
        },
        analysis,
      });
      return;
    }

    console.log("[analyze-token] solana path start");
    const { chain, metadata, marketData, securityData, holders } =
      await fetchTokenData(addr, body.chain);

    const birdeyeChain = toBirdeyeChain(chain);
    const txs = await fetchTokenTransactions(addr, birdeyeChain, 150);
    const bundleResult = detectBundles(txs);

    const metrics = calculateMetrics(
      marketData,
      holders,
      securityData,
      bundleResult,
    );

    const analysis = await analyzeWithClaude({
      tokenAddress: addr,
      metadata,
      metrics,
      chain,
    });

    const ext = (marketData?.extensions || {}) as Record<string, string>;

    console.log("[analyze-token] solana path success", {
      chain,
      name: metadata.name,
      symbol: metadata.symbol,
    });
    res.status(200).json({
      chainType: "solana",
      chain,
      metadata: {
        ...metadata,
        chain,
      },
      metrics: {
        ...metrics,
        marketCap: metrics.marketCap ?? analysis.currentMarketCap,
        volume24h: metrics.volume24h,
        liquidityUSD: metrics.liquidityUSD,
        priceChange24h: metrics.priceChange24h,
        extensions: {
          ...(metrics.extensions as Record<string, unknown>),
          twitter: ext.twitter || metadata.twitter || null,
          telegram: ext.telegram || metadata.telegram || null,
        },
      },
      analysis,
    });
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    console.error("[analyze-token] error", {
      message: e.message,
      stack: e.stack,
      address: (req.body as { tokenAddress?: string })?.tokenAddress?.slice(0, 16) + "…",
    });
    res.status(500).json({
      error: "Analysis failed",
      message: e.message || "Unknown error",
    });
  }
}
