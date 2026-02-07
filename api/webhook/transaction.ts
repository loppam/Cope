// Vercel Serverless Function: Webhook endpoint for Helius transaction notifications
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash } from "crypto";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import webpush from "web-push";

function pushTokenDocId(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Initialize Firebase Admin (only once)
if (getApps().length === 0) {
  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  let projectId: string | undefined;
  let clientEmail: string | undefined;
  let privateKey: string | undefined;

  if (rawServiceAccount) {
    const serviceAccount = JSON.parse(rawServiceAccount);
    projectId = serviceAccount.project_id;
    clientEmail = serviceAccount.client_email;
    privateKey = serviceAccount.private_key?.replace(/\\n/g, "\n");
  }

  projectId = projectId || process.env.FIREBASE_ADMIN_PROJECT_ID;
  clientEmail = clientEmail || process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  if (!privateKey && process.env.FIREBASE_ADMIN_PRIVATE_KEY) {
    privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n");
  }

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase admin credentials are not fully configured");
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
const adminMessaging = getMessaging();

// Wrapped SOL mint – exclude from "primary token" so alerts link to the actual token, not wSOL
const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";

// Price cache (in-memory, resets on function restart)
const priceCache = new Map<string, { price: number; timestamp: number }>();
const tokenSymbolCache = new Map<
  string,
  { symbol: string; timestamp: number }
>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

const JUPITER_API_BASE = "https://api.jup.ag";

/** Jupiter Price API v3 response entry */
interface JupiterPriceData {
  usdPrice: number;
  blockId?: number;
  decimals?: number;
  priceChange24h?: number;
}

/** Fetch with one retry on 429 (rate limit). */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 1,
): Promise<Response> {
  let lastRes: Response | null = null;
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url, options);
    lastRes = res;
    if (res.status === 429 && i < retries) {
      const retryAfter = res.headers.get("Retry-After");
      const delayMs = retryAfter
        ? Math.min(parseInt(retryAfter, 10) * 1000, 10000)
        : 2000;
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }
    return res;
  }
  return lastRes!;
}

/**
 * Fetch token price(s) from Jupiter Price API v3
 * https://api.jup.ag/price/v3?ids=<mint>
 */
async function getJupiterPrices(
  mints: string[],
): Promise<Record<string, number>> {
  if (mints.length === 0) return {};
  const apiKey =
    process.env.VITE_JUPITER_API_KEY || process.env.JUPITER_API_KEY;
  if (!apiKey) {
    console.warn("Jupiter API key not configured, using fallback prices");
    return {};
  }
  const ids = [...new Set(mints)].join(",");
  const url = `${JUPITER_API_BASE}/price/v3?ids=${encodeURIComponent(ids)}`;
  try {
    const response = await fetchWithRetry(url, {
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
    });
    if (!response.ok) {
      console.warn(`Jupiter price API error: ${response.status}`);
      return {};
    }
    const data = (await response.json()) as Record<string, JupiterPriceData>;
    const out: Record<string, number> = {};
    for (const mint of mints) {
      const entry = data[mint];
      out[mint] =
        entry && typeof entry.usdPrice === "number" ? entry.usdPrice : 0;
    }
    return out;
  } catch (error) {
    console.error("Error fetching Jupiter prices:", error);
    return {};
  }
}

const PRICES_COLLECTION = "prices";
const SOL_PRICE_DOC_ID = "SOL";

/**
 * Fetch SOL price: Firestore cache (5 min) shared across invocations, then Jupiter /price/v3.
 */
