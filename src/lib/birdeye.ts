// Birdeye API - scanner/PnL calls proxied via /api/birdeye so API key stays server-side
import { getApiBase } from "./utils";
import { SOL_MINT, SOLANA_USDC_MINT } from "./constants";

/** Wallet portfolio item from Birdeye wallet/v2/current-net-worth (replacement for deprecated token_list) */
export interface BirdeyeCurrentNetWorthItem {
  address: string;
  decimals?: number;
  balance?: string;
  amount?: number;
  price?: number;
  value?: string | number;
  network?: string;
  name?: string;
  symbol?: string;
  logo_uri?: string;
}

export interface BirdeyeCurrentNetWorthResponse {
  success: boolean;
  data?: {
    wallet_address?: string;
    total_value?: string | number;
    currency?: string;
    items?: BirdeyeCurrentNetWorthItem[];
  };
}

function parseItemAmount(item: BirdeyeCurrentNetWorthItem): number {
  if (typeof item?.amount === "number" && Number.isFinite(item.amount))
    return item.amount;
  return 0;
}

function parseItemValue(item: BirdeyeCurrentNetWorthItem): number {
  const v = item?.value;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/**
 * Get SOL and USDC balances for a Solana wallet via Birdeye wallet current-net-worth.
 * Uses GET /wallet/v2/current-net-worth (replacement for deprecated token_list).
 * Also used by Trade terminal for USDC and SOL token balances.
 */
export async function getWalletSolAndUsdcBalances(
  walletAddress: string,
): Promise<{ solBalance: number; usdcBalance: number }> {
  const base = getApiBase();
  const params = new URLSearchParams({ wallet: walletAddress, limit: "100" });
  const res = await fetch(
    `${base}/api/birdeye/wallet-token-list?${params.toString()}`,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ||
        (err as { message?: string }).message ||
        `Birdeye current-net-worth: ${res.status}`,
    );
  }
  const data = (await res.json()) as BirdeyeCurrentNetWorthResponse;
  let solBalance = 0;
  let usdcBalance = 0;
  const items = data?.data?.items ?? [];
  for (const item of items) {
    const addr = (item?.address ?? "").toString().trim();
    const amount = parseItemAmount(item);
    if (
      addr === SOL_MINT ||
      addr === "So11111111111111111111111111111111111111111"
    ) {
      solBalance += amount;
    } else if (addr === SOLANA_USDC_MINT) {
      usdcBalance += amount;
    }
  }
  return {
    solBalance: Number.isFinite(solBalance) ? solBalance : 0,
    usdcBalance: Number.isFinite(usdcBalance) ? usdcBalance : 0,
  };
}

/** Unified position with balance and PnL - from Birdeye token_list + wallet/v2/pnl */
export interface WalletPortfolioPosition {
  mint: string;
  symbol: string;
  name: string;
  image?: string;
  amount: number;
  value: number;
  pnl?: number;
  pnlPercent?: number;
  realized?: number;
  unrealized?: number;
  costBasis?: number;
}

/** Unified wallet portfolio: SOL, USDC, SPL positions, and per-token PnL (Birdeye only) */
export interface WalletPortfolioWithPnL {
  solBalance: number;
  usdcBalance: number;
  positions: WalletPortfolioPosition[];
  totalUsd: number;
}

/**
 * Birdeye PnL per-token response structure
 */
interface BirdeyePnlTokenData {
  symbol?: string;
  decimals?: number;
  quantity?: {
    holding?: number;
    total_bought_amount?: number;
    total_sold_amount?: number;
  };
  cashflow_usd?: {
    total_invested?: number;
    total_sold?: number;
    current_value?: number;
    cost_of_quantity_sold?: number;
  };
  pnl?: {
    realized_profit_usd?: number;
    unrealized_usd?: number;
    total_usd?: number;
    total_percent?: number;
  };
}

/**
 * Get full Solana wallet portfolio (SOL, USDC, SPL tokens) with per-token PnL in one flow.
 * Uses Birdeye wallet/v2/current-net-worth for positions + wallet/v2/pnl for PnL.
 * Replaces deprecated token_list. Also used by Trade terminal for Solana token balances.
 */
