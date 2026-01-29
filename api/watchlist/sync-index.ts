// One-time or periodic sync: rebuild watchedWallets reverse index from all user watchlists.
// Call with Authorization: Bearer WEBHOOK_SYNC_SECRET (or same secret as webhook sync).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

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

const adminDb = getFirestore();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const authHeader = req.headers.authorization;
  const secret = process.env.WEBHOOK_SYNC_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
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
      const ref = adminDb.collection("watchedWallets").doc(walletAddress);
      batch.set(ref, { watchers }, { merge: true });
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
  } catch (error: any) {
    console.error("Sync watchlist index error:", error);
    return res
      .status(500)
      .json({ error: error.message || "Internal server error" });
  }
}
