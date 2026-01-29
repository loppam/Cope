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

/**
 * Fetch token price from SolanaTracker API
 */
async function getTokenPrice(mint: string): Promise<number> {
  // Check cache first
  const cached = priceCache.get(mint);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.price;
  }

  try {
    const apiKey =
      process.env.VITE_SOLANATRACKER_API_KEY ||
      process.env.SOLANATRACKER_API_KEY;
    if (!apiKey) {
      console.warn(
        "SolanaTracker API key not configured, using fallback price",
      );
      return 0;
    }

    const response = await fetch(
      `https://data.solanatracker.io/tokens/${mint}`,
      {
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      console.warn(
        `Failed to fetch token price for ${mint}: ${response.status}`,
      );
      return 0;
    }

    const data = await response.json();
    // Get price from primary pool (highest liquidity)
    const pools = data.pools || [];
    if (pools.length > 0) {
      const primaryPool = pools.reduce((best: any, current: any) => {
        const bestLiquidity = best?.liquidity?.usd || 0;
        const currentLiquidity = current?.liquidity?.usd || 0;
        return currentLiquidity > bestLiquidity ? current : best;
      });

      const price = primaryPool?.price?.usd || 0;
      // Cache the price
      priceCache.set(mint, { price, timestamp: Date.now() });
      return price;
    }

    return 0;
  } catch (error) {
    console.error(`Error fetching token price for ${mint}:`, error);
    return 0;
  }
}

/**
 * Fetch SOL price from SolanaTracker API
 */
async function getSolPrice(): Promise<number> {
  // Check cache first
  const cached = priceCache.get("SOL");
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.price;
  }

  try {
    const apiKey =
      process.env.VITE_SOLANATRACKER_API_KEY ||
      process.env.SOLANATRACKER_API_KEY;
    if (!apiKey) {
      console.warn(
        "SolanaTracker API key not configured, using fallback SOL price",
      );
      return 150; // Fallback price
    }

    const response = await fetch("https://data.solanatracker.io/price", {
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.warn(`Failed to fetch SOL price: ${response.status}`);
      return 150; // Fallback price
    }

    const data = await response.json();
    const price = data.price || 150;

    // Cache the price
    priceCache.set("SOL", { price, timestamp: Date.now() });
    return price;
  } catch (error) {
    console.error("Error fetching SOL price:", error);
    return 150; // Fallback price
  }
}

/**
 * Fetch token symbol/name from SolanaTracker for notification text.
 */
async function getTokenSymbol(mint: string): Promise<string> {
  const cached = tokenSymbolCache.get(mint);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.symbol;
  }
  try {
    const apiKey =
      process.env.VITE_SOLANATRACKER_API_KEY ||
      process.env.SOLANATRACKER_API_KEY;
    if (!apiKey) return `${mint.slice(0, 4)}...${mint.slice(-4)}`;
    const response = await fetch(
      `https://data.solanatracker.io/tokens/${mint}`,
      {
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
        },
      },
    );
    if (!response.ok) return `${mint.slice(0, 4)}...${mint.slice(-4)}`;
    const data = await response.json();
    const symbol =
      data.token?.symbol ||
      data.token?.name ||
      `${mint.slice(0, 4)}...${mint.slice(-4)}`;
    tokenSymbolCache.set(mint, { symbol, timestamp: Date.now() });
    return symbol;
  } catch (error) {
    console.error(`Error fetching token symbol for ${mint}:`, error);
    return `${mint.slice(0, 4)}...${mint.slice(-4)}`;
  }
}

interface HeliusWebhookPayload {
  accountData: Array<{
    account: string;
    nativeBalanceChange?: number;
    tokenBalanceChanges?: Array<{
      mint: string;
      rawTokenAmount: {
        tokenAmount: string;
      };
      tokenAccount: string;
    }>;
  }>;
  description: string;
  fee: number;
  feePayer: string;
  instructions: Array<any>;
  nativeTransfers: Array<{
    amount: number;
    fromUserAccount: string;
    toUserAccount: string;
  }>;
  signature: string;
  slot: number;
  source: string;
  timestamp: number;
  tokenTransfers: Array<{
    fromTokenAccount?: string;
    fromUserAccount?: string;
    mint: string;
    toTokenAccount?: string;
    toUserAccount?: string;
    tokenAmount: number;
    tokenStandard: string;
  }>;
  type: string;
  webhookId?: string; // Optional; not in all Helius enhanced payload docs
}

