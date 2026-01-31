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
      onPlatform?: boolean;
      uid?: string;
      addedAt?: unknown;
      [k: string]: unknown;
    }> = userData?.watchlist || [];

    const existingIndex = watchlist.findIndex(
      (w: any) => w.address === walletAddress,
    );
    const now = new Date();
    const existing =
      existingIndex >= 0 ? (watchlist[existingIndex] as any) : null;

    // For new entries: set onPlatform/uid from body. For updates: preserve existing unless explicitly provided
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
      watchlist[existingIndex] = {
        ...watchlist[existingIndex],
        ...entry,
      };
    } else {
      watchlist.push(entry);
    }

    await userRef.set(
      {
        watchlist,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    // Reverse index (watchedWallets) is maintained by webhook/sync; trigger sync
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
        console.error("[watchlist/add] webhook sync failed:", err),
      );
    }

    return res.status(200).json({ success: true, watchlist });
  } catch (error: any) {
    console.error("Watchlist add error:", error);
    return res
      .status(500)
      .json({ error: error.message || "Internal server error" });
  }
}