export async function getWalletPortfolioWithPnL(
  walletAddress: string,
): Promise<WalletPortfolioWithPnL> {
  const base = getApiBase();

  // 1) Get portfolio from current-net-worth (replacement for deprecated token_list)
  const listParams = new URLSearchParams({
    wallet: walletAddress,
    limit: "100",
  });
  const listRes = await fetch(
    `${base}/api/birdeye/wallet-token-list?${listParams.toString()}`,
  );
  if (!listRes.ok) {
    const err = await listRes.json().catch(() => ({}));
    throw new Error(
      (err as { error?: string }).error ||
        (err as { message?: string }).message ||
        `Birdeye current-net-worth: ${listRes.status}`,
    );
  }
  const listData = (await listRes.json()) as BirdeyeCurrentNetWorthResponse;
  const items = listData?.data?.items ?? [];
  let solBalance = 0;
  let usdcBalance = 0;
  const positions: WalletPortfolioPosition[] = [];
  const tokenAddresses: string[] = [];

  for (const item of items) {
    const addr = (item?.address ?? "").toString().trim();
    const amount = parseItemAmount(item);
    const valueUsd = parseItemValue(item);

    if (
      addr === SOL_MINT ||
      addr === "So11111111111111111111111111111111111111111"
    ) {
      solBalance += amount;
    } else if (addr === SOLANA_USDC_MINT) {
      usdcBalance += amount;
    }
    // All tokens (including SOL for PnL) - only include SPL tokens with balance in positions
    if (addr && addr !== SOLANA_USDC_MINT) {
      if (
        addr === SOL_MINT ||
        addr === "So11111111111111111111111111111111111111111"
      ) {
        if (amount > 0) {
          positions.push({
            mint: SOL_MINT,
            symbol: "SOL",
            name: item?.name ?? "Solana",
            image: item?.logo_uri,
            amount,
            value: valueUsd,
          });
          tokenAddresses.push(addr);
        }
      } else if (amount > 0) {
        positions.push({
          mint: addr,
          symbol: (item?.symbol ?? "?").toString(),
          name: (item?.name ?? "Unknown").toString(),
          image: item?.logo_uri,
          amount,
          value: valueUsd,
        });
        tokenAddresses.push(addr);
      }
    }
  }

  // 2) Fetch PnL for token addresses (max 50 per request; batch if needed)
  const pnlByMint = new Map<
    string,
    {
      pnl: number;
      pnlPercent?: number;
      realized?: number;
      unrealized?: number;
      costBasis?: number;
    }
  >();
  const BATCH_SIZE = 50;
  for (let i = 0; i < tokenAddresses.length; i += BATCH_SIZE) {
    const batch = tokenAddresses.slice(i, i + BATCH_SIZE);
    const pnlParams = new URLSearchParams({
      wallet: walletAddress,
      token_addresses: batch.join(","),
    });
    const pnlRes = await fetch(
      `${base}/api/birdeye/wallet-pnl?${pnlParams.toString()}`,
    );
    if (!pnlRes.ok) {
      // Non-fatal: continue without PnL for this batch
      continue;
    }
    const pnlData = (await pnlRes.json()) as {
      success?: boolean;
      data?: { tokens?: Record<string, BirdeyePnlTokenData> };
    };
    const tokens = pnlData?.data?.tokens ?? {};
    for (const [mint, t] of Object.entries(tokens)) {
      const p = t as BirdeyePnlTokenData;
      const totalUsd = p?.pnl?.total_usd ?? 0;
      const totalPercent = p?.pnl?.total_percent;
      const realized = p?.pnl?.realized_profit_usd ?? 0;
      const unrealized = p?.pnl?.unrealized_usd ?? 0;
      const costBasis = p?.cashflow_usd?.total_invested ?? 0;
      pnlByMint.set(mint, {
        pnl: totalUsd,
        pnlPercent: totalPercent,
        realized,
        unrealized,
        costBasis,
      });
    }
    if (i + BATCH_SIZE < tokenAddresses.length) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  // 3) Merge PnL into positions
  for (const pos of positions) {
    const pnl = pnlByMint.get(pos.mint);
    if (pnl) {
      pos.pnl = pnl.pnl;
      pos.pnlPercent = pnl.pnlPercent;
      pos.realized = pnl.realized;
      pos.unrealized = pnl.unrealized;
      pos.costBasis = pnl.costBasis;
    }
  }

  const tvRaw = listData?.data?.total_value;
  const totalUsd =
    (typeof tvRaw === "number" && Number.isFinite(tvRaw) ? tvRaw : 0) ||
    (typeof tvRaw === "string" ? parseFloat(tvRaw) : 0) ||
    positions.reduce((s, p) => s + (p.value ?? 0), 0) + usdcBalance;

  return {
    solBalance: Number.isFinite(solBalance) ? solBalance : 0,
    usdcBalance: Number.isFinite(usdcBalance) ? usdcBalance : 0,
    positions,
    totalUsd: Number.isFinite(totalUsd) ? totalUsd : 0,
  };
}

/**
 * Delay helper function
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Token transaction interfaces - for finding wallets that traded tokens
 */
export interface TokenTransaction {
  tx_type: "buy" | "sell" | "swap" | "add" | "remove";
  tx_hash: string;
  block_unix_time: number;
  block_number: number;
  volume_usd: number;
  volume: number;
  owner: string;
  signers: string[];
  source: string;
  side: "buy" | "sell";
  pool_id?: string;
  from?: {
    symbol: string;
    address: string;
    price: number;
    ui_change_amount: number;
  };
  to?: {
    symbol: string;
    address: string;
    price: number;
    ui_change_amount: number;
  };
}

export interface TokenTransactionsResponse {
  success: boolean;
  data: {
    items: TokenTransaction[];
  };
}

/**
 * User trade from Birdeye defi/v3/txs (wallet transaction history)
 */
export interface UserTrade {
  id: string;
  txHash: string;
  blockUnixTime: number;
  type: "swap";
  volumeUsd: number;
  volume: number;
  owner: string;
  source?: string;
  /** Token received (bought) - primary display token */
  toSymbol?: string;
  toAddress?: string;
  toAmount?: number;
  /** Token spent (sold) */
  fromSymbol?: string;
  fromAddress?: string;
  fromAmount?: number;
  chain?: "solana" | "base" | "bnb";
}

/** Raw item from Birdeye defi/v3/txs */
interface BirdeyeWalletTxItem {
  base?: { symbol?: string; address?: string; ui_change_amount?: number; type_swap?: string };
  quote?: { symbol?: string; address?: string; ui_change_amount?: number; type_swap?: string };
  tx_hash?: string;
  block_unix_time?: number;
  volume_usd?: number;
  volume?: number;
  owner?: string;
  source?: string;
}

function mapBirdeyeTxToUserTrade(
  item: BirdeyeWalletTxItem,
  owner: string,
  chain: "solana" | "base" | "bnb",
  index: number,
): UserTrade {
  const baseSide = item.base;
  const quoteSide = item.quote;
  const toSide = baseSide?.type_swap === "to" ? baseSide : quoteSide?.type_swap === "to" ? quoteSide : baseSide;
  const fromSide = baseSide?.type_swap === "from" ? baseSide : quoteSide?.type_swap === "from" ? quoteSide : quoteSide;
  const primaryToken = toSide ?? baseSide ?? quoteSide;
  return {
    id: `${chain}-${item.tx_hash ?? index}-${index}`,
    txHash: item.tx_hash ?? "",
    blockUnixTime: item.block_unix_time ?? 0,
    type: "swap",
    volumeUsd: item.volume_usd ?? 0,
    volume: item.volume ?? 0,
    owner: item.owner ?? owner,
    source: item.source,
    toSymbol: toSide?.symbol ?? primaryToken?.symbol,
    toAddress: toSide?.address ?? primaryToken?.address,
    toAmount: toSide?.ui_change_amount ?? primaryToken?.ui_change_amount,
    fromSymbol: fromSide?.symbol,
    fromAddress: fromSide?.address,
    fromAmount: fromSide?.ui_change_amount,
    chain: chain === "bnb" ? "bnb" : chain,
  };
}

/**
 * Get wallet's own trades (swaps) for a single chain - proxied via /api/birdeye/wallet-txs
 */
export async function getWalletTrades(
  walletAddress: string,
  chain: "solana" | "base" | "bnb" = "solana",
  limit: number = 50,
  offset: number = 0,
): Promise<{ items: UserTrade[]; hasNext?: boolean }> {
  const base = getApiBase();
  const params = new URLSearchParams({
    owner: walletAddress,
    limit: String(Math.max(1, Math.min(100, limit))),
    offset: String(Math.max(0, offset)),
    chain,
  });
  const res = await fetch(`${base}/api/birdeye/wallet-txs?${params.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { message?: string })?.message ?? (err as { error?: string })?.error ?? `Wallet trades: ${res.status}`,
    );
  }
  const data = (await res.json()) as {
    success?: boolean;
    data?: { items?: BirdeyeWalletTxItem[]; hasNext?: boolean; has_next?: boolean };
  };
  const rawItems = data?.data?.items ?? [];
  const items: UserTrade[] = rawItems.map((item, i) =>
    mapBirdeyeTxToUserTrade(item, walletAddress, chain === "bnb" ? "bnb" : chain, i),
  );
  return {
    items,
    hasNext: data?.data?.hasNext ?? data?.data?.has_next,
  };
}

/** Per-chain limit when fetching multi-chain to keep total ~50 */
const MULTI_CHAIN_LIMIT = 20;

/**
 * Get wallet's own trades across Solana, Base, and BNB.
 * Uses Solana wallet for Solana, EVM address for Base/BNB.
 */
export async function getWalletTradesMultiChain(
  walletAddress: string,
  evmAddress: string | null,
  limitPerChain: number = MULTI_CHAIN_LIMIT,
): Promise<{ items: UserTrade[] }> {
  const chains: Array<{ chain: "solana" | "base" | "bnb"; address: string }> = [
    { chain: "solana", address: walletAddress },
  ];
  if (evmAddress && evmAddress.length >= 40) {
    chains.push({ chain: "base", address: evmAddress });
    chains.push({ chain: "bnb", address: evmAddress });
  }

  const results = await Promise.allSettled(
    chains.map(({ chain, address }) => getWalletTrades(address, chain, limitPerChain, 0)),
  );

  const allItems: UserTrade[] = [];
  for (const result of results) {
    if (result.status === "fulfilled" && result.value.items.length > 0) {
      allItems.push(...result.value.items);
    }
  }
  allItems.sort((a, b) => b.blockUnixTime - a.blockUnixTime);
  return { items: allItems.slice(0, 60) };
}

/**
 * Get token transactions - proxied via /api/birdeye/token-txs
 */
export async function getTokenTransactions(
  tokenAddress: string,
  limit: number = 100,
  offset: number = 0,
  txType: "buy" | "sell" | "swap" | "add" | "remove" | "all" = "swap",
): Promise<TokenTransactionsResponse> {
  const clampedLimit = Math.max(1, Math.min(100, limit));
  const clampedOffset = Math.max(
    0,
    Math.min(9999, Math.min(offset, 10000 - clampedLimit)),
  );
  const base = getApiBase();
  const params = new URLSearchParams({
    address: tokenAddress,
    limit: String(clampedLimit),
    offset: String(clampedOffset),
    sort_by: "block_unix_time",
    sort_type: "desc",
    tx_type: txType,
    ui_amount_mode: "scaled",
  });
  const res = await fetch(`${base}/api/birdeye/token-txs?${params.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { message?: string }).message ||
        `Birdeye token-txs: ${res.status}`,
    );
  }
  return res.json();
}

