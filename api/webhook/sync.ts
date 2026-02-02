// Vercel Serverless Function: Sync all watched wallets to Helius webhook
// This should be called when a wallet is added/removed from watchlist
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, type DocumentReference } from "firebase-admin/firestore";

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
// Helius webhook API (documented: https://docs.helius.dev/api-reference/webhooks)
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const HELIUS_API_URL = "https://api-mainnet.helius-rpc.com/v0/webhooks";
const WEBHOOK_ID = process.env.HELIUS_WEBHOOK_ID; // Store this in .env after creating first webhook

/** Transaction types we subscribe to: SWAP only (buy/sell inferred from SOL↔token direction in handler). */
const WEBHOOK_TRANSACTION_TYPES = ["SWAP"] as const;

function isUserPublic(data: { isPublic?: boolean }): boolean {
  return data.isPublic !== false;
}

/**
 * Sync all watched wallets across all users to Helius webhook.
 * - onPlatform entries: resolve uid → current walletAddress; skip if user is private.
 * - Rebuilds watchedWallets reverse index from watchlists.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authHeader = req.headers.authorization;
  if (
    process.env.WEBHOOK_SYNC_SECRET &&
    authHeader !== `Bearer ${process.env.WEBHOOK_SYNC_SECRET}`
  ) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    if (!HELIUS_API_KEY) {
      console.error("[webhook/sync] HELIUS_API_KEY not set");
      return res.status(500).json({ error: "HELIUS_API_KEY not configured" });
    }

    let usersSnapshot;
    try {
      usersSnapshot = await db.collection("users").get();
    } catch (dbError: any) {
      console.error(
        "[webhook/sync] Firestore error:",
        dbError?.message || dbError,
      );
      return res.status(500).json({
        error: "Firestore error",
        message: dbError?.message || "Failed to read users",
      });
    }

    // Build user lookup: uid -> { walletAddress, isPublic }
    const userByUid = new Map<
      string,
      { walletAddress: string | null; isPublic: boolean }
    >();
    usersSnapshot.docs.forEach((doc) => {
      const d = doc.data();
      userByUid.set(doc.id, {
        walletAddress: d.walletAddress || null,
        isPublic: isUserPublic(d),
      });
    });

    // address -> { [watcherUid]: { nickname?, addedAt? } }
    const addressToWatchers = new Map<
      string,
      Record<string, { nickname?: string; addedAt?: string }>
    >();

    for (const doc of usersSnapshot.docs) {
      const watcherUid = doc.id;
      const userData = doc.data();
      const watchlist: Array<{
        address: string;
        uid?: string;
        onPlatform?: boolean;
        nickname?: string;
        addedAt?: unknown;
      }> = userData.watchlist || [];

      for (const w of watchlist) {
        if (!w.address) continue;

        let effectiveAddress: string | null = null;

        if (w.onPlatform && w.uid) {
          const target = userByUid.get(w.uid);
          if (!target || !target.isPublic || !target.walletAddress) {
            // Private or no wallet: exclude from webhook (no notifications)
            continue;
          }
          effectiveAddress = target.walletAddress;
        } else {
          effectiveAddress = w.address;
        }

        if (!effectiveAddress) continue;

        const existing = addressToWatchers.get(effectiveAddress) || {};
        const addedAt =
          w.addedAt instanceof Date
            ? w.addedAt.toISOString()
            : typeof w.addedAt === "string"
              ? w.addedAt
              : new Date().toISOString();
        existing[watcherUid] = {
          nickname: w.nickname,
          addedAt,
        };
        addressToWatchers.set(effectiveAddress, existing);
      }
    }

    const accountAddresses = Array.from(addressToWatchers.keys());

    const batch = db.batch();

    // Build followers reverse index: targetUid -> followerUids[] (who has this user in watchlist with onPlatform)
    const followersMap = new Map<string, string[]>();
    const allTargetUids = new Set<string>();
    for (const doc of usersSnapshot.docs) {
      const watcherUid = doc.id;
      const userData = doc.data();
      const watchlist: Array<{ uid?: string; onPlatform?: boolean }> =
        userData.watchlist || [];
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
      const followerUids = followersMap.get(targetUid) || [];
      batch.set(ref, { followerUids }, { merge: true });
    }

    // Rebuild watchedWallets reverse index
    const allWatchedRefs = await db.collection("watchedWallets").get();
    const toDelete: DocumentReference[] = [];
    const toWrite = new Set<string>();

    for (const addr of accountAddresses) {
      toWrite.add(addr);
      const watchers = addressToWatchers.get(addr)!;
      const ref = db.collection("watchedWallets").doc(addr);
      batch.set(ref, { watchers }, { merge: true });
    }

    for (const doc of allWatchedRefs.docs) {
      if (!toWrite.has(doc.id)) {
        toDelete.push(doc.ref);
      }
    }
    for (const ref of toDelete) {
      batch.delete(ref);
    }

    await batch.commit();

    // Update lastSyncAt for lazy sync timer (transaction handler checks every 5h)
    const configRef = db.collection("config").doc("webhookSync");
    await configRef.set(
      { lastSyncAt: Date.now(), updatedAt: new Date() },
      { merge: true },
    );

    // Get webhook URL
    const webhookURL =
      process.env.WEBHOOK_URL ||
      `${req.headers.origin || "https://your-domain.vercel.app"}/api/webhook/transaction`;

    // If we have an existing webhook, update it (PUT /v0/webhooks/{webhookID} per Helius docs)
    if (WEBHOOK_ID) {
      const updateResponse = await fetch(
        `${HELIUS_API_URL}/${WEBHOOK_ID}?api-key=${HELIUS_API_KEY}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            webhookURL:
              process.env.WEBHOOK_URL ||
              `${req.headers.origin || "https://your-domain.vercel.app"}/api/webhook/transaction`,
            transactionTypes: WEBHOOK_TRANSACTION_TYPES,
            accountAddresses,
            webhookType: "enhanced",
            ...(process.env.HELIUS_WEBHOOK_SECRET && {
              authHeader: process.env.HELIUS_WEBHOOK_SECRET,
            }),
          }),
        },
      );

      if (!updateResponse.ok) {
        const error = await updateResponse.text();
        throw new Error(`Failed to update webhook: ${error}`);
      }

      const data = await updateResponse.json();
      return res.status(200).json({
        success: true,
        webhookId: data.webhookID,
        walletsMonitored: accountAddresses.length,
      });
    }

    // Create new webhook if it doesn't exist
    const createResponse = await fetch(
      `${HELIUS_API_URL}?api-key=${HELIUS_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          webhookURL,
          transactionTypes: WEBHOOK_TRANSACTION_TYPES,
          accountAddresses,
          webhookType: "enhanced",
          ...(process.env.HELIUS_WEBHOOK_SECRET && {
            authHeader: process.env.HELIUS_WEBHOOK_SECRET,
          }),
        }),
      },
    );

    if (!createResponse.ok) {
      const error = await createResponse.text();
      throw new Error(`Failed to create webhook: ${error}`);
    }

    const data = await createResponse.json();

    // Store webhook ID (you should save this to your .env or database)
    console.log(
      `New webhook created: ${data.webhookID}. Add this to HELIUS_WEBHOOK_ID in .env`,
    );

    return res.status(200).json({
      success: true,
      webhookId: data.webhookID,
      walletsMonitored: accountAddresses.length,
      message: "Add webhookId to HELIUS_WEBHOOK_ID in .env",
    });
  } catch (error: any) {
    const message = error?.message || String(error);
    console.error("[webhook/sync] Error:", message, error?.stack);
    return res.status(500).json({
      error: "Webhook sync failed",
      message,
    });
  }
}
