// Consolidated: add, remove, sync-index
// Rewrites: /api/watchlist/add → /api/watchlist-handler?action=add
//           /api/watchlist/remove → /api/watchlist-handler?action=remove
//           /api/watchlist/sync-index → /api/watchlist-handler?action=sync-index
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminAuth, getAdminDb } from "../lib/firebase-admin";

const adminAuth = getAdminAuth();
const adminDb = getAdminDb();

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const HELIUS_WEBHOOK_ID = process.env.HELIUS_WEBHOOK_ID;
const HELIUS_WEBHOOK_URL = "https://api-mainnet.helius-rpc.com/v0/webhooks";

async function getHeliusWebhookAddresses(): Promise<string[]> {
  if (!HELIUS_API_KEY || !HELIUS_WEBHOOK_ID) return [];
  const res = await fetch(
    `${HELIUS_WEBHOOK_URL}/${HELIUS_WEBHOOK_ID}?api-key=${HELIUS_API_KEY}`,
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { accountAddresses?: string[] };
  return data.accountAddresses || [];
}

async function updateHeliusWebhookAddresses(
  accountAddresses: string[],
): Promise<boolean> {
  if (!HELIUS_API_KEY || !HELIUS_WEBHOOK_ID) return false;
  const base = process.env.VERCEL_URL?.startsWith("http")
    ? process.env.VERCEL_URL
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "";
  const webhookURL =
    process.env.WEBHOOK_URL || `${base}/api/webhook/transaction`;
  const res = await fetch(
    `${HELIUS_WEBHOOK_URL}/${HELIUS_WEBHOOK_ID}?api-key=${HELIUS_API_KEY}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        webhookURL,
        transactionTypes: ["BUY", "SELL", "SWAP"],
        accountAddresses,
        webhookType: "enhanced",
        ...(process.env.HELIUS_WEBHOOK_SECRET && {
          authHeader: process.env.HELIUS_WEBHOOK_SECRET,
        }),
      }),
    },
  );
  return res.ok;
}

async function getUidFromHeader(req: VercelRequest): Promise<string | null> {
  const authorization = req.headers.authorization;
  if (!authorization) return null;
  const token = authorization.replace("Bearer ", "");
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return decoded.uid;
  } catch (error) {
    console.error("Invalid token", error);
    return null;
  }
}

async function handleAdd(req: VercelRequest, res: VercelResponse) {
  const body = req.body || {};
  const walletAddress = (body.walletAddress || body.address || "").trim();
  if (!walletAddress) {
    return res.status(400).json({ error: "walletAddress is required" });
  }

  const nickname = body.nickname ? String(body.nickname).trim() : undefined;
  const onPlatform = body.onPlatform === true;
  const followedUid =
    typeof body.uid === "string" && body.uid.trim()
      ? String(body.uid).trim()
      : null;

  const walletData: Record<string, unknown> = {};
  if (body.matched != null) walletData.matched = body.matched;
  if (body.totalInvested != null) walletData.totalInvested = body.totalInvested;
  if (body.totalRemoved != null) walletData.totalRemoved = body.totalRemoved;
  if (body.profitMargin != null) walletData.profitMargin = body.profitMargin;

  const uid = await getUidFromHeader(req);
  if (!uid) return res.status(401).json({ error: "Unauthorized" });

  const userRef = adminDb.collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists)
    return res.status(404).json({ error: "User not found" });

  const userData = userSnap.data();
  const watchlist: Array<any> = userData?.watchlist || [];
  const existingIndex = watchlist.findIndex(
    (w: any) => w.address === walletAddress,
  );
  const now = new Date();
  const existing = existingIndex >= 0 ? watchlist[existingIndex] : null;

  const hasOnPlatformInBody = "onPlatform" in body;
  const onPlatformFinal = hasOnPlatformInBody
    ? onPlatform
    : (existing?.onPlatform ?? false);
  const uidFinal =
    hasOnPlatformInBody && onPlatform && followedUid
      ? followedUid
      : onPlatformFinal && existing?.uid
        ? existing.uid
        : onPlatformFinal && followedUid
          ? followedUid
          : undefined;

  const entry = {
    address: walletAddress,
    addedAt: existing?.addedAt ?? now,
    ...walletData,
    ...(nickname !== undefined && { nickname }),
    onPlatform: onPlatformFinal,
    ...(onPlatformFinal && uidFinal && { uid: uidFinal }),
    updatedAt: now,
  };

  if (existingIndex >= 0) {
    watchlist[existingIndex] = { ...watchlist[existingIndex], ...entry };
  } else {
    watchlist.push(entry);
  }

  await userRef.set(
    { watchlist, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );

  // Followers reverse index: when following a platform user, add self to their followers
  if (onPlatformFinal && uidFinal) {
    const followersRef = adminDb.collection("followers").doc(uidFinal);
    await followersRef.set(
      { followerUids: FieldValue.arrayUnion(uid) },
      { merge: true },
    );
  }

  // Incremental watchedWallets + Helius (no full sync)
  let effectiveAddress: string | null = null;
  if (onPlatformFinal && uidFinal) {
    const targetSnap = await adminDb.collection("users").doc(uidFinal).get();
    const targetData = targetSnap.data();
    if (targetData?.walletAddress && targetData?.isPublic !== false) {
      effectiveAddress = targetData.walletAddress as string;
    }
  } else {
    effectiveAddress = walletAddress;
  }

  if (effectiveAddress) {
    const watchedRef = adminDb
      .collection("watchedWallets")
      .doc(effectiveAddress);
    const watchedSnap = await watchedRef.get();
    const existing =
      (watchedSnap.data()?.watchers as Record<
        string,
        { nickname?: string; addedAt?: string }
      >) || {};
    const addedAt =
      existing[uid]?.addedAt ||
      (typeof entry.addedAt === "string"
        ? entry.addedAt
        : entry.addedAt instanceof Date
          ? entry.addedAt.toISOString()
          : new Date().toISOString());
    // Firestore does not allow undefined; omit nickname when missing
    const watcherEntry: { addedAt: string; nickname?: string } = { addedAt };
    if (entry.nickname != null && entry.nickname !== "") {
      watcherEntry.nickname = entry.nickname;
    }
    await watchedRef.set(
      {
        watchers: {
          ...existing,
          [uid]: watcherEntry,
        },
      },
      { merge: true },
    );

    const currentAddresses = await getHeliusWebhookAddresses();
    if (!currentAddresses.includes(effectiveAddress)) {
      await updateHeliusWebhookAddresses([
        ...currentAddresses,
        effectiveAddress,
      ]);
    }
  }

  return res.status(200).json({ success: true, watchlist });
}

async function handleRemove(req: VercelRequest, res: VercelResponse) {
  const body = req.body || {};
  const walletAddress = (body.walletAddress || body.address || "").trim();
  const removeByUid =
    typeof body.uid === "string" && body.uid.trim() ? body.uid.trim() : null;

  if (!walletAddress && !removeByUid) {
    return res.status(400).json({ error: "walletAddress or uid is required" });
  }

  const uid = await getUidFromHeader(req);
  if (!uid) return res.status(401).json({ error: "Unauthorized" });

  const userRef = adminDb.collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists)
    return res.status(404).json({ error: "User not found" });

  const userData = userSnap.data();
  const watchlist: Array<any> = userData?.watchlist || [];
  const removedEntry = watchlist.find((w: any) =>
    removeByUid ? w.uid === removeByUid : w.address === walletAddress,
  );
  const filteredWatchlist = watchlist.filter((w: any) => {
    if (removeByUid) return w.uid !== removeByUid;
    return w.address !== walletAddress;
  });

  await userRef.set(
    { watchlist: filteredWatchlist, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );

  // Followers reverse index: when unfollowing, remove self from their followers
  if (removedEntry?.uid) {
    const followersRef = adminDb
      .collection("followers")
      .doc(removedEntry.uid as string);
    await followersRef.set(
      { followerUids: FieldValue.arrayRemove(uid) },
      { merge: true },
    );
  }

  // Incremental watchedWallets + Helius: resolve effectiveAddress and remove
  if (removedEntry) {
    let effectiveAddress: string | null = null;
    if (removedEntry.onPlatform && removedEntry.uid) {
      const targetSnap = await adminDb
        .collection("users")
        .doc(removedEntry.uid)
        .get();
      effectiveAddress = (targetSnap.data()?.walletAddress as string) || null;
    } else {
      effectiveAddress = removedEntry.address || null;
    }

    if (effectiveAddress) {
      const watchedRef = adminDb
        .collection("watchedWallets")
        .doc(effectiveAddress);
      const watchedSnap = await watchedRef.get();
      const watchers =
        (watchedSnap.data()?.watchers as Record<
          string,
          { nickname?: string; addedAt?: string }
        >) || {};
      const next = { ...watchers };
      delete next[uid];
      if (Object.keys(next).length === 0) {
        await watchedRef.delete();
      } else {
        await watchedRef.set({ watchers: next }, { merge: true });
      }

      const currentAddresses = await getHeliusWebhookAddresses();
      const updated = currentAddresses.filter((a) => a !== effectiveAddress);
      if (updated.length !== currentAddresses.length) {
        await updateHeliusWebhookAddresses(updated);
      }
    }
  }

  return res.status(200).json({ success: true, watchlist: filteredWatchlist });
}

async function handleSyncIndex(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers.authorization;
  const secret = process.env.WEBHOOK_SYNC_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const usersSnapshot = await adminDb.collection("users").get();
  const watchedWallets: Record<
    string,
    Record<string, { nickname?: string; addedAt?: string }>
  > = {};

  usersSnapshot.docs.forEach((doc) => {
    const uid = doc.id;
    const userData = doc.data();
    const watchlist = userData.watchlist || [];
    watchlist.forEach((w: any) => {
      if (!w.address) return;
      if (!watchedWallets[w.address]) watchedWallets[w.address] = {};
      watchedWallets[w.address][uid] = {
        nickname: w.nickname,
        addedAt:
          w.addedAt?.toDate?.()?.toISOString?.() ||
          (w.addedAt instanceof Date ? w.addedAt.toISOString() : undefined),
      };
    });
  });

  const batch = adminDb.batch();
  for (const [walletAddress, watchers] of Object.entries(watchedWallets)) {
    batch.set(
      adminDb.collection("watchedWallets").doc(walletAddress),
      { watchers },
      { merge: true },
    );
  }
  await batch.commit();

  return res.status(200).json({
    success: true,
    walletsIndexed: Object.keys(watchedWallets).length,
    totalWatchers: Object.values(watchedWallets).reduce(
      (sum, w) => sum + Object.keys(w).length,
      0,
    ),
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = (req.query.action as string) || "";
  if (!["add", "remove", "sync-index"].includes(action)) {
    return res.status(400).json({ error: "Invalid action" });
  }

  if (action === "sync-index") {
    if (req.method !== "POST")
      return res.status(405).json({ error: "Method not allowed" });
    return handleSyncIndex(req, res);
  }

  if (action === "add") {
    if (req.method !== "POST")
      return res.status(405).json({ error: "Method not allowed" });
    return handleAdd(req, res);
  }

  // remove - POST or DELETE
  if (req.method !== "POST" && req.method !== "DELETE") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  return handleRemove(req, res);
}
