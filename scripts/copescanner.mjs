#!/usr/bin/env node
/**
 * COPE Scanner – interactive terminal script
 * Finds wallets that traded multiple tokens using Birdeye API (same as app scanner).
 *
 * Usage:
 *   node scripts/copescanner.mjs
 *   pnpm run copescanner
 *
 * Paste 2+ mint addresses (one per line or comma/space separated), then Enter twice to scan.
 *
 * Env: BIRDEYE_API_KEY
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import * as readline from "readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env");
if (existsSync(envPath)) {
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      const key = m[1].trim();
      const val = m[2].replace(/^["']|["']$/g, "").trim();
      if (!(key in process.env)) process.env[key] = val;
    }
  }
}

const BIRDEYE_API_BASE = "https://public-api.birdeye.so";
const MAX_PAGES_PER_TOKEN = 100; // 100 × 10 = 1000 trades per token (matches birdeye.ts)
const DELAY_MS = 600; // Matches birdeye.ts rate limit

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Birdeye ---

/**
 * Fetch token trades from Birdeye API (offset pagination, 100 per page)
 */
async function getTokenTradesFromBirdeye(tokenAddress, apiKey, maxPages = MAX_PAGES_PER_TOKEN, onProgress = null) {
  const allTrades = [];
  const limit = 100;

  for (let page = 0; page < maxPages; page++) {
    const offset = page * limit;
    const url = new URL(`${BIRDEYE_API_BASE}/defi/v3/token/txs`);
    url.searchParams.set("address", tokenAddress);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("sort_by", "block_unix_time");
    url.searchParams.set("sort_type", "desc");
    url.searchParams.set("tx_type", "swap");
    url.searchParams.set("ui_amount_mode", "scaled");

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
        "x-chain": "solana",
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Birdeye API ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    const items = data?.data?.items ?? [];
    allTrades.push(...items);

    if (onProgress) onProgress(tokenAddress, page + 1, items.length);

    if (items.length < limit) break;
    if (page < maxPages - 1) await delay(DELAY_MS);
  }

  return allTrades;
}

/** Birdeye items already match scanner format (owner, side, volume_usd, from, to) */
function birdeyeToScannerTx(item) {
  return {
    owner: item?.owner ?? "",
    side: item?.side ?? "buy",
    tx_type: item?.side ?? "buy",
    volume_usd: item?.volume_usd ?? 0,
    from: item?.from,
    to: item?.to,
  };
}

/**
 * Scan for wallets that traded multiple tokens (same logic as birdeye.ts scanWalletsForTokens)
 */