/**
 * Get token transactions with pagination - fetches multiple pages
 * Fetches up to 10 pages (1000 transactions total) per token
 */
export async function getTokenTransactionsPaginated(
  tokenAddress: string,
  pages: number = 10,
  txType: "buy" | "sell" | "swap" | "add" | "remove" | "all" = "swap",
): Promise<TokenTransaction[]> {
  const allTransactions: TokenTransaction[] = [];
  const limit = 100; // API max limit per page

  for (let page = 0; page < pages; page++) {
    const offset = page * limit;
    try {
      const result = await getTokenTransactions(
        tokenAddress,
        limit,
        offset,
        txType,
      );
      if (result.success && result.data?.items) {
        allTransactions.push(...result.data.items);

        // If we got fewer items than the limit, we've reached the end
        if (result.data.items.length < limit) {
          break;
        }
      }

      // Add delay between pages to respect rate limits (600ms)
      if (page < pages - 1) {
        await delay(600);
      }
    } catch (error) {
      console.error(
        `Error getting page ${page + 1} of transactions for token ${tokenAddress}:`,
        error,
      );
      // Continue to next page even if one fails
      break;
    }
  }

  return allTransactions;
}

/**
 * Wallet PnL interfaces - matches actual API response structure
 */
export interface WalletPnLSummary {
  unique_tokens: number;
  counts: {
    total_buy: number;
    total_sell: number;
    total_trade: number;
    total_win: number;
    total_loss: number;
    win_rate: number;
  };
  cashflow_usd: {
    total_invested: number;
    total_sold: number;
    current_value?: number;
  };
  pnl: {
    realized_profit_usd: number;
    realized_profit_percent: number;
    unrealized_usd: number;
    total_usd: number;
    avg_profit_per_trade_usd: number;
  };
}

