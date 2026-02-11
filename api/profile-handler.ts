// Consolidated: followers-count, followers-list, by-handle (public)
// Rewrites: /api/profile/followers-count → /api/profile-handler?action=followers-count
//           /api/profile/followers-list → /api/profile-handler?action=followers-list
//           /api/profile/by-handle → /api/profile-handler?action=by-handle
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

// Initialize Firebase Admin (only once, same pattern as api/webhook/transaction.ts)
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

async function getUid(req: VercelRequest): Promise<string | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

function isUserPublic(data: { isPublic?: boolean }): boolean {
  return data.isPublic !== false;
}

async function byHandleHandler(req: VercelRequest, res: VercelResponse) {
  const rawHandle = (req.query.handle as string) || "";
  const handle = rawHandle.trim().replace(/^@/, "").toLowerCase();
  if (!handle) {
    return res.status(400).json({ error: "Missing handle" });
  }
  const normalizedHandle = `@${handle}`;

  try {
    const usersRef = adminDb.collection("users");
    const snapshot = await usersRef
      .where("xHandleLower", "==", normalizedHandle)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ error: "Profile not found or private" });
    }

    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();
    const uid = userDoc.id;

    if (!userData.walletAddress || !isUserPublic(userData)) {
      return res.status(404).json({ error: "Profile not found or private" });
    }

    const watchlist = (userData.watchlist || []) as Array<{ onPlatform?: boolean }>;
    const followingCount = watchlist.filter((w) => w.onPlatform === true).length;
    const watchlistCount = watchlist.length;

    const followersRef = adminDb.collection("followers").doc(uid);
    const followersSnap = await followersRef.get();
    const followerUids: string[] = followersSnap.exists
      ? (followersSnap.data()?.followerUids as string[]) || []
      : [];
    const followersCount = followerUids.length;

    return res.status(200).json({
      uid,
      xHandle: userData.xHandle || null,
      displayName: userData.displayName || userData.xHandle || null,
      avatar: userData.avatar || userData.photoURL || null,
      walletAddress: userData.walletAddress,
      evmAddress: userData.evmAddress || null,
      followersCount,
      followingCount,
      watchlistCount,
    });
  } catch (error: unknown) {
    console.error("[profile-handler] by-handle error:", error);
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : "Failed to fetch profile" });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const action = (req.query.action as string) || "";

  if (action === "by-handle") {
    return byHandleHandler(req, res);
  }

  if (action !== "followers-count" && action !== "followers-list") {
    return res.status(400).json({ error: "Invalid action" });
  }

  const uid = await getUid(req);
  if (!uid) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const followersRef = adminDb.collection("followers").doc(uid);
    const followersSnap = await followersRef.get();

    if (action === "followers-count") {
      const followerUids: string[] = followersSnap.exists
        ? (followersSnap.data()?.followerUids as string[]) || []
        : [];
      return res.status(200).json({ count: followerUids.length });
    }

    const followerUids: string[] = followersSnap.exists
      ? (followersSnap.data()?.followerUids as string[]) || []
      : [];
    const followers = followerUids.map((followerUid) => ({ uid: followerUid }));
    return res.status(200).json({ followers });
  } catch (error: unknown) {
    console.error("[profile-handler] Error:", error);
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : "Failed to get followers" });
  }
}
