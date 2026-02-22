#!/usr/bin/env node
/**
 * Run bridge-evm-usdc-fallback logic locally.
 * Same flow as the cron but logs to stdout in real time (no HTTP).
 *
 * Prerequisites: .env with FIREBASE_SERVICE_ACCOUNT, API_BASE_URL,
 * WEBHOOK_EVM_DEPOSIT_SECRET. BASE_RPC_URL and BNB_RPC_URL recommended
 * (public RPCs are rate-limited; use Alchemy/Infura for reliability).
 *
 * Usage:
 *   node --env-file=.env scripts/bridge-evm-usdc-to-sol.mjs
 *   node scripts/bridge-evm-usdc-to-sol.mjs
 *
 * Options:
 *   --dry-run   Report what would be bridged, no API calls
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { Contract, JsonRpcProvider } from "ethers";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

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

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BNB_USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)"];
const MIN_USDC_RAW = 500_000; // $0.50 minimum
const BALANCE_RETRIES = 3;
const RETRY_DELAY_MS = 800;

async function callWithRetry(fn) {
  for (let attempt = 1; attempt <= BALANCE_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const isLast = attempt === BALANCE_RETRIES;
      if (isLast) throw e;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
    }
  }
}

async function getEvmBalances(address, baseProvider, bnbProvider) {
  const result = {
    base: { usdc: 0, usdcRaw: 0n },
    bnb: { usdc: 0, usdcRaw: 0n },
  };
  try {
    const baseUsdcRaw = await callWithRetry(
      () =>
        new Contract(BASE_USDC, ERC20_ABI, baseProvider).balanceOf(address),
      "Base USDC"
    );
    result.base.usdcRaw = baseUsdcRaw;
    result.base.usdc = Number(baseUsdcRaw) / 1e6;
  } catch (e) {
    console.warn("[bridge-evm-usdc] Base balance fetch failed:", e?.message || e);
  }
  try {
    const bnbUsdcRaw = await callWithRetry(
      () =>
        new Contract(BNB_USDC, ERC20_ABI, bnbProvider).balanceOf(address),
      "BNB USDC"
    );
    result.bnb.usdcRaw = bnbUsdcRaw;
    result.bnb.usdc = Number(bnbUsdcRaw) / 1e18;
  } catch (e) {
    console.warn("[bridge-evm-usdc] BNB balance fetch failed:", e?.message || e);
  }
  return result;
}

function initFirebase() {
  if (getApps().length > 0) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  let projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  let clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
  if (raw) {
    try {
      const sa = JSON.parse(raw);
      projectId = sa.project_id;
      clientEmail = sa.client_email;
      privateKey = sa.private_key?.replace(/\\n/g, "\n");
    } catch (e) {
      console.error("Invalid FIREBASE_SERVICE_ACCOUNT JSON:", e?.message);
      process.exit(1);
    }
  }
  if (privateKey && typeof privateKey === "string") privateKey = privateKey.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase admin not configured (FIREBASE_SERVICE_ACCOUNT or FIREBASE_ADMIN_*)");
  }
  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) console.log("[bridge-evm-usdc] DRY RUN – no API calls\n");

  const apiBase = process.env.API_BASE_URL || "https://www.trycope.com";
  const relaySecret =
    process.env.WEBHOOK_EVM_DEPOSIT_SECRET || process.env.RELAY_INTERNAL_SECRET;
  if (!relaySecret) {
    console.error("Missing WEBHOOK_EVM_DEPOSIT_SECRET or RELAY_INTERNAL_SECRET in .env");
    process.exit(1);
  }

  initFirebase();
  const db = getFirestore();

  const relayHeaders = {
    "Content-Type": "application/json",
    "x-webhook-secret": relaySecret,
  };

  const usersSnap = await db.collection("users").get();
  const usersWithEvm = usersSnap.docs.filter((d) => {
    const data = d.data();
    return (
      data.evmAddress &&
      typeof data.evmAddress === "string" &&
      data.evmAddress.length >= 40 &&
      data.walletAddress &&
      typeof data.walletAddress === "string" &&
      data.walletAddress.length >= 32
    );
  });

  console.log(
    `[bridge-evm-usdc] ${usersWithEvm.length} users with evmAddress+walletAddress\n`
  );

  const baseRpc = process.env.BASE_RPC_URL || "https://mainnet.base.org";
  const bnbRpc = process.env.BNB_RPC_URL || "https://bsc-dataseed.binance.org";
  if (!process.env.BASE_RPC_URL) {
    console.warn(
      "[bridge-evm-usdc] BASE_RPC_URL not set; using public RPC (rate-limited). Set BASE_RPC_URL to Alchemy/Infura for reliability.\n"
    );
  }
  const baseProvider = new JsonRpcProvider(baseRpc);
  const bnbProvider = new JsonRpcProvider(bnbRpc);

  const toProcess = [];

  for (const doc of usersWithEvm) {
    const userId = doc.id;
    const evmAddress = doc.data().evmAddress.toLowerCase();
    const walletAddress = doc.data().walletAddress;

    const balances = await getEvmBalances(
      evmAddress,
      baseProvider,
      bnbProvider
    );
    await new Promise((r) => setTimeout(r, 120));

    const chains = [
      { network: "base", raw: balances.base.usdcRaw, usdc: balances.base.usdc },
      { network: "bnb", raw: balances.bnb.usdcRaw, usdc: balances.bnb.usdc },
    ];

    for (const { network, raw, usdc } of chains) {
      if (raw <= BigInt(MIN_USDC_RAW)) continue;
      toProcess.push({
        userId,
        evmAddress,
        walletAddress,
        network,
        amountRaw: raw.toString(),
        amountUsdc: usdc,
      });
    }
  }

  console.log(
    `[bridge-evm-usdc] ${toProcess.length} bridge(s) to process${dryRun ? " (dry run)" : ""}\n`
  );

  let ok = 0;
  let err = 0;

  for (const item of toProcess) {
    const { userId, evmAddress, walletAddress, network, amountRaw, amountUsdc } =
      item;

    if (dryRun) {
      console.log(
        `[bridge-evm-usdc] dry run: would bridge $${amountUsdc.toFixed(2)} ${network} → ${walletAddress.slice(0, 8)}...`
      );
      ok++;
      continue;
    }

    try {
      console.log(
        `[bridge-evm-usdc] ${userId} ${network}: bridging $${amountUsdc.toFixed(2)} (quote+execute with derived address)...`
      );
      // execute-bridge-custodial derives EVM address and fetches quote internally (fixes wallet mismatch)
      const execRes = await fetch(`${apiBase}/api/relay/execute-bridge-custodial`, {
        method: "POST",
        headers: relayHeaders,
        body: JSON.stringify({
          userId,
          network,
          amountRaw,
          recipientSolAddress: walletAddress,
        }),
      });

      if (!execRes.ok) {
        const errText = await execRes.text();
        console.error(`[bridge-evm-usdc] ${userId} ${network} execute failed:`, errText);
        err++;
        continue;
      }

      console.log(
        `[bridge-evm-usdc] ✓ bridged $${amountUsdc.toFixed(2)} ${network} → ${walletAddress.slice(0, 8)}...`
      );
      ok++;
    } catch (e) {
      console.error(`[bridge-evm-usdc] ${userId} ${network} error:`, e?.message || e);
      err++;
    }
  }

  console.log(`\n[bridge-evm-usdc] done. ok=${ok} error=${err}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
