/**
 * Cron + curl-testable: Bridge EVM USDC (Base/BNB) → Solana USDC.
 * Fallback when Relay or Alchemy webhook fails; runs periodically to catch stuck deposits.
 *
 * Auth: Bearer CRON_SECRET (cron + curl).
 * Query: ?dryRun=1 to report what would be bridged without executing.
 *
 * Balance: Uses RPC. Base USDC = 6 decimals, BNB USDC (Binance-Peg) = 18 decimals.
 *
 * curl -H "Authorization: Bearer $CRON_SECRET" \
 *   "https://your-domain.vercel.app/api/cron/bridge-evm-usdc-fallback?dryRun=1"
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { Contract, JsonRpcProvider } from "ethers";

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BNB_USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
] as const;
const MIN_USDC_RAW = 500_000; // $0.50 minimum to avoid dust + gas cost

async function getEvmBalances(address: string): Promise<{
  base: { usdc: number; usdcRaw: bigint };
  bnb: { usdc: number; usdcRaw: bigint };
}> {
  const result = {
    base: { usdc: 0, usdcRaw: 0n },
    bnb: { usdc: 0, usdcRaw: 0n },
  };
  try {
    const baseProvider = new JsonRpcProvider(
      process.env.BASE_RPC_URL || "https://mainnet.base.org",
    );
    const baseUsdcRaw = await new Contract(
      BASE_USDC,
      ERC20_ABI,
      baseProvider,
    ).balanceOf(address);
    result.base.usdcRaw = baseUsdcRaw;
    result.base.usdc = Number(baseUsdcRaw) / 1e6;
  } catch (e) {
    console.warn("[bridge-evm-usdc-fallback] Base balance fetch failed:", e);
  }
  try {
    const bnbProvider = new JsonRpcProvider(
      process.env.BNB_RPC_URL || "https://bsc-dataseed.binance.org",
    );
    const bnbUsdcRaw = await new Contract(
      BNB_USDC,
      ERC20_ABI,
      bnbProvider,
    ).balanceOf(address);
    result.bnb.usdcRaw = bnbUsdcRaw;
    // BNB USDC (Binance-Peg) has 18 decimals on-chain
    result.bnb.usdc = Number(bnbUsdcRaw) / 1e18;
  } catch (e) {
    console.warn("[bridge-evm-usdc-fallback] BNB balance fetch failed:", e);
  }
  return result;
}

function ensureFirebase() {
  if (getApps().length > 0) return;
  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  let projectId: string | undefined;
  let clientEmail: string | undefined;
  let privateKey: string | undefined;
  if (rawServiceAccount) {
    try {
      const sa = JSON.parse(rawServiceAccount);
      projectId = sa.project_id;
      clientEmail = sa.client_email;
      privateKey = sa.private_key?.replace(/\\n/g, "\n");
    } catch {
      /* ignore */
    }
  }
  projectId = projectId || process.env.FIREBASE_ADMIN_PROJECT_ID;
  clientEmail = clientEmail || process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  if (!privateKey && process.env.FIREBASE_ADMIN_PRIVATE_KEY) {
    privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n");
  }
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase admin not configured");
  }
  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
}

interface BridgeResult {
  userId: string;
  evmAddress: string;
  network: "base" | "bnb";
  amountUsdc: number;
  amountRaw: string;
  status: "ok" | "skipped" | "error";
  error?: string;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const dryRun = req.query.dryRun === "1" || req.query.dryRun === "true";
  const apiBase =
    process.env.API_BASE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  const relaySecret =
    process.env.WEBHOOK_EVM_DEPOSIT_SECRET ||
    process.env.RELAY_INTERNAL_SECRET;

  if (!apiBase) {
    res.status(503).json({
      error: "API_BASE_URL or VERCEL_URL not configured",
    });
    return;
  }

  if (!relaySecret) {
    res.status(503).json({
      error: "WEBHOOK_EVM_DEPOSIT_SECRET or RELAY_INTERNAL_SECRET not configured",
    });
    return;
  }

