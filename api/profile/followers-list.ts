// GET /api/profile/followers-list - Returns list of followers (uid) for authenticated user
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const uid = await getUid(req);
  if (!uid) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const usersSnapshot = await adminDb.collection("users").get();
    const followers: Array<{ uid: string }> = [];

    usersSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      const watchlist = data.watchlist || [];
      const hasFollow = watchlist.some(
        (w: any) => w.onPlatform === true && w.uid === uid,
      );
      if (hasFollow) {
        followers.push({ uid: doc.id });
      }
    });

    return res.status(200).json({ followers });
  } catch (error: any) {
    console.error("[profile/followers-list] Error:", error);
    return res
      .status(500)
      .json({ error: error.message || "Failed to get followers list" });
  }
}
