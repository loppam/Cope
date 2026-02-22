/**
 * COPE Scanner – Solana Tracker Data API only.
 * Finds wallets that traded multiple tokens.
 *
 * Uses GET /api/solanatracker/trades/{tokenAddress} (proxied, API key server-side).
 * volume = USD value per trade; ROI = (removed - invested) / invested * 100.
 */
import { getApiBase } from "./utils";
import type { ScannerWallet, ScannerTokenStat } from "./birdeye";

const DELAY_MS = 650;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface ScannerProgress {
  phase: "fetching" | "finding" | "ranking";
  transactionsScanned: number;
  uniqueWalletsSeen: number;
  currentToken: number; // 1-based
  totalTokens: number;
  matchedWallets?: number;
}

interface SolanaTrackerTrade {
  tx?: string;
  amount?: number;
  priceUsd?: number;
  volume?: number;
  volumeSol?: number;
  type?: "buy" | "sell";
  wallet?: string;
  time?: number;
  program?: string;
  pools?: string[];
}

interface SolanaTrackerTradesResponse {
  trades?: SolanaTrackerTrade[];
  nextCursor?: number | string;
  hasNextPage?: boolean;
}

function getTradesUrl(mint: string, cursor?: string | number): string {
  const base = getApiBase() || "";
  const path = `${base.replace(/\/$/, "")}/api/solanatracker/trades/${encodeURIComponent(mint)}`;
  const url = path.startsWith("http")
    ? new URL(path)
    : new URL(path, typeof window !== "undefined" ? window.location.origin : undefined);
  if (cursor != null) url.searchParams.set("cursor", String(cursor));
  return url.toString();
}

async function fetchTokenTrades(
  mint: string,
  onProgress?: (scanned: number, page: number) => void
): Promise<Array<{ owner: string; side: string; tx_type: string; volume_usd: number }>> {
  const all: Array<{ owner: string; side: string; tx_type: string; volume_usd: number }> = [];
  let cursor: string | number | null = null;
  let page = 0;

  while (true) {
    const url = getTradesUrl(mint, cursor ?? undefined);
    const res = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Solana Tracker ${res.status}: ${text.slice(0, 150)}`);
    }

    const data = (await res.json()) as SolanaTrackerTradesResponse;
    const trades = data?.trades ?? [];

    for (const t of trades) {
      const volUsd =
        t?.volume ??
        (t?.amount != null &&
        t?.priceUsd != null &&
        t?.priceUsd > 0 &&
        Number.isFinite(t.amount) &&
        Number.isFinite(t.priceUsd)
          ? Math.abs(t.amount) * t.priceUsd
          : 0);
      all.push({
        owner: t?.wallet ?? "",
        side: t?.type === "sell" ? "sell" : "buy",
        tx_type: t?.type === "sell" ? "sell" : "buy",
        volume_usd: volUsd,
      });
    }

    if (onProgress) onProgress(all.length, page + 1);

    const hasNext = data?.hasNextPage === true;
    const nextCursor = data?.nextCursor;
    if (!hasNext || nextCursor == null || trades.length === 0) break;

    cursor = typeof nextCursor === "number" ? nextCursor : nextCursor;
    page++;
    await delay(DELAY_MS);
  }

  return all;
}

/**
 * Scan for wallets that traded multiple tokens using Solana Tracker only.
 * Uses volume (USD) for invested/removed. ROI = (removed - invested) / invested * 100.
 */
export async function scanWalletsForTokens(
  tokenMints: string[],
  minMatches: number = 2,
  minTrades: number = 2,
  onProgress?: (p: ScannerProgress) => void
): Promise<ScannerWallet[]> {
  const allTransactionsByToken: Array<
    Array<{ owner: string; side: string; tx_type: string; volume_usd: number }>
  > = [];
  const walletTokenMap = new Map<string, Set<string>>();
  const walletTransactionCount = new Map<string, number>();
  const walletTokenStats = new Map<
    string,
    Map<string, { invested: number; removed: number }>
  >();

  const processTxsIntoMaps = (
    transactions: Array<{
      owner: string;
      side: string;
      tx_type: string;
      volume_usd: number;
    }>,
    tokenMint: string
  ) => {
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
      walletTransactionCount.set(wallet, walletTransactionCount.get(wallet)! + 1);

      const volUsd = tx.volume_usd ?? 0;
      let investedUsd = 0;
      let removedUsd = 0;
      if (tx.side === "buy" || tx.tx_type === "buy") {
        investedUsd = volUsd;
      } else if (tx.side === "sell" || tx.tx_type === "sell") {
        removedUsd = volUsd;
      }

      const tokenMap = walletTokenStats.get(wallet)!;
      const prev = tokenMap.get(tokenMint) ?? { invested: 0, removed: 0 };
      tokenMap.set(tokenMint, {
        invested: prev.invested + investedUsd,
        removed: prev.removed + removedUsd,
      });
    });
  };

  for (let i = 0; i < tokenMints.length; i++) {
    const mint = tokenMints[i];
    onProgress?.({
      phase: "fetching",
      transactionsScanned: allTransactionsByToken.reduce((s, arr) => s + arr.length, 0),
      uniqueWalletsSeen: walletTokenMap.size,
      currentToken: i + 1,
      totalTokens: tokenMints.length,
    });

    try {
      const txs = await fetchTokenTrades(mint, (scanned) => {
        const prevTotal = allTransactionsByToken.reduce(
          (s, arr) => s + arr.length,
          0
        );
        onProgress?.({
          phase: "fetching",
          transactionsScanned: prevTotal + scanned,
          uniqueWalletsSeen: walletTokenMap.size,
          currentToken: i + 1,
          totalTokens: tokenMints.length,
        });
      });
      allTransactionsByToken.push(txs);
      processTxsIntoMaps(txs, mint);
    } catch (err) {
      console.error(`Scanner: error for ${mint}:`, err);
      allTransactionsByToken.push([]);
    }

    if (i < tokenMints.length - 1) await delay(DELAY_MS);
  }

  onProgress?.({
    phase: "finding",
    transactionsScanned: allTransactionsByToken.reduce((s, arr) => s + arr.length, 0),
    uniqueWalletsSeen: walletTokenMap.size,
    currentToken: tokenMints.length,
    totalTokens: tokenMints.length,
  });

  const candidateWallets = Array.from(walletTokenMap.entries())
    .filter(([wallet, tokens]) => {
      const matches = tokens.size;
      const trades = walletTransactionCount.get(wallet) ?? 0;
      return matches >= minMatches && trades >= minTrades;
    })
    .map(([wallet]) => wallet);

  onProgress?.({
    phase: "ranking",
    transactionsScanned: allTransactionsByToken.reduce((s, arr) => s + arr.length, 0),
    uniqueWalletsSeen: walletTokenMap.size,
    currentToken: tokenMints.length,
    totalTokens: tokenMints.length,
    matchedWallets: candidateWallets.length,
  });

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
      0
    );
    const averageRoiPct =
      totalInvested > 0
        ? ((totalRemoved - totalInvested) / totalInvested) * 100
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

  return wallets.sort((a, b) => {
    const pnlA = a.totalRemoved - a.totalInvested;
    const pnlB = b.totalRemoved - b.totalInvested;
    return pnlB - pnlA;
  });
}