  ensureFirebase();
  const db = getFirestore();

  const relayHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "x-webhook-secret": relaySecret,
  };

  const results: BridgeResult[] = [];
  const toProcess: Array<{
    userId: string;
    evmAddress: string;
    walletAddress: string;
    network: "base" | "bnb";
    amountRaw: string;
    amountUsdc: number;
  }> = [];

  try {
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
      `[bridge-evm-usdc-fallback] ${usersWithEvm.length} users with evmAddress+walletAddress`,
    );

    for (const doc of usersWithEvm) {
      const userId = doc.id;
      const evmAddress = (doc.data().evmAddress as string).toLowerCase();
      const walletAddress = doc.data().walletAddress as string;

      const balances = await getEvmBalances(evmAddress);

      const chains: Array<{ network: "base" | "bnb"; raw: bigint; usdc: number }> = [
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
      `[bridge-evm-usdc-fallback] ${toProcess.length} bridge(s) to process${dryRun ? " (dry run)" : ""}`,
    );

    for (const item of toProcess) {
      const { userId, evmAddress, walletAddress, network, amountRaw, amountUsdc } =
        item;
      const result: BridgeResult = {
        userId,
        evmAddress: evmAddress.slice(0, 10) + "...",
        network,
        amountUsdc,
        amountRaw,
        status: "skipped",
      };

      if (dryRun) {
        result.status = "skipped";
        result.error = "dry run – not executed";
        results.push(result);
        console.log(
          `[bridge-evm-usdc-fallback] dry run: would bridge $${amountUsdc.toFixed(2)} ${network} → ${walletAddress.slice(0, 8)}...`,
        );
        continue;
      }

      try {
        const quoteRes = await fetch(`${apiBase}/api/relay/bridge-from-evm-quote`, {
          method: "POST",
          headers: relayHeaders,
          body: JSON.stringify({
            evmAddress,
            network,
            amountRaw,
            recipientSolAddress: walletAddress,
          }),
        });

        if (!quoteRes.ok) {
          const errText = await quoteRes.text();
          result.status = "error";
          result.error = `quote failed ${quoteRes.status}: ${errText.slice(0, 200)}`;
          results.push(result);
          console.error(
            `[bridge-evm-usdc-fallback] ${userId} ${network} quote failed:`,
            result.error,
          );
          continue;
        }

        const quote = await quoteRes.json();
        const execRes = await fetch(
          `${apiBase}/api/relay/execute-bridge-custodial`,
          {
            method: "POST",
            headers: relayHeaders,
            body: JSON.stringify({ userId, quoteResponse: quote }),
          },
        );

        if (!execRes.ok) {
          const errText = await execRes.text();
          result.status = "error";
          result.error = `execute failed ${execRes.status}: ${errText.slice(0, 200)}`;
          results.push(result);
          console.error(
            `[bridge-evm-usdc-fallback] ${userId} ${network} execute failed:`,
            result.error,
          );
          continue;
        }

        result.status = "ok";
        results.push(result);
        console.log(
          `[bridge-evm-usdc-fallback] bridged $${amountUsdc.toFixed(2)} ${network} → ${walletAddress.slice(0, 8)}...`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result.status = "error";
        result.error = msg;
        results.push(result);
        console.error(
          `[bridge-evm-usdc-fallback] ${userId} ${network} error:`,
          msg,
        );
      }
    }

    const ok = results.filter((r) => r.status === "ok").length;
    const err = results.filter((r) => r.status === "error").length;
    const skipped = results.filter((r) => r.status === "skipped").length;

    res.status(200).json({
      dryRun,
      total: results.length,
      ok,
      error: err,
      skipped,
      results,
    });
  } catch (e) {
    console.error("[bridge-evm-usdc-fallback] fatal error:", e);
    res.status(500).json({
      error: e instanceof Error ? e.message : "Internal server error",
    });
  }
}
