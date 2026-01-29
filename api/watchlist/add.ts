// Add wallet to the current user's watchlist and update reverse index for per-user notifications
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
  if (req.method !== "POST") {
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

  const nickname = body.nickname ? String(body.nickname).trim() : undefined;
  const walletData: Record<string, unknown> = {};
  if (body.matched != null) walletData.matched = body.matched;
  if (body.totalInvested != null) walletData.totalInvested = body.totalInvested;
  if (body.totalRemoved != null) walletData.totalRemoved = body.totalRemoved;
  if (body.profitMargin != null) walletData.profitMargin = body.profitMargin;

  try {
    const userRef = adminDb.collection("users").doc(uid);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const userData = userSnap.data();
    const watchlist: Array<{
      address: string;
      nickname?: string;
      addedAt?: unknown;
      [k: string]: unknown;
    }> = userData?.watchlist || [];

    const existingIndex = watchlist.findIndex(
      (w: any) => w.address === walletAddress,
    );
    const now = new Date();

    if (existingIndex >= 0) {
      watchlist[existingIndex] = {
        ...watchlist[existingIndex],
        ...walletData,
        ...(nickname !== undefined && { nickname }),
        updatedAt: now,
      };
    } else {
      watchlist.push({
        address: walletAddress,
        addedAt: now,
        ...walletData,
        ...(nickname !== undefined && { nickname }),
      });
    }

    await userRef.set(
      {
        watchlist,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    // Update reverse index so transaction webhook can notify only users watching this wallet (per-user)
    const watchedRef = adminDb.collection("watchedWallets").doc(walletAddress);
    const watchedSnap = await watchedRef.get();
    const existingWatchers =
      (watchedSnap.data()?.watchers as Record<
        string,
        { nickname?: string; addedAt?: string }
      >) || {};
    existingWatchers[uid] = {
      nickname: nickname ?? undefined,
      addedAt: now.toISOString(),
    };
    await watchedRef.set({ watchers: existingWatchers }, { merge: true });

    return res.status(200).json({ success: true, watchlist });
  } catch (error: any) {
    console.error("Watchlist add error:", error);
    return res
      .status(500)
      .json({ error: error.message || "Internal server error" });
  }
}
