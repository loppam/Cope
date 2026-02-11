/**
 * GET /api/discover
 * Returns top traders (with cached win rates) and all public accounts.
 * No auth required - public data only.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, FieldPath } from "firebase-admin/firestore";

function isUserPublic(data: { isPublic?: boolean }): boolean {
  return data.isPublic !== false;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (getApps().length === 0) {
    const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    let projectId: string | undefined;
    let clientEmail: string | undefined;
    let privateKey: string | undefined;

    if (rawServiceAccount) {
      try {
        const serviceAccount = JSON.parse(rawServiceAccount);
        projectId = serviceAccount.project_id;
        clientEmail = serviceAccount.client_email;
        privateKey = serviceAccount.private_key?.replace(/\\n/g, "\n");
      } catch {
        // ignore
      }
    }

    projectId = projectId || process.env.FIREBASE_ADMIN_PROJECT_ID;
    clientEmail = clientEmail || process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
    if (!privateKey && process.env.FIREBASE_ADMIN_PRIVATE_KEY) {
      privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n");
    }

    if (!projectId || !clientEmail || !privateKey) {
      res.status(503).json({ error: "Firebase admin not configured" });
      return;
    }

    initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  }

  const db = getFirestore();

  try {
    const statsSnap = await db
      .collection("walletStats")
      .orderBy("winRate", "desc")
      .limit(20)
      .get();

    const topTraders: Array<{
      uid: string;
      xHandle: string | null;
      avatar: string | null;
      walletAddress: string;
      winRate: number;
      totalTrades: number;
      realizedPnL?: number;
    }> = [];

    if (!statsSnap.empty) {
      const uids = statsSnap.docs
        .map((d) => d.data().uid as string)
        .filter(Boolean);
      const uidSet = new Set(uids);

      const usersSnap = await db.collection("users").get();
      const userMap = new Map<string, { xHandle?: string; avatar?: string }>();
      usersSnap.docs.forEach((d) => {
        if (uidSet.has(d.id)) {
          const data = d.data();
          userMap.set(d.id, {
            xHandle: data.xHandle ?? null,
            avatar: data.avatar ?? data.photoURL ?? null,
          });
        }
      });

      statsSnap.docs.forEach((d) => {
        const data = d.data();
        const uid = data.uid as string;
        const walletAddress = d.id;
        const user = userMap.get(uid);
        topTraders.push({
          uid,
          xHandle: user?.xHandle ?? null,
          avatar: user?.avatar ?? null,
          walletAddress,
          winRate: data.winRate ?? 0,
          totalTrades: data.totalTrades ?? 0,
          realizedPnL: data.realizedPnL,
        });
      });
    }

    const usersSnap = await db
      .collection("users")
      .where("walletAddress", "!=", null)
      .limit(100)
      .get();

    const accountDocs = usersSnap.docs
      .filter((d) => isUserPublic(d.data()))
      .slice(0, 50);

    const walletAddresses = accountDocs
      .map((d) => d.data().walletAddress as string)
      .filter(Boolean);

    const statsByWallet = new Map<
      string,
      { winRate: number; totalTrades: number; realizedPnL?: number }
    >();
    if (walletAddresses.length > 0) {
      const chunkSize = 10;
      const chunks: string[][] = [];
      for (let i = 0; i < walletAddresses.length; i += chunkSize) {
        chunks.push(walletAddresses.slice(i, i + chunkSize));
      }
      const allStats = await Promise.all(
        chunks.map((chunk) =>
          db
            .collection("walletStats")
            .where(FieldPath.documentId(), "in", chunk)
            .get()
        )
      );
      allStats.forEach((snap) => {
        snap.docs.forEach((d) => {
          const data = d.data();
          statsByWallet.set(d.id, {
            winRate: data.winRate ?? 0,
            totalTrades: data.totalTrades ?? 0,
            realizedPnL: data.realizedPnL,
          });
        });
      });
    }

    const accounts = accountDocs.map((d) => {
      const data = d.data();
      const walletAddress = data.walletAddress;
      const stats = walletAddress ? statsByWallet.get(walletAddress) : undefined;
      return {
        uid: d.id,
        xHandle: data.xHandle ?? null,
        displayName: data.displayName ?? null,
        avatar: data.avatar ?? data.photoURL ?? null,
        walletAddress,
        winRate: stats?.winRate ?? 0,
        totalTrades: stats?.totalTrades ?? 0,
        realizedPnL: stats?.realizedPnL,
      };
    });

    res.status(200).json({ topTraders, accounts });
  } catch (err) {
    console.error("[api/discover]", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Discover failed",
    });
  }
}