async function getSolPrice(): Promise<number> {
  const cached = priceCache.get("SOL");
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.price;
  }

  try {
    const priceRef = db.collection(PRICES_COLLECTION).doc(SOL_PRICE_DOC_ID);
    const priceSnap = await priceRef.get();
    if (priceSnap.exists) {
      const data = priceSnap.data();
      const updatedAt = data?.updatedAt as number | undefined;
      const price = data?.price as number | undefined;
      if (
        typeof price === "number" &&
        typeof updatedAt === "number" &&
        Date.now() - updatedAt < CACHE_DURATION
      ) {
        priceCache.set("SOL", { price, timestamp: updatedAt });
        return price;
      }
    }

    const prices = await getJupiterPrices([WRAPPED_SOL_MINT]);
    const price = prices[WRAPPED_SOL_MINT] ?? 150;
    const now = Date.now();
    await priceRef.set({ price, updatedAt: now }, { merge: true });
    priceCache.set("SOL", { price, timestamp: now });
    return price;
  } catch (error) {
    console.error("Error fetching SOL price:", error);
    return 150; // Fallback price
  }
}

/**
 * Fetch token symbol/name from Helius DAS getAsset for notification text.
 * Replaces SolanaTracker /tokens/:mint to use the same Helius API key as the webhook.
 */