export interface WalletPnLSummaryResponse {
  success: boolean;
  data: {
    summary: WalletPnLSummary;
  };
}

/**
 * Get wallet PnL summary (single wallet)
 * Uses duration parameter instead of time_from/time_to
 * Includes increased retry attempts and longer delays for rate limit protection
 */
/**
 * Get wallet PnL summary - proxied via /api/birdeye/pnl-summary
 */
export async function getWalletPnLSummary(
  walletAddress: string,
  duration: "all" | "90d" | "30d" | "7d" | "24h" = "all",
): Promise<WalletPnLSummaryResponse> {
  const base = getApiBase();
  const params = new URLSearchParams({
    wallet: walletAddress,
    duration,
  });
  const res = await fetch(
    `${base}/api/birdeye/pnl-summary?${params.toString()}`,
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { message?: string }).message ||
        `Birdeye pnl-summary: ${res.status}`,
    );
  }
  return res.json();
}

/**
 * Per-token stats for a wallet (for accordion breakdown and average ROI).
 */
export interface ScannerTokenStat {
  mint: string;
  totalInvested: number;
  totalPnl: number; // totalRemoved - totalInvested for this token
  roiPct: number | null; // (totalPnl / totalInvested) * 100, or null if totalInvested <= 0
}

/**
 * Scanner functionality - Find wallets that traded multiple tokens
 */