async function scanWalletsForTokens(
  tokenMints,
  apiKey,
  minMatches = 2,
  minTrades = 2,
  onProgress = null
) {
  const allTransactionsByToken = [];

  for (let i = 0; i < tokenMints.length; i++) {
    const mint = tokenMints[i];
    try {
      const trades = await getTokenTradesFromBirdeye(mint, apiKey, MAX_PAGES_PER_TOKEN, (addr, page, count) => {
        if (onProgress) onProgress(`Fetching ${addr.slice(0, 8)}...`, page, count);
      });
      const txs = trades.map((t) => birdeyeToScannerTx(t));
      allTransactionsByToken.push(txs);
    } catch (err) {
      console.error(`Error fetching trades for ${mint}:`, err.message);
      allTransactionsByToken.push([]);
    }
    if (i < tokenMints.length - 1) await delay(DELAY_MS);
  }

  const walletTokenMap = new Map();
  const walletTransactionCount = new Map();
  const walletTokenStats = new Map();

  allTransactionsByToken.forEach((transactions, index) => {
    const tokenMint = tokenMints[index];
    const seenWallets = new Set();

    transactions.forEach((tx) => {
      const wallet = tx.owner;
      if (!wallet) return;

      if (!walletTokenMap.has(wallet)) {
        walletTokenMap.set(wallet, new Set());
        walletTransactionCount.set(wallet, 0);
        walletTokenStats.set(wallet, new Map());
      }

      if (!seenWallets.has(wallet)) {
        walletTokenMap.get(wallet).add(tokenMint);
        seenWallets.add(wallet);
      }
      walletTransactionCount.set(wallet, walletTransactionCount.get(wallet) + 1);

      let investedUsd = 0;
      let removedUsd = 0;
      if (tx.side === "buy" || tx.tx_type === "buy") {
        investedUsd = tx.from?.price * Math.abs(tx.from?.ui_change_amount ?? 0) || tx.volume_usd || 0;
      } else if (tx.side === "sell" || tx.tx_type === "sell") {
        removedUsd = tx.to?.price * (tx.to?.ui_change_amount ?? 0) || tx.volume_usd || 0;
      } else {
        investedUsd = tx.volume_usd || 0;
      }

      const tokenMap = walletTokenStats.get(wallet);
      const prev = tokenMap.get(tokenMint) ?? { invested: 0, removed: 0 };
      tokenMap.set(tokenMint, {
        invested: prev.invested + investedUsd,
        removed: prev.removed + removedUsd,
      });
    });
  });

  const candidateWallets = Array.from(walletTokenMap.entries())
    .filter(([wallet, tokens]) => {
      const matches = tokens.size;
      const trades = walletTransactionCount.get(wallet) ?? 0;
      return matches >= minMatches && trades >= minTrades;
    })
    .map(([wallet]) => wallet);

  const wallets = candidateWallets.map((wallet) => {
    const tokens = Array.from(walletTokenMap.get(wallet) || []);
    const tokenMap = walletTokenStats.get(wallet) || new Map();
    const tokenStats = tokens.map((mint) => {
      const s = tokenMap.get(mint) ?? { invested: 0, removed: 0 };
      const totalInvested = s.invested;
      const totalPnl = s.removed - s.invested;
      const roiPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : null;
      return { mint, totalInvested, totalPnl, roiPct };
    });
    const totalInvested = tokenStats.reduce((a, t) => a + t.totalInvested, 0);
    const totalRemoved = tokenStats.reduce((a, t) => a + t.totalInvested + t.totalPnl, 0);
    const roiValues = tokenStats.map((t) => t.roiPct).filter((r) => r !== null);
    const averageRoiPct = roiValues.length > 0 ? roiValues.reduce((a, b) => a + b, 0) / roiValues.length : null;

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

function shortenAddress(addr) {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
}

function formatUsd(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

async function main() {
  const apiKey = process.env.BIRDEYE_API_KEY;
  if (!apiKey) {
    console.error("ERROR: BIRDEYE_API_KEY not set. Add it to .env");
    process.exit(1);
  }

  console.log("\n  COPE Scanner (Birdeye API)");
  console.log("  ———————————————————————————————————");
  console.log("  Paste 2+ mint addresses (one per line, or comma/space separated)");
  console.log("  Then press Enter twice to scan.\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

  const lines = [];
  const waitForInput = () => {
    return new Promise((resolve) => {
      const finish = () => {
        rl.close();
        resolve(lines.join("\n"));
      };
      rl.on("line", (line) => {
        if (line.trim() === "" && lines.length > 0) {
          finish();
        } else {
          lines.push(line);
        }
      });
      rl.on("close", () => {
        if (lines.length > 0) resolve(lines.join("\n"));
        else resolve("");
      });
    });
  };

  let input = "";
  try {
    input = await waitForInput();
  } catch {
    process.exit(1);
  }

  const raw = input
    .split(/[\n,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 32);
  const mints = [...new Set(raw)];

  if (mints.length < 2) {
    console.error("\nNeed at least 2 valid mint addresses to scan.");
    process.exit(1);
  }

  console.log(`\n  Scanning ${mints.length} tokens...\n`);

  try {
    const wallets = await scanWalletsForTokens(
      mints,
      apiKey,
      2,
      2,
      (msg, page, count) => {
        process.stdout.write(`  ${msg} page ${page} (+${count} trades)\r`);
      }
    );

    console.log("\n");
    console.log("  Results");
    console.log("  ———————————————————————————————————");

    if (wallets.length === 0) {
      console.log("  No wallets found that traded 2+ of the given tokens.\n");
      return;
    }

    wallets.slice(0, 20).forEach((w, i) => {
      const pnl = w.totalRemoved - w.totalInvested;
      const roiStr = w.averageRoiPct != null ? `${w.averageRoiPct >= 0 ? "+" : ""}${w.averageRoiPct.toFixed(1)}%` : "—";
      console.log(`  ${(i + 1).toString().padStart(2)}  ${shortenAddress(w.address)}  matched ${w.matched}/${w.total}  PnL ${formatUsd(pnl)}  ROI ${roiStr}`);
    });

    if (wallets.length > 20) {
      console.log(`  ... and ${wallets.length - 20} more`);
    }
    console.log(`\n  Top GMGN: https://gmgn.ai/sol/address/${wallets[0]?.address ?? ""}\n`);
  } catch (err) {
    console.error("\nError:", err.message);
    process.exit(1);
  }
}

main();