/**
 * Pick the primary token for the notification (non–wrapped-SOL first, then by amount).
 * Swaps often list wSOL first; we want the actual token in the alert/deep link.
 */
function getPrimaryTokenMint(tx: HeliusWebhookPayload): string | undefined {
  const tokenTransfers = tx.tokenTransfers || [];
  const nonWsol = tokenTransfers.filter((t) => t.mint !== WRAPPED_SOL_MINT);
  const candidates = nonWsol.length > 0 ? nonWsol : tokenTransfers;
  if (candidates.length === 0) return undefined;
  // Prefer largest tokenAmount so the "main" token of the swap is shown
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

    for (const tx of transactions) {
      // Extract wallet addresses from the transaction
      const walletAddresses = new Set<string>();

      // Add fee payer
      if (tx.feePayer) {
        walletAddresses.add(tx.feePayer);
      }

      // Add native transfer participants
      tx.nativeTransfers?.forEach((transfer) => {
        walletAddresses.add(transfer.fromUserAccount);
        walletAddresses.add(transfer.toUserAccount);
      });

      // Add token transfer participants
      tx.tokenTransfers?.forEach((transfer) => {
        if (transfer.fromUserAccount)
          walletAddresses.add(transfer.fromUserAccount);
        if (transfer.toUserAccount) walletAddresses.add(transfer.toUserAccount);
      });
      // Omit accountData – often token/account addresses, not owners; reduces duplicate notifications

      // Collect unique users to notify (one notification per user per tx)
      const notifiedUserIds = new Set<string>();

      // For each wallet address, find users watching it (per-user, not platform-wide)
      for (const walletAddress of walletAddresses) {
        // Prefer reverse index: watchedWallets/{walletAddress} -> { watchers: { [uid]: { nickname? } } }
        const watchedDoc = await db
          .collection("watchedWallets")
          .doc(walletAddress)
          .get();
        const watchersMap = watchedDoc.exists
          ? (watchedDoc.data()?.watchers as Record<
              string,
              { nickname?: string }
            >) || {}
          : null;

        let usersWithWallet: Array<{ id: string; data: () => any }>;
        if (watchersMap && Object.keys(watchersMap).length > 0) {
          // Use reverse index: only fetch user docs for watchers
          const userIds = Object.keys(watchersMap);
          usersWithWallet = await Promise.all(
            userIds.map(async (uid) => {
              const userSnap = await db.collection("users").doc(uid).get();
              return userSnap.exists
                ? { id: userSnap.id, data: () => userSnap.data() }
                : null;
            }),
          ).then(
            (arr) =>
              arr.filter(Boolean) as Array<{ id: string; data: () => any }>,
          );
        } else {
          // Fallback: no index yet (legacy), scan all users
          const allUsersSnapshot = await db.collection("users").get();
          usersWithWallet = allUsersSnapshot.docs
            .filter((doc) => {
              const userData = doc.data();
              const watchlist = userData.watchlist || [];
              return watchlist.some((w: any) => w.address === walletAddress);
            })
            .map((doc) => ({ id: doc.id, data: () => doc.data() }));
        }

        // Create notifications for each user watching this wallet (per-user, not platform-wide)
        for (const userDoc of usersWithWallet) {
          const userId = userDoc.id;
          const userData = userDoc.data();
          const watchlist = userData?.watchlist || [];
          const watchedWallet = watchlist.find(
            (w: any) => w.address === walletAddress,
          );
          const nickname =
            (watchersMap && watchersMap[userId]?.nickname) ||
            watchedWallet?.nickname;

          const alreadyNotified = notifiedUserIds.has(userId);
          if (!alreadyNotified) notifiedUserIds.add(userId);

          if (!alreadyNotified) {
            // One notification per user per transaction
            const tokenTransfers = tx.tokenTransfers || [];
            const nativeTransfers = tx.nativeTransfers || [];
            const hasTokenTransfer = tokenTransfers.length > 0;
            const hasNativeTransfer = nativeTransfers.length > 0;

            // Calculate total USD value using dynamic prices
            let amountUsd = 0;

            if (hasTokenTransfer) {
              // Fetch prices for all tokens in parallel
              const tokenPricePromises = tokenTransfers.map(
                async (transfer) => {
                  const tokenPrice = await getTokenPrice(transfer.mint);
                  // tokenAmount is in raw units, we need to convert to USD
                  // For now, we'll use a simplified calculation
                  // In production, you'd need to account for token decimals
                  return tokenPrice * (transfer.tokenAmount || 0);
                },
              );

              const tokenAmounts = await Promise.all(tokenPricePromises);
              amountUsd += tokenAmounts.reduce(
                (sum, amount) => sum + amount,
                0,
              );
            }

            if (hasNativeTransfer) {
              // Fetch SOL price dynamically
              const solPrice = await getSolPrice();
              const solAmount =
                nativeTransfers.reduce((sum, t) => sum + t.amount, 0) / 1e9;
              amountUsd += solAmount * solPrice;
            }

            // Determine if it's a large trade (>$10,000)
            const isLargeTrade = amountUsd > 10000;
            const notificationType = isLargeTrade
              ? "large_trade"
              : hasTokenTransfer
                ? "token_swap"
                : "transaction";

            // Primary token for alert: prefer non–wrapped-SOL so alerts show the actual token, not wSOL
            const tokenAddress = getPrimaryTokenMint(tx) ?? undefined;
            const primaryTransfer = hasTokenTransfer
              ? tokenTransfers.find((t) => t.mint === tokenAddress) ||
                tokenTransfers[0]
              : null;

            // Buy vs sell: watched wallet received token -> buy, sent -> sell
            const isBuy =
              hasTokenTransfer &&
              primaryTransfer &&
              primaryTransfer.toUserAccount === walletAddress;
            const isSell =
              hasTokenTransfer &&
              primaryTransfer &&
              primaryTransfer.fromUserAccount === walletAddress;

            const tokenSymbol = tokenAddress
              ? await getTokenSymbol(tokenAddress)
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
            const displayName =
              nickname ||
              `Wallet ${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`;

            let notificationTitle: string;
            let notificationMessage: string;
            if (hasTokenTransfer && (isBuy || isSell)) {
              notificationTitle = isBuy
                ? "Buy Transaction"
                : "Sell Transaction";
              notificationMessage = isBuy
                ? `${displayName} bought ${amountUsdFormatted} of ${tokenSymbol}`
                : `${displayName} sold ${amountUsdFormatted} of ${tokenSymbol}`;
            } else if (hasTokenTransfer) {
              notificationTitle = "Token Swap";
              notificationMessage = `${displayName} swapped ${amountUsdFormatted} (${tokenSymbol})`;
            } else {
              notificationTitle = "Transaction";
              notificationMessage = `${displayName} had a transaction (${amountUsdFormatted})`;
            }

            // Create notification
            const notificationRef = db.collection("notifications").doc();
            const notificationData = {
              userId,
              walletAddress,
              type: notificationType,
              title: notificationTitle,
              message: notificationMessage,
              txHash: tx.signature,
              tokenAddress,
              amount:
                primaryTransfer?.tokenAmount ?? nativeTransfers[0]?.amount,
              amountUsd,
              read: false,
              createdAt: new Date(),
            };

            await notificationRef.set(notificationData);

            // Push notification
            try {
              const tokens = await getUserTokens(userId);
              const invalidTokens = await sendToTokens(tokens, {
                title: notificationData.title,
                body: notificationData.message,
                deepLink:
                  hasTokenTransfer && tokenAddress
                    ? `/token/${tokenAddress}`
                    : `/scanner/wallet/${walletAddress}`,
                data: {
                  type: notificationData.type,
                  txHash: notificationData.txHash || "",
                },
              });
              // Remove invalid tokens (doc ID is hash of token)
              for (const token of invalidTokens) {
                await db
                  .collection("users")
                  .doc(userId)
                  .collection("pushTokens")
                  .doc(pushTokenDocId(token))
                  .delete();
              }
            } catch (pushError) {
              console.error("Error sending push notification:", pushError);
            }
          }

          // Update last checked timestamp for the wallet in user's watchlist
          const updatedWatchlist = (userData?.watchlist || []).map((w: any) =>
            w.address === walletAddress
              ? {
                  ...w,
                  lastCheckedAt: new Date(),
                  lastTransactionHash: tx.signature,
                }
              : w,
          );

          await db.collection("users").doc(userId).update({
            watchlist: updatedWatchlist,
            updatedAt: new Date(),
          });
        }
      }
    }

    return res
      .status(200)
      .json({ success: true, processed: transactions.length });
  } catch (error: any) {
    console.error("Webhook processing error:", error);
    return res
      .status(500)
      .json({ error: error.message || "Internal server error" });
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
