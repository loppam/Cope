// Single file for all webhook routes (Vercel counts each api/*.ts as a function).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash } from "crypto";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, type DocumentReference, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import webpush from "web-push";

function pushTokenDocId(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

if (getApps().length === 0) {
  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  let projectId: string | undefined;
  let clientEmail: string | undefined;
  let privateKey: string | undefined;
  if (rawServiceAccount) {
    const sa = JSON.parse(rawServiceAccount);
    projectId = sa.project_id;
    clientEmail = sa.client_email;
    privateKey = sa.private_key?.replace(/\\n/g, "\n");
  }
  projectId = projectId || process.env.FIREBASE_ADMIN_PROJECT_ID;
  clientEmail = clientEmail || process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  if (!privateKey && process.env.FIREBASE_ADMIN_PRIVATE_KEY) {
    privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n");
  }
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase admin credentials are not fully configured");
  }
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

const db = getFirestore();
const adminMessaging = getMessaging();

const HELIUS_API_URL = "https://api-mainnet.helius-rpc.com/v0/webhooks";
const WEBHOOK_TRANSACTION_TYPES = ["SWAP"] as const;

async function createHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
    const { accountAddresses, webhookId } = req.body;
    if (!accountAddresses || !Array.isArray(accountAddresses) || accountAddresses.length === 0) {
      return res.status(400).json({ error: "accountAddresses array is required" });
    }
    if (!HELIUS_API_KEY) return res.status(500).json({ error: "HELIUS_API_KEY not configured" });
    const webhookURL = process.env.WEBHOOK_URL || `${req.headers.origin || "https://your-domain.vercel.app"}/api/webhook/transaction`;
    if (webhookId) {
      const updateRes = await fetch(`${HELIUS_API_URL}/${webhookId}?api-key=${HELIUS_API_KEY}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookURL: process.env.WEBHOOK_URL || `${req.headers.origin || "https://your-domain.vercel.app"}/api/webhook/transaction`,
          transactionTypes: WEBHOOK_TRANSACTION_TYPES,
          accountAddresses,
          webhookType: "enhanced",
          ...(process.env.HELIUS_WEBHOOK_SECRET && { authHeader: process.env.HELIUS_WEBHOOK_SECRET }),
        }),
      });
      if (!updateRes.ok) throw new Error(`Failed to update webhook: ${await updateRes.text()}`);
      const data = await updateRes.json();
      return res.status(200).json({ success: true, webhookId: data.webhookID });
    }
    const createRes = await fetch(`${HELIUS_API_URL}?api-key=${HELIUS_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        webhookURL,
        transactionTypes: WEBHOOK_TRANSACTION_TYPES,
        accountAddresses,
        webhookType: "enhanced",
        ...(process.env.HELIUS_WEBHOOK_SECRET && { authHeader: process.env.HELIUS_WEBHOOK_SECRET }),
      }),
    });
    if (!createRes.ok) throw new Error(`Failed to create webhook: ${await createRes.text()}`);
    const data = await createRes.json();
    return res.status(200).json({ success: true, webhookId: data.webhookID });
  } catch (error: any) {
    console.error("Webhook creation error:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
}

function isUserPublic(data: { isPublic?: boolean }): boolean {
  return data.isPublic !== false;
}

async function syncHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const authHeader = req.headers.authorization;
  if (process.env.WEBHOOK_SYNC_SECRET && authHeader !== `Bearer ${process.env.WEBHOOK_SYNC_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
    const WEBHOOK_ID = process.env.HELIUS_WEBHOOK_ID;
    if (!HELIUS_API_KEY) {
      console.error("[webhook/sync] HELIUS_API_KEY not set");
      return res.status(500).json({ error: "HELIUS_API_KEY not configured" });
    }
    let usersSnapshot;
    try {
      usersSnapshot = await db.collection("users").get();
    } catch (dbError: any) {
      console.error("[webhook/sync] Firestore error:", dbError?.message || dbError);
      return res.status(500).json({ error: "Firestore error", message: dbError?.message || "Failed to read users" });
    }
    const userByUid = new Map<string, { walletAddress: string | null; isPublic: boolean }>();
    usersSnapshot.docs.forEach((doc: QueryDocumentSnapshot) => {
      const d = doc.data();
      userByUid.set(doc.id, { walletAddress: d.walletAddress || null, isPublic: isUserPublic(d) });
    });
    const addressToWatchers = new Map<string, Record<string, { nickname?: string; addedAt?: string }>>();
    for (const doc of usersSnapshot.docs) {
      const watcherUid = doc.id;
      const userData = doc.data();
      const watchlist: Array<{ address: string; uid?: string; onPlatform?: boolean; nickname?: string; addedAt?: unknown }> = userData.watchlist || [];
      for (const w of watchlist) {
        if (!w.address) continue;
        let effectiveAddress: string | null = null;
        if (w.onPlatform && w.uid) {
          const target = userByUid.get(w.uid);
          if (!target || !target.isPublic || !target.walletAddress) continue;
          effectiveAddress = target.walletAddress;
        } else {
          effectiveAddress = w.address;
        }
        if (!effectiveAddress) continue;
        const existing = addressToWatchers.get(effectiveAddress) || {};
        const addedAt = w.addedAt instanceof Date ? w.addedAt.toISOString() : typeof w.addedAt === "string" ? w.addedAt : new Date().toISOString();
        existing[watcherUid] = { nickname: w.nickname, addedAt };
        addressToWatchers.set(effectiveAddress, existing);
      }
    }
    const accountAddresses = Array.from(addressToWatchers.keys());
    const batch = db.batch();
    const followersMap = new Map<string, string[]>();
    const allTargetUids = new Set<string>();
    for (const doc of usersSnapshot.docs) {
      const watcherUid = doc.id;
      const userData = doc.data();
      const watchlist: Array<{ uid?: string; onPlatform?: boolean }> = userData.watchlist || [];
      for (const w of watchlist) {
        if (w.onPlatform && w.uid) {
          allTargetUids.add(w.uid);
          const target = userByUid.get(w.uid);
          if (target?.isPublic && target?.walletAddress) {
            const list = followersMap.get(w.uid) || [];
            if (!list.includes(watcherUid)) list.push(watcherUid);
            followersMap.set(w.uid, list);
          }
        }
      }
    }
    for (const targetUid of allTargetUids) {
      const ref = db.collection("followers").doc(targetUid);
      batch.set(ref, { followerUids: followersMap.get(targetUid) || [] }, { merge: true });
    }
    const allWatchedRefs = await db.collection("watchedWallets").get();
    const toDelete: DocumentReference[] = [];
    const toWrite = new Set<string>();
    for (const addr of accountAddresses) {
      toWrite.add(addr);
      batch.set(db.collection("watchedWallets").doc(addr), { watchers: addressToWatchers.get(addr)! }, { merge: true });
    }
    for (const doc of allWatchedRefs.docs) {
      if (!toWrite.has(doc.id)) toDelete.push(doc.ref);
    }
    for (const ref of toDelete) batch.delete(ref);
    await batch.commit();
    await db.collection("config").doc("webhookSync").set({ lastSyncAt: Date.now(), updatedAt: new Date() }, { merge: true });
    const webhookURL = process.env.WEBHOOK_URL || `${req.headers.origin || "https://your-domain.vercel.app"}/api/webhook/transaction`;
    if (WEBHOOK_ID) {
      const updateRes = await fetch(`${HELIUS_API_URL}/${WEBHOOK_ID}?api-key=${HELIUS_API_KEY}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          webhookURL: process.env.WEBHOOK_URL || `${req.headers.origin || "https://your-domain.vercel.app"}/api/webhook/transaction`,
          transactionTypes: WEBHOOK_TRANSACTION_TYPES,
          accountAddresses,
          webhookType: "enhanced",
          ...(process.env.HELIUS_WEBHOOK_SECRET && { authHeader: process.env.HELIUS_WEBHOOK_SECRET }),
        }),
      });
      if (!updateRes.ok) throw new Error(`Failed to update webhook: ${await updateRes.text()}`);
      const data = await updateRes.json();
      return res.status(200).json({ success: true, webhookId: data.webhookID, walletsMonitored: accountAddresses.length });
    }
    const createRes = await fetch(`${HELIUS_API_URL}?api-key=${HELIUS_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        webhookURL,
        transactionTypes: WEBHOOK_TRANSACTION_TYPES,
        accountAddresses,
        webhookType: "enhanced",
        ...(process.env.HELIUS_WEBHOOK_SECRET && { authHeader: process.env.HELIUS_WEBHOOK_SECRET }),
      }),
    });
    if (!createRes.ok) throw new Error(`Failed to create webhook: ${await createRes.text()}`);
    const data = await createRes.json();
    console.log(`New webhook created: ${data.webhookID}. Add this to HELIUS_WEBHOOK_ID in .env`);
    return res.status(200).json({ success: true, webhookId: data.webhookID, walletsMonitored: accountAddresses.length, message: "Add webhookId to HELIUS_WEBHOOK_ID in .env" });
  } catch (error: any) {
    console.error("[webhook/sync] Error:", error?.message || String(error), error?.stack);
    return res.status(500).json({ error: "Webhook sync failed", message: error?.message || String(error) });
  }
}

const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const priceCache = new Map<string, { price: number; timestamp: number }>();
const tokenSymbolCache = new Map<string, { symbol: string; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000;
const JUPITER_API_BASE = "https://api.jup.ag";

async function fetchWithRetry(url: string, options: RequestInit, retries = 1): Promise<Response> {
  let lastRes: Response | null = null;
  for (let i = 0; i <= retries; i++) {
    const res = await fetch(url, options);
    lastRes = res;
    if (res.status === 429 && i < retries) {
      const delayMs = 2000;
      await new Promise((r) => setTimeout(r, delayMs));
      continue;
    }
    return res;
  }
  return lastRes!;
}

async function getJupiterPrices(mints: string[]): Promise<Record<string, number>> {
  if (mints.length === 0) return {};
  const apiKey = process.env.VITE_JUPITER_API_KEY || process.env.JUPITER_API_KEY;
  if (!apiKey) return {};
  const url = `${JUPITER_API_BASE}/price/v3?ids=${encodeURIComponent([...new Set(mints)].join(","))}`;
  try {
    const response = await fetchWithRetry(url, { headers: { "x-api-key": apiKey, "Content-Type": "application/json" } });
    if (!response.ok) return {};
    const data = (await response.json()) as Record<string, { usdPrice?: number }>;
    const out: Record<string, number> = {};
    for (const mint of mints) {
      const entry = data[mint];
      out[mint] = entry && typeof entry.usdPrice === "number" ? entry.usdPrice : 0;
    }
    return out;
  } catch {
    return {};
  }
}

async function getSolPrice(): Promise<number> {
  const cached = priceCache.get("SOL");
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) return cached.price;
  try {
    const priceRef = db.collection("prices").doc("SOL");
    const priceSnap = await priceRef.get();
    if (priceSnap.exists) {
      const data = priceSnap.data();
      const updatedAt = data?.updatedAt as number | undefined;
      const price = data?.price as number | undefined;
      if (typeof price === "number" && typeof updatedAt === "number" && Date.now() - updatedAt < CACHE_DURATION) {
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
  } catch {
    return 150;
  }
}

async function getTokenSymbol(mint: string): Promise<string> {
  const cached = tokenSymbolCache.get(mint);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) return cached.symbol;
  const fallback = `${mint.slice(0, 4)}...${mint.slice(-4)}`;
  try {
    const apiKey = process.env.HELIUS_API_KEY || process.env.VITE_HELIUS_API_KEY;
    if (!apiKey) return fallback;
    const response = await fetchWithRetry(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "1", method: "getAsset", params: { id: mint, options: { showUnverifiedCollections: false, showCollectionMetadata: false, showFungible: false, showInscription: false } } }),
    });
    if (!response.ok) return fallback;
    const data = (await response.json()) as { result?: { content?: { metadata?: { symbol?: string; name?: string } }; mint_extensions?: { metadata?: { symbol?: string; name?: string } } } };
    const r = data?.result;
    const symbol = r?.content?.metadata?.symbol ?? r?.content?.metadata?.name ?? r?.mint_extensions?.metadata?.symbol ?? r?.mint_extensions?.metadata?.name ?? fallback;
    tokenSymbolCache.set(mint, { symbol, timestamp: Date.now() });
    return symbol;
  } catch {
    return fallback;
  }
}

interface HeliusWebhookPayload {
  accountData?: Array<{ account: string; nativeBalanceChange?: number }>;
  feePayer: string;
  nativeTransfers?: Array<{ amount: number }>;
  signature: string;
  tokenTransfers?: Array<{ mint: string; tokenAmount: number }>;
  type: string;
  events?: { swap?: { tokenInputs: Array<{ mint: string }>; tokenOutputs: Array<{ mint: string }> } };
}

function getEffectiveSwapDirection(tx: HeliusWebhookPayload): "BUY" | "SELL" | "SWAP" {
  if (tx.type !== "SWAP") return tx.type as "BUY" | "SELL" | "SWAP";
  const swap = tx.events?.swap;
  if (!swap) return "SWAP";
  if ((swap.tokenOutputs || []).some((t) => t.mint !== WRAPPED_SOL_MINT)) return "BUY";
  if ((swap.tokenInputs || []).some((t) => t.mint !== WRAPPED_SOL_MINT)) return "SELL";
  return "SWAP";
}

function getPrimaryTokenMint(tx: HeliusWebhookPayload): string | undefined {
  const swap = tx.events?.swap;
  if (swap) {
    if (tx.type === "BUY") return (swap.tokenOutputs || []).filter((t) => t.mint !== WRAPPED_SOL_MINT)[0]?.mint ?? swap.tokenOutputs?.[0]?.mint;
    if (tx.type === "SELL") return (swap.tokenInputs || []).filter((t) => t.mint !== WRAPPED_SOL_MINT)[0]?.mint ?? swap.tokenInputs?.[0]?.mint;
    const fromOut = (swap.tokenOutputs || []).filter((t) => t.mint !== WRAPPED_SOL_MINT)[0];
    if (fromOut) return fromOut.mint;
    return (swap.tokenInputs || [])[0]?.mint ?? (swap.tokenOutputs || [])[0]?.mint;
  }
  const tokenTransfers = tx.tokenTransfers || [];
  const nonWsol = tokenTransfers.filter((t) => t.mint !== WRAPPED_SOL_MINT);
  const candidates = nonWsol.length > 0 ? nonWsol : tokenTransfers;
  if (candidates.length === 0) return undefined;
  const byAmount = [...candidates].sort((a, b) => Math.abs(b.tokenAmount || 0) - Math.abs(a.tokenAmount || 0));
  return byAmount[0]?.mint;
}

interface PushToken { token: string; platform: string; }

async function getUserTokens(uid: string): Promise<PushToken[]> {
  const snapshot = await db.collection("users").doc(uid).collection("pushTokens").get();
  const tokens: PushToken[] = [];
  snapshot.forEach((doc: QueryDocumentSnapshot) => {
    const data = doc.data();
    if (data.token) tokens.push({ token: data.token, platform: data.platform || "web" });
  });
  return tokens;
}

function isWebPushSubscription(token: string): boolean {
  try {
    const parsed = JSON.parse(token);
    return !!(parsed && typeof parsed === "object" && parsed.endpoint && parsed.keys?.p256dh && parsed.keys?.auth);
  } catch {
    return false;
  }
}

function initWebPush(): boolean {
  const vapidPublicKey = process.env.VITE_FIREBASE_VAPID_KEY;
  const vapidPrivateKey = process.env.FIREBASE_VAPID_PRIVATE_KEY;
  if (!vapidPublicKey || !vapidPrivateKey) return false;
  try {
    webpush.setVapidDetails("mailto:your-email@example.com", vapidPublicKey, vapidPrivateKey);
    return true;
  } catch {
    return false;
  }
}

async function sendToTokens(tokens: PushToken[], payload: { title: string; body: string; deepLink?: string; data?: Record<string, string> }): Promise<string[]> {
  if (!tokens.length) return [];
  const deepLink = payload.deepLink || "/app/alerts";
  const invalidTokens: string[] = [];
  const fcmTokens: string[] = [];
  const webPushSubscriptions: Array<{ token: string; subscription: any }> = [];
  for (const tokenData of tokens) {
    if (tokenData.platform === "webpush" || isWebPushSubscription(tokenData.token)) {
      try {
        webPushSubscriptions.push({ token: tokenData.token, subscription: JSON.parse(tokenData.token) });
      } catch {
        invalidTokens.push(tokenData.token);
      }
    } else {
      fcmTokens.push(tokenData.token);
    }
  }
  if (fcmTokens.length > 0) {
    try {
      const response = await adminMessaging.sendEachForMulticast({
        tokens: fcmTokens,
        notification: { title: payload.title, body: payload.body },
        data: { ...(payload.data || {}), deepLink },
        webpush: { fcmOptions: { link: deepLink } },
      });
      response.responses.forEach((resp, idx) => {
        if (!resp.success && resp.error?.code === "messaging/registration-token-not-registered") invalidTokens.push(fcmTokens[idx]);
      });
    } catch {
      invalidTokens.push(...fcmTokens);
    }
  }
  if (webPushSubscriptions.length > 0) {
    if (!initWebPush()) {
      invalidTokens.push(...webPushSubscriptions.map((s) => s.token));
    } else {
      const webPushPayload = JSON.stringify({ title: payload.title, body: payload.body, data: { ...(payload.data || {}), deepLink }, icon: "/icons/icon-192x192.png", badge: "/icons/icon-96x96.png" });
      await Promise.all(
        webPushSubscriptions.map(async ({ token, subscription }) => {
          try {
            await webpush.sendNotification(subscription, webPushPayload);
          } catch (error: any) {
            if ([410, 404, 400].includes(error.statusCode)) invalidTokens.push(token);
          }
        })
      );
    }
  }
  return invalidTokens;
}

async function transactionHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (process.env.HELIUS_WEBHOOK_SECRET) {
    const authHeader = req.headers.authorization;
    const secret = process.env.HELIUS_WEBHOOK_SECRET;
    if (authHeader !== secret && authHeader !== `Bearer ${secret}`) return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const payload = req.body as HeliusWebhookPayload[] | HeliusWebhookPayload;
    const transactions = Array.isArray(payload) ? payload : [payload];
    const processableTx = transactions.filter((tx) => tx.type === "SWAP");
    const uniqueMints = [...new Set(processableTx.map((tx) => getPrimaryTokenMint(tx)).filter((m): m is string => !!m))];
    const symbolByMint = new Map<string, string>();
    await Promise.all(uniqueMints.map(async (mint) => { symbolByMint.set(mint, await getTokenSymbol(mint)); }));
    const actorAddresses = new Set(processableTx.map((tx) => tx.feePayer).filter((a): a is string => !!a));
    const watchedSnaps = actorAddresses.size > 0 ? await Promise.all([...actorAddresses].map((addr) => db.collection("watchedWallets").doc(addr).get())) : [];
    const watchedByAddr = new Map<string, Record<string, { nickname?: string }>>();
    let idx = 0;
    for (const addr of actorAddresses) {
      const snap = watchedSnaps[idx++];
      if (snap?.exists) {
        const watchers = (snap.data()?.watchers as Record<string, { nickname?: string }>) || {};
        if (Object.keys(watchers).length > 0) watchedByAddr.set(addr, watchers);
      }
    }
    const createdNotifications: Array<{ userId: string; title: string; message: string; type: string; txHash: string; deepLink: string }> = [];
    for (const tx of processableTx) {
      const actorWallet = tx.feePayer;
      if (!actorWallet) continue;
      const effectiveType = getEffectiveSwapDirection(tx);
      const isBuy = effectiveType === "BUY";
      const isSell = effectiveType === "SELL";
      const isSwap = effectiveType === "SWAP";
      const tokenTransfers = tx.tokenTransfers || [];
      const nativeTransfers = tx.nativeTransfers || [];
      let amountUsd = 0;
      if (tokenTransfers.length > 0) {
        const tokenPrices = await getJupiterPrices(tokenTransfers.map((t) => t.mint));
        for (const transfer of tokenTransfers) {
          const price = priceCache.get(transfer.mint)?.price ?? tokenPrices[transfer.mint] ?? 0;
          if (price > 0) priceCache.set(transfer.mint, { price, timestamp: Date.now() });
          amountUsd += price * (transfer.tokenAmount || 0);
        }
      }
      if (nativeTransfers.length > 0) {
        const solPrice = await getSolPrice();
        amountUsd += (nativeTransfers.reduce((sum, t) => sum + t.amount, 0) / 1e9) * solPrice;
      }
      if (isSwap && tx.feePayer && tx.accountData) {
        const feePayerEntry = tx.accountData.find((acc) => acc.account === tx.feePayer);
        const nativeChange = feePayerEntry?.nativeBalanceChange;
        if (nativeChange != null && nativeChange < 0) {
          amountUsd = (Math.abs(nativeChange) / 1e9) * (await getSolPrice());
        }
      }
      const notificationType = effectiveType === "BUY" ? "buy" : effectiveType === "SELL" ? "sell" : effectiveType === "SWAP" ? "swap" : "transaction";
      const tokenAddress = getPrimaryTokenMint(tx) ?? undefined;
      const primaryTransfer = tokenTransfers.length > 0 ? (tokenTransfers.find((t) => t.mint === tokenAddress) || tokenTransfers[0]) : null;
      const tokenSymbol = tokenAddress ? (symbolByMint.get(tokenAddress) ?? "SOL") : "SOL";
      const amountUsdFormatted = amountUsd >= 1 ? amountUsd.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }) : amountUsd.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const watchersMap = watchedByAddr.get(actorWallet) || null;
      if (!watchersMap || Object.keys(watchersMap).length === 0) continue;
      const notifiedUserIds = new Set<string>();
      for (const uid of Object.keys(watchersMap)) {
        if (notifiedUserIds.has(uid)) continue;
        notifiedUserIds.add(uid);
        const nickname = watchersMap[uid]?.nickname;
        const displayName = nickname || `Wallet ${actorWallet.slice(0, 4)}...${actorWallet.slice(-4)}`;
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
        const notificationId = createHash("sha256").update(`${tx.signature}:${uid}`).digest("hex");
        const notificationRef = db.collection("notifications").doc(notificationId);
        const deepLink = tokenTransfers.length > 0 && tokenAddress ? `/token/${tokenAddress}` : `/scanner/wallet/${actorWallet}`;
        const notificationData = {
          userId: uid,
          walletAddress: actorWallet,
          type: notificationType,
          title: notificationTitle,
          message: notificationMessage,
          txHash: tx.signature,
          tokenAddress: tokenAddress ?? null,
          amount: primaryTransfer?.tokenAmount ?? nativeTransfers[0]?.amount,
          amountUsd,
          read: false,
          createdAt: new Date(),
        };
        try {
          await notificationRef.create(notificationData);
        } catch (err: any) {
          if (err?.code === 6) continue;
          throw err;
        }
        createdNotifications.push({ userId: uid, title: notificationTitle, message: notificationMessage, type: notificationType, txHash: tx.signature, deepLink });
      }
    }
    const createdUserIds = [...new Set(createdNotifications.map((n) => n.userId))];
    const pushTokensByUid = new Map<string, PushToken[]>();
    await Promise.all(createdUserIds.map(async (uid) => { pushTokensByUid.set(uid, await getUserTokens(uid)); }));
    for (const item of createdNotifications) {
      try {
        const tokens = pushTokensByUid.get(item.userId) ?? [];
        const invalidTokens = await sendToTokens(tokens, { title: item.title, body: item.message, deepLink: item.deepLink, data: { type: item.type, txHash: item.txHash || "" } });
        for (const token of invalidTokens) {
          const docId = pushTokenDocId(token);
          await Promise.all([
            db.collection("users").doc(item.userId).collection("pushTokens").doc(docId).delete(),
            db.collection("pushTokenIndex").doc(docId).delete(),
          ]);
        }
      } catch (pushError) {
        console.error("Error sending push notification:", pushError);
      }
    }
    return res.status(200).json({ success: true, processed: transactions.length });
  } catch (error: any) {
    console.error("Webhook processing error:", error);
    return res.status(500).json({ error: error.message || "Internal server error" });
  }
}

const ROUTES: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<void | VercelResponse>> = {
  create: createHandler,
  sync: syncHandler,
  transaction: transactionHandler,
};

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const path = (req.url ?? "").split("?")[0];
  const segments = path.split("/").filter(Boolean);
  const action = segments[segments.length - 1];
  const routeHandler = action ? ROUTES[action] : undefined;
  if (!routeHandler) {
    res.status(404).json({ error: "Not found", message: `Webhook action '${action || ""}' not found. Use one of: ${Object.keys(ROUTES).join(", ")}` });
    return;
  }
  await routeHandler(req, res);
}
