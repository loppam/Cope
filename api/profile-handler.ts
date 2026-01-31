// Consolidated: followers-count, followers-list
// Rewrites: /api/profile/followers-count → /api/profile-handler?action=followers-count
//           /api/profile/followers-list → /api/profile-handler?action=followers-list
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAdminAuth, getAdminDb } from "../lib/firebase-admin";

const adminAuth = getAdminAuth();
const adminDb = getAdminDb();

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

  const action = (req.query.action as string) || "";
  if (action !== "followers-count" && action !== "followers-list") {
    return res.status(400).json({ error: "Invalid action" });
  }

  const uid = await getUid(req);
  if (!uid) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const usersSnapshot = await adminDb.collection("users").get();

    if (action === "followers-count") {
      let count = 0;
      usersSnapshot.docs.forEach((doc) => {
        const data = doc.data();
        const watchlist = data.watchlist || [];
        const hasFollow = watchlist.some(
          (w: any) => w.onPlatform === true && w.uid === uid,
        );
        if (hasFollow) count++;
      });
      return res.status(200).json({ count });
    }

    // followers-list
    const followers: Array<{ uid: string }> = [];
    usersSnapshot.docs.forEach((doc) => {
      const data = doc.data();
      const watchlist = data.watchlist || [];
      const hasFollow = watchlist.some(
        (w: any) => w.onPlatform === true && w.uid === uid,
      );
      if (hasFollow) followers.push({ uid: doc.id });
    });
    return res.status(200).json({ followers });
  } catch (error: any) {
    console.error("[profile-handler] Error:", error);
    return res
      .status(500)
      .json({ error: error.message || "Failed to get followers" });
  }
}