async function getTokenSymbol(mint: string): Promise<string> {
  const cached = tokenSymbolCache.get(mint);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.symbol;
  }
  const fallback = `${mint.slice(0, 4)}...${mint.slice(-4)}`;
  try {
    const apiKey =
      process.env.HELIUS_API_KEY || process.env.VITE_HELIUS_API_KEY;
    if (!apiKey) return fallback;
    const response = await fetchWithRetry(
      `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "1",
          method: "getAsset",
          params: {
            id: mint,
            options: {
              showUnverifiedCollections: false,
              showCollectionMetadata: false,
              showFungible: false,
              showInscription: false,
            },
          },
        }),
      },
    );
    if (!response.ok) return fallback;
    const data = (await response.json()) as {
      result?: {
        content?: { metadata?: { symbol?: string; name?: string } };
        mint_extensions?: { metadata?: { symbol?: string; name?: string } };
      };
    };
    const r = data?.result;
    const symbol =
      r?.content?.metadata?.symbol ??
      r?.content?.metadata?.name ??
      r?.mint_extensions?.metadata?.symbol ??
      r?.mint_extensions?.metadata?.name ??
      fallback;
    tokenSymbolCache.set(mint, { symbol, timestamp: Date.now() });
    return symbol;
  } catch (error) {
    console.error(`Error fetching token symbol for ${mint}:`, error);
    return fallback;
  }
}

interface HeliusWebhookPayload {
  accountData: Array<{
    account: string;
    nativeBalanceChange?: number;
    tokenBalanceChanges?: Array<{
      mint: string;
      rawTokenAmount: {
        decimals?: number;
        tokenAmount: string;
      };
      tokenAccount: string;
      userAccount?: string;
    }>;
  }>;
  description?: string;
  fee: number;
  feePayer: string;
  instructions?: Array<any>;
  nativeTransfers?: Array<{
    amount: number;
    fromUserAccount: string;
    toUserAccount: string;
  }>;
  signature: string;
  slot: number;
  source?: string;
  timestamp: number;
  tokenTransfers?: Array<{
    fromTokenAccount?: string;
    fromUserAccount?: string;
    mint: string;
    toTokenAccount?: string;
    toUserAccount?: string;
    tokenAmount: number;
    tokenStandard?: string;
  }>;
  type: string; // "BUY" | "SELL" in enhanced payload
  webhookId?: string;
  events?: {
    swap?: {
      tokenInputs: Array<{ mint: string; amount: string }>;
      tokenOutputs: Array<{ mint: string; amount: string }>;
    };
  };
}

/**
 * For SWAP txs: infer buy (SOL → token) vs sell (token → SOL) from events.swap.
 * Buy = non-wSOL in tokenOutputs; Sell = non-wSOL in tokenInputs.
 */
function getEffectiveSwapDirection(
  tx: HeliusWebhookPayload,
): "BUY" | "SELL" | "SWAP" {
  if (tx.type !== "SWAP") return tx.type as "BUY" | "SELL" | "SWAP";
  const swap = tx.events?.swap;
  if (!swap) return "SWAP";
  const outputsHaveToken = (swap.tokenOutputs || []).some(
    (t) => t.mint !== WRAPPED_SOL_MINT,
  );
  const inputsHaveToken = (swap.tokenInputs || []).some(
    (t) => t.mint !== WRAPPED_SOL_MINT,
  );
  if (outputsHaveToken) return "BUY"; // received token (spent SOL)
  if (inputsHaveToken) return "SELL"; // sent token (received SOL)
  return "SWAP";
}

/**
 * Primary token from enhanced payload:
 * BUY = token received (tokenOutputs, non-wSOL); SELL = token sold (tokenInputs, non-wSOL);
 * SWAP = first non-wSOL from tokenOutputs or tokenInputs.
 */
function getPrimaryTokenFromEvents(
  tx: HeliusWebhookPayload,
): string | undefined {
  const swap = tx.events?.swap;
  if (!swap) return undefined;
  if (tx.type === "BUY") {
    const nonWsol = (swap.tokenOutputs || []).filter(
      (t) => t.mint !== WRAPPED_SOL_MINT,
    );
    return nonWsol[0]?.mint ?? swap.tokenOutputs?.[0]?.mint;
  }
  if (tx.type === "SELL") {
    const nonWsol = (swap.tokenInputs || []).filter(
      (t) => t.mint !== WRAPPED_SOL_MINT,
    );
    return nonWsol[0]?.mint ?? swap.tokenInputs?.[0]?.mint;
  }
  if (tx.type === "SWAP") {
    const fromOutputs = (swap.tokenOutputs || []).filter(
      (t) => t.mint !== WRAPPED_SOL_MINT,
    );
    if (fromOutputs[0]) return fromOutputs[0].mint;
    const fromInputs = (swap.tokenInputs || []).filter(
      (t) => t.mint !== WRAPPED_SOL_MINT,
    );
    return (
      fromInputs[0]?.mint ??
      swap.tokenInputs?.[0]?.mint ??
      swap.tokenOutputs?.[0]?.mint
    );
  }
  return undefined;
}

/**
 * Pick the primary token for the notification (non–wrapped-SOL first, then by amount).
 * Uses events.swap for BUY/SELL when present; else falls back to tokenTransfers.
 */
function getPrimaryTokenMint(tx: HeliusWebhookPayload): string | undefined {
  const fromEvents = getPrimaryTokenFromEvents(tx);
  if (fromEvents) return fromEvents;

  const tokenTransfers = tx.tokenTransfers || [];
  const nonWsol = tokenTransfers.filter((t) => t.mint !== WRAPPED_SOL_MINT);
  const candidates = nonWsol.length > 0 ? nonWsol : tokenTransfers;
  if (candidates.length === 0) return undefined;
  const byAmount = [...candidates].sort(
    (a, b) => Math.abs(b.tokenAmount || 0) - Math.abs(a.tokenAmount || 0),
  );
  return byAmount[0]?.mint;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Verify webhook auth: Helius echoes authHeader in the Authorization header
  const authHeader = req.headers.authorization;
  if (process.env.HELIUS_WEBHOOK_SECRET) {
    const secret = process.env.HELIUS_WEBHOOK_SECRET;
    const valid = authHeader === secret || authHeader === `Bearer ${secret}`;
    if (!valid) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  try {
    const payload = req.body as HeliusWebhookPayload[] | HeliusWebhookPayload;

    // Helius sends an array of transactions
    const transactions = Array.isArray(payload) ? payload : [payload];

    // Filter to SWAP only (Helius webhook subscribes to SWAP; buy/sell inferred from SOL↔token direction)
    const processableTx = transactions.filter((tx) => tx.type === "SWAP");
    const uniqueMints = [
      ...new Set(
        processableTx
          .map((tx) => getPrimaryTokenMint(tx))
          .filter((m): m is string => !!m),
      ),
    ];
    const symbolByMint = new Map<string, string>();
    await Promise.all(
      uniqueMints.map(async (mint) => {
        const symbol = await getTokenSymbol(mint);
        symbolByMint.set(mint, symbol);
      }),
    );

    // Actor-only: only the fee payer (transaction signer) is the wallet we notify for
    const actorAddresses = new Set(
      processableTx.map((tx) => tx.feePayer).filter((a): a is string => !!a),
    );

    // Batch read watchedWallets for actor addresses only (1 per tx, deduped)
    const watchedWalletsRef = db.collection("watchedWallets");
    const watchedSnaps =
      actorAddresses.size > 0
        ? await Promise.all(
            [...actorAddresses].map((addr) =>
              watchedWalletsRef.doc(addr).get(),
            ),
          )
        : [];
    const watchedByAddr = new Map<
      string,
      Record<string, { nickname?: string }>
    >();
    let idx = 0;
    for (const addr of actorAddresses) {
      const snap = watchedSnaps[idx++];
      if (snap?.exists) {
        const watchers =
          (snap.data()?.watchers as Record<string, { nickname?: string }>) ||
          {};
        if (Object.keys(watchers).length > 0) {
          watchedByAddr.set(addr, watchers);
        }
      }
    }

    // Created notifications (idempotency via create(); push tokens fetched only for these)
    interface CreatedNotification {
      userId: string;
      title: string;
      message: string;
      type: string;
      txHash: string;
      deepLink: string;
    }
    const createdNotifications: CreatedNotification[] = [];

    for (const tx of processableTx) {
      const actorWallet = tx.feePayer;
      if (!actorWallet) continue;

      const effectiveType = getEffectiveSwapDirection(tx);
      const isBuy = effectiveType === "BUY";
      const isSell = effectiveType === "SELL";
      const isSwap = effectiveType === "SWAP";

      // Compute price/symbol once per tx (Jupiter /price/v3, cached in-memory and Firestore for SOL).
      const tokenTransfers = tx.tokenTransfers || [];
      const nativeTransfers = tx.nativeTransfers || [];
      const hasTokenTransfer = tokenTransfers.length > 0;
      const hasNativeTransfer = nativeTransfers.length > 0;

      let amountUsd = 0;
      if (hasTokenTransfer) {
        const mints = tokenTransfers.map((t) => t.mint);
        const tokenPrices = await getJupiterPrices(mints);
        for (const transfer of tokenTransfers) {
          const price =
            priceCache.get(transfer.mint)?.price ??
            tokenPrices[transfer.mint] ??
            0;
          if (price > 0) {
            priceCache.set(transfer.mint, { price, timestamp: Date.now() });
          }
          amountUsd += price * (transfer.tokenAmount || 0);
        }
      }
      if (hasNativeTransfer) {
        const solPrice = await getSolPrice();
        const solAmount =
          nativeTransfers.reduce((sum, t) => sum + t.amount, 0) / 1e9;
        amountUsd += solAmount * solPrice;
      }

      // SWAP: use net SOL balance decrease (fee payer) as the swap amount in USD
      if (isSwap && tx.feePayer) {
        const feePayerEntry = tx.accountData?.find(
          (acc) => acc.account === tx.feePayer,
        );
        const nativeChange = feePayerEntry?.nativeBalanceChange;
        if (nativeChange != null && nativeChange < 0) {
          const netSolSpentLamports = Math.abs(nativeChange);
          const solPrice = await getSolPrice();
          const swapAmountUsd = (netSolSpentLamports / 1e9) * solPrice;
          amountUsd = swapAmountUsd;
        }
      }

      const notificationType =
        effectiveType === "BUY"
          ? "buy"
          : effectiveType === "SELL"
            ? "sell"
            : effectiveType === "SWAP"
              ? "swap"
              : "transaction";

      const tokenAddress = getPrimaryTokenMint(tx) ?? undefined;
      const primaryTransfer = hasTokenTransfer
        ? tokenTransfers.find((t) => t.mint === tokenAddress) ||
          tokenTransfers[0]
        : null;

      const tokenSymbol = tokenAddress
        ? (symbolByMint.get(tokenAddress) ?? "SOL")
        : "SOL";
      const amountUsdFormatted =
        amountUsd >= 1
          ? amountUsd.toLocaleString("en-US", {
              style: "currency",
              currency: "USD",
              minimumFractionDigits: 0,
              maximumFractionDigits: 0,
            })
          : amountUsd.toLocaleString("en-US", {
              style: "currency",
              currency: "USD",
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            });

      // Actor-only: notify users watching this tx's fee payer
      const watchersMap = watchedByAddr.get(actorWallet) || null;
      if (!watchersMap || Object.keys(watchersMap).length === 0) continue;

      const notifiedUserIds = new Set<string>();
      for (const uid of Object.keys(watchersMap)) {
        if (notifiedUserIds.has(uid)) continue;
        notifiedUserIds.add(uid);

        const nickname = watchersMap[uid]?.nickname;
        const displayName =
          nickname ||
          `Wallet ${actorWallet.slice(0, 4)}...${actorWallet.slice(-4)}`;

        let notificationTitle: string;
        let notificationMessage: string;
        if (isBuy) {
          notificationTitle = "Buy Transaction";
          notificationMessage = `${displayName} bought ${amountUsdFormatted} of ${tokenSymbol}`;
        } else if (isSell) {
          notificationTitle = "Sell Transaction";
          notificationMessage = `${displayName} sold ${amountUsdFormatted} of ${tokenSymbol}`;
        } else if (isSwap) {
          notificationTitle = "Swap Transaction";
          notificationMessage = `${displayName} swapped ${amountUsdFormatted} (${tokenSymbol})`;
        } else {
          notificationTitle = "Transaction";
          notificationMessage = `${displayName} had a transaction (${amountUsdFormatted})`;
        }

        const notificationId = createHash("sha256")
          .update(`${tx.signature}:${uid}`)
          .digest("hex");
        const notificationRef = db
          .collection("notifications")
          .doc(notificationId);

        const notificationData = {
          userId: uid,
          walletAddress: actorWallet,
          type: notificationType,
          title: notificationTitle,
          message: notificationMessage,
          txHash: tx.signature,
          tokenAddress: tokenAddress ?? null,
          amount:
            primaryTransfer?.tokenAmount ?? nativeTransfers[0]?.amount,
          amountUsd,
          read: false,
          createdAt: new Date(),
        };

        const deepLink =
          hasTokenTransfer && tokenAddress
            ? `/token/${tokenAddress}`
            : `/scanner/wallet/${actorWallet}`;

        try {
          await notificationRef.create(notificationData);
        } catch (err: any) {
          // Firestore code 6 = ALREADY_EXISTS; duplicate webhook/retry – skip
          if (err?.code === 6) continue;
          throw err;
        }

        createdNotifications.push({
          userId: uid,
          title: notificationTitle,
          message: notificationMessage,
          type: notificationType,
          txHash: tx.signature,
          deepLink,
        });
      }
    }

    // Fetch push tokens only for users we actually created a notification for
    const createdUserIds = [...new Set(createdNotifications.map((n) => n.userId))];
    const pushTokensByUid = new Map<string, PushToken[]>();
    await Promise.all(
      createdUserIds.map(async (uid) => {
        const tokens = await getUserTokens(uid);
        pushTokensByUid.set(uid, tokens);
      }),
    );

    for (const item of createdNotifications) {
      try {
        const tokens = pushTokensByUid.get(item.userId) ?? [];
        const pushPayload = {
          title: item.title,
          body: item.message,
          deepLink: item.deepLink,
          data: {
            type: item.type,
            txHash: item.txHash || "",
          },
        };
        const invalidTokens = await sendToTokens(tokens, pushPayload);
        for (const token of invalidTokens) {
          const docId = pushTokenDocId(token);
          await Promise.all([
            db
              .collection("users")
              .doc(item.userId)
              .collection("pushTokens")
              .doc(docId)
              .delete(),
            db.collection("pushTokenIndex").doc(docId).delete(),
          ]);
        }
      } catch (pushError) {
        console.error("Error sending push notification:", pushError);
      }
    }

    return res.status(200).json({
      success: true,
      processed: transactions.length,
    });
  } catch (error: any) {
    console.error("Webhook processing error:", error);
    const errorResponse = {
      error: error.message || "Internal server error",
    };
    console.log("[Webhook] Error response:", JSON.stringify(errorResponse));
    return res.status(500).json(errorResponse);
  }
}

interface PushToken {
  token: string;
  platform: string;
}

async function getUserTokens(uid: string): Promise<PushToken[]> {
  const snapshot = await db
    .collection("users")
    .doc(uid)
    .collection("pushTokens")
    .get();
  const tokens: PushToken[] = [];
  snapshot.forEach((doc) => {
    const data = doc.data();
    if (data.token) {
      tokens.push({
        token: data.token,
        platform: data.platform || "web",
      });
    }
  });
  return tokens;
}

function isWebPushSubscription(token: string): boolean {
  try {
    const parsed = JSON.parse(token);
    return (
      parsed &&
      typeof parsed === "object" &&
      parsed.endpoint &&
      parsed.keys &&
      parsed.keys.p256dh &&
      parsed.keys.auth
    );
  } catch {
    return false;
  }
}

function initWebPush() {
  const vapidPublicKey = process.env.VITE_FIREBASE_VAPID_KEY;
  const vapidPrivateKey = process.env.FIREBASE_VAPID_PRIVATE_KEY;

  if (!vapidPublicKey || !vapidPrivateKey) {
    console.warn("[Push] VAPID keys not configured for Web Push");
    return false;
  }

  webpush.setVapidDetails(
    "mailto:your-email@example.com", // Update with your contact email
    vapidPublicKey,
    vapidPrivateKey,
  );
  return true;
}

async function sendToTokens(
  tokens: PushToken[],
  payload: any,
): Promise<string[]> {
  if (!tokens.length) return [];

  const deepLink = payload.deepLink || "/app/alerts";
  const invalidTokens: string[] = [];

  // Separate FCM tokens and Web Push subscriptions
  const fcmTokens: string[] = [];
  const webPushSubscriptions: Array<{ token: string; subscription: any }> = [];

  for (const tokenData of tokens) {
    if (
      tokenData.platform === "webpush" ||
      isWebPushSubscription(tokenData.token)
    ) {
      try {
        const subscription = JSON.parse(tokenData.token);
        webPushSubscriptions.push({
          token: tokenData.token,
          subscription,
        });
      } catch (e) {
        console.error("[Push] Invalid Web Push subscription:", e);
        invalidTokens.push(tokenData.token);
      }
    } else {
      fcmTokens.push(tokenData.token);
    }
  }

  // Send FCM notifications
  if (fcmTokens.length > 0) {
    try {
      const data = { ...(payload.data || {}), deepLink };
      const response = await adminMessaging.sendEachForMulticast({
        tokens: fcmTokens,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data,
        webpush: {
          fcmOptions: {
            link: deepLink,
          },
        },
      });

      response.responses.forEach((resp, idx) => {
        if (
          !resp.success &&
          resp.error?.code === "messaging/registration-token-not-registered"
        ) {
          invalidTokens.push(fcmTokens[idx]);
        }
      });
    } catch (error) {
      console.error("[Push] FCM send error:", error);
      invalidTokens.push(...fcmTokens);
    }
  }

  // Send Web Push notifications
  if (webPushSubscriptions.length > 0) {
    if (!initWebPush()) {
      console.warn("[Push] Web Push not initialized, skipping Web Push tokens");
      invalidTokens.push(...webPushSubscriptions.map((s) => s.token));
    } else {
      const webPushPayload = JSON.stringify({
        title: payload.title,
        body: payload.body,
        data: { ...(payload.data || {}), deepLink },
        icon: "/icons/icon-192x192.png",
        badge: "/icons/icon-96x96.png",
      });

      await Promise.all(
        webPushSubscriptions.map(async ({ token, subscription }) => {
          try {
            await webpush.sendNotification(subscription, webPushPayload);
          } catch (error: any) {
            console.error("[Push] Web Push send error:", error);
            if (
              error.statusCode === 410 ||
              error.statusCode === 404 ||
              error.statusCode === 400
            ) {
              invalidTokens.push(token);
            }
          }
        }),
      );
    }
  }

  return invalidTokens;
}
