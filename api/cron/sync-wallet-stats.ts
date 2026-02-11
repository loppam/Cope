/**
 * Cron job: sync wallet stats (win rate, PnL) from Birdeye to Firestore.
 * Runs daily at 00:00 UTC. Requires CRON_SECRET in Authorization header.
 *
 * Rate limit: ~2s between Birdeye calls to stay under 30 req/min.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const BIRDEYE_API_BASE = "https://public-api.birdeye.so";
const DELAY_MS = 2000;
const MAX_WALLETS = 50;

function isUserPublic(data: { isPublic?: boolean }): boolean {
  return data.isPublic !== false;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchBirdeyePnL(
  walletAddress: string,
  apiKey: string,
): Promise<{ winRate: number; totalTrades: number; realizedPnL: number } | null> {
  const url = new URL(`${BIRDEYE_API_BASE}/wallet/v2/pnl/summary`);
  url.searchParams.set("wallet", walletAddress);
  url.searchParams.set("duration", "all");

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
      "x-chain": "solana",
    },
  });

  if (!res.ok) return null;

  const json = await res.json().catch(() => null);
  if (!json?.data?.summary) return null;

  const summary = json.data.summary;
  const winRate = (summary.counts?.win_rate ?? 0) * 100;
  const totalTrades = summary.counts?.total_trade ?? 0;
  const realizedPnL = summary.pnl?.realized_profit_percent ?? 0;

  return { winRate, totalTrades, realizedPnL };
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

  const apiKey = process.env.BIRDEYE_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "BIRDEYE_API_KEY not configured" });
    return;
  }

  if (getApps().length === 0) {
    const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    let projectId: string | undefined;
    let clientEmail: string | undefined;
    let privateKey: string | undefined;

    if (rawServiceAccount) {
      try {
        const serviceAccount = JSON.parse(rawServiceAccount);
        projectId = serviceAccount.project_id;
        clientEmail = serviceAccount.client_email;
        privateKey = serviceAccount.private_key?.replace(/\\n/g, "\n");
      } catch {
        // ignore
      }
    }

    projectId = projectId || process.env.FIREBASE_ADMIN_PROJECT_ID;
    clientEmail = clientEmail || process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
    if (!privateKey && process.env.FIREBASE_ADMIN_PRIVATE_KEY) {
      privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n");
    }

    if (!projectId || !clientEmail || !privateKey) {
      res.status(503).json({ error: "Firebase admin not configured" });
      return;
    }

    initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  }

  const db = getFirestore();

  try {
    const usersSnap = await db
      .collection("users")
      .where("walletAddress", "!=", null)
      .limit(MAX_WALLETS * 2)
      .get();

    const publicUsers = usersSnap.docs
      .filter((d) => {
        const data = d.data();
        return data.walletAddress && isUserPublic(data);
      })
      .slice(0, MAX_WALLETS)
      .map((d) => ({
        uid: d.id,
        walletAddress: d.data().walletAddress as string,
      }));

    let synced = 0;
    for (let i = 0; i < publicUsers.length; i++) {
      const { uid, walletAddress } = publicUsers[i];
      const pnl = await fetchBirdeyePnL(walletAddress, apiKey);

      if (pnl) {
        await db.collection("walletStats").doc(walletAddress).set({
          uid,
          winRate: pnl.winRate,
          totalTrades: pnl.totalTrades,
          realizedPnL: pnl.realizedPnL,
          lastUpdated: FieldValue.serverTimestamp(),
        });
        synced++;
      }

      if (i < publicUsers.length - 1) {
        await delay(DELAY_MS);
      }
    }

    res.status(200).json({
      ok: true,
      synced,
      total: publicUsers.length,
    });
  } catch (err) {
    console.error("[cron/sync-wallet-stats]", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Sync failed",
    });
  }
}
