/**
 * Cron job: log user balance snapshots for 24h change calculation.
 * Runs daily at 00:05 UTC. Auth: Bearer CRON_SECRET.
 *
 * Computes balance (Solana USDC + SOL + positions) for users with wallets
 * and stores in balanceSnapshots/{userId}. The client uses prev/current
 * to show 24h delta.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const MAX_USERS = 100;
const ROTATE_THRESHOLD_MS = 20 * 60 * 60 * 1000; // 20 hours

function isUserPublic(data: { isPublic?: boolean }): boolean {
  return data.isPublic !== false;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (getApps().length === 0) {
    const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    let projectId: string | undefined;
    let clientEmail: string | undefined;
    let privateKey: string | undefined;

    if (rawServiceAccount) {
      try {
        const sa = JSON.parse(rawServiceAccount);
        projectId = sa.project_id;
        clientEmail = sa.client_email;
        privateKey = sa.private_key?.replace(/\\n/g, "\n");
      } catch {
        /* ignore */
      }
    }
    projectId = projectId || process.env.FIREBASE_ADMIN_PROJECT_ID;
    clientEmail = clientEmail || process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
    if (!privateKey && process.env.FIREBASE_ADMIN_PRIVATE_KEY) {
      privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n");
    }

    if (!projectId || !clientEmail || !privateKey) {
      return res.status(503).json({ error: "Firebase admin not configured" });
    }

    initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
    });
  }

  const db = getFirestore();

  try {
    const usersSnap = await db
      .collection("users")
      .where("walletAddress", "!=", null)
      .limit(MAX_USERS)
      .get();

    const users = usersSnap.docs
      .filter((d) => {
        const data = d.data();
        return data.walletAddress && isUserPublic(data);
      })
      .map((d) => ({
        uid: d.id,
        walletAddress: d.data().walletAddress as string,
      }));

    let rotated = 0;
    const now = Date.now();

    for (const { uid } of users) {
      const snapRef = db.collection("balanceSnapshots").doc(uid);
      const snap = await snapRef.get();
      const data = snap.data();

      const current = data?.current ?? 0;
      const currentAt = data?.currentAt?.toMillis?.() ?? 0;

      // Rotate: if last snapshot is >20h old, preserve it as "prev" (24h reference)
      if (currentAt > 0 && now - currentAt >= ROTATE_THRESHOLD_MS) {
        await snapRef.set(
          {
            prev: current,
            prevAt: data?.currentAt ?? FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        rotated++;
      }

      if (users.length > 10) {
        await new Promise((r) => setTimeout(r, 50));
      }
    }

    res.status(200).json({
      ok: true,
      users: users.length,
      rotated,
    });
  } catch (err) {
    console.error("[cron/log-balance]", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Log balance failed",
    });
  }
}
