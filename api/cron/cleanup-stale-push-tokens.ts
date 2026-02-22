/**
 * Cron: delete push tokens not seen in 60+ days.
 * Runs weekly. Auth: Bearer CRON_SECRET.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";

const PUSH_TOKEN_INDEX = "pushTokenIndex";
const STALE_DAYS = 60;

function ensureFirebase() {
  if (getApps().length > 0) return;
  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  let projectId: string | undefined;
  let clientEmail: string | undefined;
  let privateKey: string | undefined;
  if (rawServiceAccount) {
    const sa = JSON.parse(rawServiceAccount);
    projectId = sa.project_id;
    clientEmail = sa.client_email;
    privateKey = sa.private_key?.replace(/\\n/g, "\n");
  }
  projectId = projectId || process.env.FIREBASE_ADMIN_PROJECT_ID;
  clientEmail = clientEmail || process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  if (!privateKey && process.env.FIREBASE_ADMIN_PRIVATE_KEY) {
    privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n");
  }
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase admin not configured");
  }
  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.authorization !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    ensureFirebase();
    const db = getFirestore();
    const cutoff = Timestamp.fromMillis(
      Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000,
    );
    const indexRef = db.collection(PUSH_TOKEN_INDEX);

    let deletedStale = 0;
    const staleSnap = await indexRef.where("lastSeenAt", "<", cutoff).get();
    for (const doc of staleSnap.docs) {
      const data = doc.data();
      const uid = data.uid as string | undefined;
      const docId = doc.id;
      if (uid) {
        await db
          .collection("users")
          .doc(uid)
          .collection("pushTokens")
          .doc(docId)
          .delete();
      }
      await indexRef.doc(docId).delete();
      deletedStale++;
    }

    let deletedLegacy = 0;
    const allSnap = await indexRef.get();
    for (const doc of allSnap.docs) {
      const data = doc.data();
      if (data.lastSeenAt != null) continue;
      const uid = data.uid as string | undefined;
      const docId = doc.id;
      if (uid) {
        await db
          .collection("users")
          .doc(uid)
          .collection("pushTokens")
          .doc(docId)
          .delete();
      }
      await indexRef.doc(docId).delete();
      deletedLegacy++;
    }

    res.status(200).json({
      ok: true,
      deletedStale,
      deletedLegacy,
      deleted: deletedStale + deletedLegacy,
      staleDays: STALE_DAYS,
    });
  } catch (error: unknown) {
    console.error("[cleanup-stale-push-tokens]", error);
    res.status(500).json({
      error: "Cleanup failed",
      message: (error as Error).message,
    });
  }
}