export interface ScannerWallet {
  address: string;
  matched: number;
  total: number;
  tokens: string[];
  totalInvested: number; // Total USD invested (buy transactions)
  totalRemoved: number; // Total USD removed (sell transactions)
  /** Per-token invested, PnL, and ROI for accordion breakdown */
  tokenStats: ScannerTokenStat[];
  /** Average of each token's ROI % (only tokens with valid ROI); null if none */
  averageRoiPct: number | null;
}

/**
 * Scan for wallets that traded multiple tokens using Birdeye token transactions.
 * Replaces Solana Tracker top-traders API.
 *
 * Flow:
 * 1. For each token, fetch transactions from Birdeye (up to 1000 per token)
 * 2. Extract unique wallet addresses from transaction 'owner' field
 * 3. Cross-check wallets across tokens to find those that traded 2+ tokens
 * 4. Track per-(wallet,token) invested and removed from tx volumes
 * 5. Build tokenStats, averageRoiPct, sort by total PnL (desc)
 */
export async function scanWalletsForTokens(
  tokenMints: string[],
  minMatches: number = 2,
  minTrades: number = 2,
): Promise<ScannerWallet[]> {
  try {
    // Step 1: Get transactions for each token from Birdeye (up to 1000 transactions per token)
    const allTransactionsByToken: TokenTransaction[][] = [];
    for (let i = 0; i < tokenMints.length; i++) {
      const mint = tokenMints[i];
      try {
        const transactions = await getTokenTransactionsPaginated(
          mint,
          10,
          "swap",
        );
        allTransactionsByToken.push(transactions);
        if (i < tokenMints.length - 1) await delay(600);
      } catch (error) {
        console.error(`Error getting transactions for token ${mint}:`, error);
        allTransactionsByToken.push([]);
      }
    }

    // Step 2: Track per (wallet, token) invested and removed; aggregate per wallet
    const walletTokenMap = new Map<string, Set<string>>();
    const walletTransactionCount = new Map<string, number>();
    const walletTokenStats = new Map<
      string,
      Map<string, { invested: number; removed: number }>
    >();

    allTransactionsByToken.forEach((transactions, index) => {
      const tokenMint = tokenMints[index];
      const seenWallets = new Set<string>();

      transactions.forEach((tx) => {
        const wallet = tx.owner;
        if (!wallet) return;

        if (!walletTokenMap.has(wallet)) {
          walletTokenMap.set(wallet, new Set());
          walletTransactionCount.set(wallet, 0);
          walletTokenStats.set(wallet, new Map());
        }

        if (!seenWallets.has(wallet)) {
          walletTokenMap.get(wallet)!.add(tokenMint);
          seenWallets.add(wallet);
        }
        walletTransactionCount.set(
          wallet,
          walletTransactionCount.get(wallet)! + 1,
        );

        let investedUsd = 0;
        let removedUsd = 0;
        if (tx.side === "buy" || tx.tx_type === "buy") {
          if (tx.from && tx.from.price && tx.from.ui_change_amount) {
            investedUsd = tx.from.price * Math.abs(tx.from.ui_change_amount);
          } else {
            investedUsd = tx.volume_usd || 0;
          }
        } else if (tx.side === "sell" || tx.tx_type === "sell") {
          if (tx.to && tx.to.price && tx.to.ui_change_amount) {
            removedUsd = tx.to.price * tx.to.ui_change_amount;
          } else {
            removedUsd = tx.volume_usd || 0;
          }
        } else {
          investedUsd = tx.volume_usd || 0;
        }

        const tokenMap = walletTokenStats.get(wallet)!;
        const prev = tokenMap.get(tokenMint) ?? { invested: 0, removed: 0 };
        tokenMap.set(tokenMint, {
          invested: prev.invested + investedUsd,
          removed: prev.removed + removedUsd,
        });
      });
    });

    // Step 3: Filter wallets that match criteria
    const candidateWallets = Array.from(walletTokenMap.entries())
      .filter(([wallet, tokens]) => {
        const matches = tokens.size;
        const trades = walletTransactionCount.get(wallet) || 0;
        return matches >= minMatches && trades >= minTrades;
      })
      .map(([wallet]) => wallet);

    if (candidateWallets.length === 0) return [];

    // Step 4: Build ScannerWallet with tokenStats and averageRoiPct
    const wallets: ScannerWallet[] = candidateWallets.map((wallet) => {
      const tokens = Array.from(walletTokenMap.get(wallet) || []);
      const tokenMap = walletTokenStats.get(wallet) || new Map();
      const tokenStats: ScannerTokenStat[] = tokens.map((mint) => {
        const s = tokenMap.get(mint) ?? { invested: 0, removed: 0 };
        const totalInvested = s.invested;
        const totalPnl = s.removed - s.invested;
        const roiPct =
          totalInvested > 0 ? (totalPnl / totalInvested) * 100 : null;
        return { mint, totalInvested, totalPnl, roiPct };
      });
      const totalInvested = tokenStats.reduce((a, t) => a + t.totalInvested, 0);
      const totalRemoved = tokenStats.reduce(
        (a, t) => a + (t.totalInvested + t.totalPnl),
        0,
      ); // removed = invested + pnl
      const roiValues = tokenStats
        .map((t) => t.roiPct)
        .filter((r): r is number => r !== null);
      const averageRoiPct =
        roiValues.length > 0
          ? roiValues.reduce((a, b) => a + b, 0) / roiValues.length
          : null;

      return {
        address: wallet,
        matched: tokens.length,
        total: tokenMints.length,
        tokens,
        totalInvested,
        totalRemoved,
        tokenStats,
        averageRoiPct,
      };
    });

    // Step 5: Sort by total PnL (desc)
    return wallets.sort((a, b) => {
      const pnlA = a.totalRemoved - a.totalInvested;
      const pnlB = b.totalRemoved - b.totalInvested;
      return pnlB - pnlA;
    });
  } catch (error) {
    console.error("Error scanning wallets:", error);
    throw error;
  }
}

