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
    // Use followers reverse index: one doc read instead of full users scan
    const followersRef = adminDb.collection("followers").doc(uid);
    const followersSnap = await followersRef.get();

    if (action === "followers-count") {
      const followerUids: string[] = followersSnap.exists
        ? (followersSnap.data()?.followerUids as string[]) || []
        : [];
      return res.status(200).json({ count: followerUids.length });
    }

    // followers-list
    const followerUids: string[] = followersSnap.exists
      ? (followersSnap.data()?.followerUids as string[]) || []
      : [];
    const followers = followerUids.map((followerUid) => ({ uid: followerUid }));
    return res.status(200).json({ followers });
  } catch (error: any) {
    console.error("[profile-handler] Error:", error);
    return res
      .status(500)
      .json({ error: error.message || "Failed to get followers" });
  }
}
