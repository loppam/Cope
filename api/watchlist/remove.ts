// Remove wallet from the current user's watchlist and update reverse index
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

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

const adminAuth = getAuth();
const adminDb = getFirestore();

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST" && req.method !== "DELETE") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const uid = await getUidFromHeader(req);
  if (!uid) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const body = req.body || {};
  const walletAddress = (body.walletAddress || body.address || "").trim();
  if (!walletAddress) {
    return res.status(400).json({ error: "walletAddress is required" });
  }

  try {
    const userRef = adminDb.collection("users").doc(uid);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const userData = userSnap.data();
    const watchlist: Array<{ address: string; [k: string]: unknown }> =
      userData?.watchlist || [];
    const filteredWatchlist = watchlist.filter(
      (w: any) => w.address !== walletAddress,
    );

    await userRef.set(
      {
        watchlist: filteredWatchlist,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    // Remove this user from reverse index
    const watchedRef = adminDb.collection("watchedWallets").doc(walletAddress);
    const watchedSnap = await watchedRef.get();
    const existingWatchers =
      (watchedSnap.data()?.watchers as Record<string, unknown>) || {};
    delete existingWatchers[uid];
    if (Object.keys(existingWatchers).length === 0) {
      await watchedRef.delete();
    } else {
      await watchedRef.set({ watchers: existingWatchers }, { merge: true });
    }

    // Update Helius webhook so this address is removed (even if client doesn't call sync)
    const syncSecret = process.env.WEBHOOK_SYNC_SECRET;
    const base = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : req.headers.origin || "";
    if (syncSecret && base) {
      fetch(`${base}/api/webhook/sync`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${syncSecret}`,
          "Content-Type": "application/json",
        },
      }).catch((err) =>
        console.error("[watchlist/remove] webhook sync failed:", err),
      );
    }

    return res
      .status(200)
      .json({ success: true, watchlist: filteredWatchlist });
  } catch (error: any) {
    console.error("Watchlist remove error:", error);
    return res
      .status(500)
      .json({ error: error.message || "Internal server error" });
  }
}