/**
 * Get wallet analytics summary using PnL endpoint
 */
export interface WalletAnalytics {
  address: string;
  totalTrades: number;
  winRate: number;
  wins: number;
  losses: number;
  totalVolume: number;
  tokens: string[];
  totalPnL?: number;
  totalPnLPercent?: number;
  realizedPnL?: number;
  unrealizedPnL?: number;
}

export async function getWalletAnalytics(
  walletAddress: string,
  duration: "all" | "90d" | "30d" | "7d" | "24h" = "all",
): Promise<WalletAnalytics> {
  try {
    // Use PnL summary endpoint for better performance
    const pnlSummary = await getWalletPnLSummary(walletAddress, duration);

    if (pnlSummary.data?.summary) {
      const summary = pnlSummary.data.summary;

      // Get token list for additional context (optional - can be removed if not needed)
      const tokens: string[] = []; // Placeholder - would need separate API call

      return {
        address: walletAddress,
        totalTrades: summary.counts.total_trade || 0,
        winRate: (summary.counts.win_rate || 0) * 100, // Convert to percentage (0-100)
        wins: summary.counts.total_win || 0,
        losses: summary.counts.total_loss || 0,
        totalVolume: summary.cashflow_usd.total_invested || 0,
        tokens,
        totalPnL: summary.pnl.total_usd,
        totalPnLPercent: summary.pnl.realized_profit_percent,
        realizedPnL: summary.pnl.realized_profit_usd,
        unrealizedPnL: summary.pnl.unrealized_usd,
      };
    }

    throw new Error("Failed to get wallet analytics");
  } catch (error) {
    console.error("Error getting wallet analytics:", error);
    throw error;
  }
}
