/**
 * Cron job: compute full wallet balance (Solana + EVM) for users with wallets,
 * with retries on 429/502. Store in users/{uid}: balanceCurrent, balanceCurrentAt,
 * balancePrev, balancePrevAt. Home reads 24h from user profile.
 * Runs daily at 00:05 UTC. Auth: Bearer CRON_SECRET.
 * Uses direct Solana Tracker RPC (no api/rpc proxy). EVM via api/cron/evm-balance.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const MAX_USERS = 100;
const RPC_RETRY_MAX = 4;
const RPC_RETRY_DELAYS_MS = [2000, 4000, 6000, 8000];
const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const DEFAULT_ETH_PRICE = 3000;
const DEFAULT_BNB_PRICE = 600;

function isUserPublic(data: { isPublic?: boolean }): boolean {
  return data.isPublic !== false;
}

function getRpcUrl(): string {
  const key =
    process.env.SOLANATRACKER_RPC_API_KEY ?? process.env.SOLANATRACKER_API_KEY;
  if (key) {
    return `https://rpc-mainnet.solanatracker.io/?api_key=${key}`;
  }
  const url = process.env.SOLANA_RPC_URL;
  if (url) return url;
  return "https://api.mainnet-beta.solana.com";
}

async function rpcRequest<T>(method: string, params: unknown[]): Promise<T> {
  const url = getRpcUrl();
  const body = { jsonrpc: "2.0", id: 1, method, params };
  for (let attempt = 0; attempt <= RPC_RETRY_MAX; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { result?: T; error?: { message: string } };
    if (res.ok && !data.error) return data.result as T;
    const isRetryable = res.status === 429 || res.status === 502;
    if (!isRetryable || attempt === RPC_RETRY_MAX) {
      throw new Error(data?.error?.message ?? `RPC error: ${res.status}`);
    }
    await new Promise((r) => setTimeout(r, RPC_RETRY_DELAYS_MS[attempt]));
  }
  throw new Error("RPC request failed");
}

type TokenAmount = {
  uiAmount?: number;
  uiAmountString?: string;
  amount?: string;
  decimals?: number;
};
async function getUsdcBalanceServer(walletAddress: string): Promise<number> {
  const result = await rpcRequest<{
    value?: Array<{ account?: { data?: { parsed?: { info?: { tokenAmount?: TokenAmount } } } } }>;
  }>("getTokenAccountsByOwner", [
    walletAddress,
    { mint: SOLANA_USDC_MINT },
    { encoding: "jsonParsed" },
  ]);
  let total = 0;
  const value = result?.value ?? [];
  for (const item of value) {
    const parsed = item?.account?.data?.parsed?.info?.tokenAmount;
    if (!parsed) continue;
    let uiAmount = parsed.uiAmount ?? 0;
    if (uiAmount === 0 && parsed.uiAmountString != null) {
      const n = parseFloat(parsed.uiAmountString);
      if (Number.isFinite(n)) uiAmount = n;
    }
    if (uiAmount === 0 && parsed.amount != null && parsed.decimals != null) {
      uiAmount = Number(parsed.amount) / Math.pow(10, parsed.decimals);
    }
    total += uiAmount;
  }
  return total;
}

async function getSolBalanceServer(walletAddress: string): Promise<number> {
  const result = await rpcRequest<{ context?: unknown; value?: number }>("getBalance", [walletAddress]);
  const lamports = typeof result?.value === "number" ? result.value : 0;
  return Number.isFinite(lamports) ? lamports / 1e9 : 0;
}

async function fetchWithRetry(
  url: string,
  options: RequestInit & { retries?: number } = {},
): Promise<Response> {
  const { retries = RPC_RETRY_MAX, ...init } = options;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, init);
    if (res.status !== 429 && res.status !== 502) return res;
    if (attempt === retries) return res;
    await new Promise((r) => setTimeout(r, RPC_RETRY_DELAYS_MS[attempt]));
  }
  throw new Error("fetchWithRetry failed");
}

function evmBalanceUsd(
  evmData: {
    base?: { usdc?: number; native?: number };
    bnb?: { usdc?: number; native?: number };
    tokens?: Array<{ value?: number }>;
  } | null,
  prices: { eth: number; bnb: number },
): number {
  if (!evmData) return 0;
  if (Array.isArray(evmData.tokens) && evmData.tokens.length > 0) {
    return evmData.tokens.reduce((s, t) => s + (t?.value ?? 0), 0);
  }
  const b = evmData.base ?? { usdc: 0, native: 0 };
  const n = evmData.bnb ?? { usdc: 0, native: 0 };
  return (
    (b.usdc ?? 0) +
    (b.native ?? 0) * prices.eth +
    (n.usdc ?? 0) +
    (n.native ?? 0) * prices.bnb
  );
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

  if (getApps().length === 0) {
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
      res.status(503).json({ error: "Firebase admin not configured" });
      return;
    }

    initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
    });
  }

  const db = getFirestore();
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "";

  try {
    const usersSnap = await db
      .collection("users")
      .where("walletAddress", "!=", null)
      .limit(MAX_USERS)
      .get();

    const users = usersSnap.docs
      .filter((d) => {
        const data = d.data();
        return data.walletAddress && isUserPublic(data);
      })
      .map((d) => ({
        uid: d.id,
        walletAddress: d.data().walletAddress as string,
      }));

    // One-time fetch for shared data (with retries)
    let solPrice = 0;
    let nativePrices = { eth: DEFAULT_ETH_PRICE, bnb: DEFAULT_BNB_PRICE };
    if (baseUrl) {
      try {
        const [solRes, cgRes] = await Promise.all([
          fetchWithRetry(
            `${baseUrl}/api/jupiter/price/v3?ids=${SOL_MINT}`,
            { retries: 3 },
          ),
          fetchWithRetry(`${baseUrl}/api/relay/coingecko-native-prices`, {
            retries: 3,
          }),
        ]);
        if (solRes.ok) {
          const solData = await solRes.json().catch(() => ({}));
          const solEntry = solData[SOL_MINT];
          if (solEntry?.usdPrice != null) solPrice = solEntry.usdPrice;
        }
        if (cgRes.ok) {
          const cg = await cgRes.json().catch(() => ({}));
          nativePrices = {
            eth: typeof cg.eth === "number" ? cg.eth : DEFAULT_ETH_PRICE,
            bnb: typeof cg.bnb === "number" ? cg.bnb : DEFAULT_BNB_PRICE,
          };
        }
      } catch (e) {
        console.warn("[cron/log-balance] shared fetch failed:", e);
      }
    }

    let written = 0;
    for (const { uid, walletAddress } of users) {
      try {
        const [usdc, solBal, positionsRes, evmRes] = await Promise.all([
          getUsdcBalanceServer(walletAddress).catch(() => null),
          getSolBalanceServer(walletAddress).catch(() => null),
          baseUrl
            ? fetchWithRetry(
                `${baseUrl}/api/solanatracker/wallet/${walletAddress}`,
                { retries: 3 },
              )
                .then((r) => r.json().catch(() => null))
                .catch(() => null)
            : Promise.resolve(null),
          baseUrl && cronSecret
            ? fetchWithRetry(
                `${baseUrl}/api/cron/evm-balance?uid=${encodeURIComponent(uid)}`,
                {
                  headers: { Authorization: `Bearer ${cronSecret}` },
                  retries: 2,
                },
              )
                .then((r) => (r.ok ? r.json().catch(() => null) : null))
                .catch(() => null)
            : Promise.resolve(null),
        ]);

        if (
          usdc == null ||
          solBal == null ||
          (baseUrl && positionsRes == null)
        ) {
          continue;
        }

        const tokens =
          (positionsRes as { tokens?: Array<{ token?: { mint?: string; symbol?: string }; value?: number }> })
            ?.tokens ?? [];
        let splVal = 0;
        for (const t of tokens) {
          const mint = t.token?.mint;
          const symbol = (t.token?.symbol ?? "").toUpperCase();
          if (
            mint === SOL_MINT ||
            mint === SOLANA_USDC_MINT ||
            symbol === "SOL"
          )
            continue;
          splVal += t.value ?? 0;
        }
        const solVal = (solBal ?? 0) * (solPrice ?? 0);
        const evmVal = evmBalanceUsd(evmRes, nativePrices);
        const total = usdc + solVal + evmVal + splVal;

        const userRef = db.collection("users").doc(uid);
        const userSnap = await userRef.get();
        const userData = userSnap.data();
        const existingCurrent = userData?.balanceCurrent ?? 0;
        const existingCurrentAt = (userData?.balanceCurrentAt as { toMillis?: () => number })?.toMillis?.() ?? 0;

        await userRef.set(
          {
            balancePrev: existingCurrent,
            balancePrevAt: existingCurrentAt > 0 ? userData?.balanceCurrentAt : FieldValue.serverTimestamp(),
            balanceCurrent: total,
            balanceCurrentAt: FieldValue.serverTimestamp(),
            balanceUpdatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        written++;
      } catch (e) {
        console.warn(`[cron/log-balance] skip user ${uid}:`, e);
      }
      if (users.length > 10) {
        await new Promise((r) => setTimeout(r, 80));
      }
    }

    res.status(200).json({
      ok: true,
      users: users.length,
      written,
    });
  } catch (err) {
    console.error("[cron/log-balance]", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Log balance failed",
    });
  }
}
