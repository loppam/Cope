/**
 * GET /api/discover
 * Returns top traders (with cached win rates), paginated.
 * Query: ?limit=20&cursor=<base64-json> (cursor from previous response)
 * No auth required - public data only.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore, FieldPath } from "firebase-admin/firestore";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

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
    const limit = Math.min(
      Math.max(1, parseInt(String(req.query.limit || DEFAULT_LIMIT), 10)),
      MAX_LIMIT,
    );

    let cursor: { winRate: number; walletAddress: string } | null = null;
    if (typeof req.query.cursor === "string" && req.query.cursor) {
      try {
        const decoded = JSON.parse(
          Buffer.from(req.query.cursor, "base64url").toString("utf8"),
        );
        if (
          typeof decoded.winRate === "number" &&
          typeof decoded.walletAddress === "string"
        ) {
          cursor = decoded;
        }
      } catch {
        // invalid cursor, ignore
      }
    }

    let query = db
      .collection("walletStats")
      .orderBy("winRate", "desc")
      .orderBy(FieldPath.documentId())
      .limit(limit);

    if (cursor) {
      query = query.startAfter(cursor.winRate, cursor.walletAddress);
    }

    const statsSnap = await query.get();

    const topTraders: Array<{
      uid: string;
      xHandle: string | null;
      avatar: string | null;
      walletAddress: string;
      winRate: number;
      totalTrades: number;
      realizedPnL?: number;
    }> = [];

    let nextCursor: string | null = null;

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

      if (statsSnap.docs.length === limit) {
        const last = statsSnap.docs[statsSnap.docs.length - 1];
        const lastData = last.data();
        nextCursor = Buffer.from(
          JSON.stringify({
            winRate: lastData.winRate ?? 0,
            walletAddress: last.id,
          }),
          "utf8",
        ).toString("base64url");
      }
    }

    res.status(200).json({ topTraders, nextCursor });
  } catch (err) {
    console.error("[api/discover]", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Discover failed",
    });
  }
}
