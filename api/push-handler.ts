// Consolidated: register, send, status
// Rewrites: /api/push/register → /api/push-handler?action=register
//           /api/push/send → /api/push-handler?action=send
//           /api/push/status → /api/push-handler?action=status
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash } from "crypto";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import webpush from "web-push";

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
const adminMessaging = getMessaging();

const PUSH_TOKEN_INDEX = "pushTokenIndex";

function pushTokenDocId(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function getUidFromHeader(req: VercelRequest) {
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

async function getUserData(req: VercelRequest) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const userRef = adminDb.collection("users").doc(decoded.uid);
    const snap = await userRef.get();
    return { uid: decoded.uid, xHandle: snap.data()?.xHandle?.toLowerCase() };
  } catch (error) {
    return null;
  }
}

interface PushToken {
  token: string;
  platform: string;
}

interface PushTokenWithUid extends PushToken {
  uid: string;
}

function isWebPushSubscription(token: string): boolean {
  try {
    const parsed = JSON.parse(token);
    return (
      parsed &&
      typeof parsed === "object" &&
      parsed.endpoint &&
      parsed.keys &&
      parsed.keys.p256dh &&
      parsed.keys.auth
    );
  } catch {
    return false;
  }
}

function initWebPush() {
  const vapidPublicKey = process.env.VITE_FIREBASE_VAPID_KEY;
  const vapidPrivateKey = process.env.FIREBASE_VAPID_PRIVATE_KEY;
  if (!vapidPublicKey || !vapidPrivateKey) return false;
  try {
    webpush.setVapidDetails(
      "mailto:your-email@example.com",
      vapidPublicKey,
      vapidPrivateKey,
    );
    return true;
  } catch {
    return false;
  }
}

/** Read all push tokens from reverse index (one collection read instead of users + subcollections). */
async function getAllUserTokens(): Promise<PushTokenWithUid[]> {
  const snap = await adminDb.collection(PUSH_TOKEN_INDEX).get();
  const result: PushTokenWithUid[] = [];
  snap.forEach((doc: QueryDocumentSnapshot) => {
    const data = doc.data();
    if (data.token && data.uid) {
      result.push({
        token: data.token as string,
        platform: (data.platform as string) || "web",
        uid: data.uid as string,
      });
    }
  });
  return result;
}

async function sendToTokens(
  tokens: PushToken[],
  payload: any,
): Promise<string[]> {
  if (!tokens.length) return [];
  const deepLink = payload.deepLink || "/app/alerts";
  const invalidTokens: string[] = [];
  const fcmTokens: string[] = [];
  const webPushSubscriptions: Array<{ token: string; subscription: any }> = [];

  for (const tokenData of tokens) {
    if (
      tokenData.platform === "webpush" ||
      isWebPushSubscription(tokenData.token)
    ) {
      try {
        webPushSubscriptions.push({
          token: tokenData.token,
          subscription: JSON.parse(tokenData.token),
        });
      } catch {
        invalidTokens.push(tokenData.token);
      }
    } else {
      fcmTokens.push(tokenData.token);
    }
  }

  const INVALID_FCM_CODES = [
    "messaging/registration-token-not-registered",
    "messaging/invalid-registration-token",
    "messaging/invalid-argument",
    "messaging/mismatched-credential",
  ];

  if (fcmTokens.length > 0) {
    try {
      const data = { ...(payload.data || {}), deepLink };
      const response = await adminMessaging.sendEachForMulticast({
        tokens: fcmTokens,
        notification: { title: payload.title, body: payload.body },
        data,
        webpush: { fcmOptions: { link: deepLink } },
      });
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          console.warn("[Push] FCM failed", {
            idx,
            code: resp.error?.code,
            message: resp.error?.message,
          });
          if (INVALID_FCM_CODES.includes(resp.error?.code ?? "")) {
            invalidTokens.push(fcmTokens[idx]);
          }
        }
      });
    } catch (error) {
      console.error("[Push] FCM send error:", error);
      invalidTokens.push(...fcmTokens);
    }
  }

  if (webPushSubscriptions.length > 0 && initWebPush()) {
    const webPushPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      data: { ...(payload.data || {}), deepLink },
      icon: "/icons/icon-192x192.png",
      badge: "/icons/icon-96x96.png",
    });
    const INVALID_WEBPUSH_STATUS = [410, 404, 400, 401, 403];
    await Promise.allSettled(
      webPushSubscriptions.map(async ({ token, subscription }) => {
        try {
          await webpush.sendNotification(subscription, webPushPayload, {
            TTL: 86400, // 24 hours
          });
          return { success: true, token };
        } catch (error: any) {
          console.warn("[Push] Web Push failed", {
            statusCode: error.statusCode,
            message: error.message,
          });
          if (INVALID_WEBPUSH_STATUS.includes(error.statusCode ?? 0)) {
            invalidTokens.push(token);
          }
          return { success: false, token };
        }
      }),
    );
  } else if (webPushSubscriptions.length > 0) {
    console.warn("[Push] Web Push init failed - VAPID keys missing or invalid");
    invalidTokens.push(...webPushSubscriptions.map((s) => s.token));
  }

  return invalidTokens;
}

async function handleDiag(req: VercelRequest, res: VercelResponse) {
  if (
    process.env.NODE_ENV === "production" &&
    req.query.secret !== process.env.PUSH_DIAG_SECRET
  ) {
    return res.status(404).json({ error: "Not found" });
  }
  const vapidPublic = !!process.env.VITE_FIREBASE_VAPID_KEY;
  const vapidPrivate = !!process.env.FIREBASE_VAPID_PRIVATE_KEY;
  const vapidInitOk = vapidPublic && vapidPrivate && initWebPush();
  const firebaseAdminOk = !!(
    process.env.FIREBASE_SERVICE_ACCOUNT ||
    (process.env.FIREBASE_ADMIN_PROJECT_ID &&
      process.env.FIREBASE_ADMIN_CLIENT_EMAIL &&
      process.env.FIREBASE_ADMIN_PRIVATE_KEY)
  );
  let fcmCount = 0;
  let webPushCount = 0;
  try {
    const snap = await adminDb.collection(PUSH_TOKEN_INDEX).get();
    snap.forEach((doc) => {
      const d = doc.data();
      const platform = (d.platform as string) || "web";
      const isWeb =
        platform === "webpush" || isWebPushSubscription(d.token as string);
      if (isWeb) webPushCount++;
      else fcmCount++;
    });
  } catch {
    /* ignore */
  }
  return res.status(200).json({
    vapidPublic,
    vapidPrivate,
    vapidInitOk,
    firebaseAdminOk,
    tokenCounts: {
      fcm: fcmCount,
      webpush: webPushCount,
      total: fcmCount + webPushCount,
    },
    env: { nodeEnv: process.env.NODE_ENV ?? "undefined" },
    note: "Set PUSH_DIAG_SECRET in production to use ?secret=...",
  });
}

async function handleRegister(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST" && req.method !== "DELETE") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const uid = await getUidFromHeader(req);
  if (!uid) return res.status(401).json({ error: "Unauthorized" });

  const token =
    (req.body as { token?: string } | undefined)?.token ||
    (req.query.token as string | undefined);
  const platform = (req.body as { platform?: string } | undefined)?.platform;
  if (!token) return res.status(400).json({ error: "Token is required" });

  const tokenRef = adminDb
    .collection("users")
    .doc(uid)
    .collection("pushTokens")
    .doc(pushTokenDocId(token));
  const indexRef = adminDb
    .collection(PUSH_TOKEN_INDEX)
    .doc(pushTokenDocId(token));
  if (req.method === "POST") {
    const platformVal = platform || "web";
    const now = FieldValue.serverTimestamp();
    await tokenRef.set(
      {
        token,
        platform: platformVal,
        createdAt: now,
        lastSeenAt: now,
      },
      { merge: true },
    );
    await indexRef.set(
      { uid, token, platform: platformVal, lastSeenAt: now },
      { merge: true },
    );
  } else {
    await tokenRef.delete();
    await indexRef.delete();
  }
  return res.status(200).json({ success: true });
}

async function handleStatus(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });
  const uid = await getUidFromHeader(req);
  if (!uid) return res.status(401).json({ error: "Unauthorized" });

  const snapshot = await adminDb
    .collection("users")
    .doc(uid)
    .collection("pushTokens")
    .get();
  return res
    .status(200)
    .json({ tokens: snapshot.size, enabled: snapshot.size > 0 });
}

async function handleSend(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });
  const user = await getUserData(req);
  if (!user || user.xHandle !== "@lopam.eth") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { title, body, deepLink } = req.body || {};
  if (!title || !body)
    return res.status(400).json({ error: "Title and body required" });

  try {
    const tokensWithUid = await getAllUserTokens();
    const tokens: PushToken[] = tokensWithUid.map(({ token, platform }) => ({
      token,
      platform,
    }));
    const tokenToUid = new Map(tokensWithUid.map((t) => [t.token, t.uid]));

    const invalidTokens = await sendToTokens(tokens, { title, body, deepLink });

    if (invalidTokens.length > 0) {
      const indexRef = adminDb.collection(PUSH_TOKEN_INDEX);
      await Promise.all(
        invalidTokens.map(async (token) => {
          const uid = tokenToUid.get(token);
          const docId = pushTokenDocId(token);
          if (uid) {
            await adminDb
              .collection("users")
              .doc(uid)
              .collection("pushTokens")
              .doc(docId)
              .delete();
          }
          await indexRef.doc(docId).delete();
        }),
      );
    }

    return res.status(200).json({
      success: true,
      removed: invalidTokens.length,
      totalTokens: tokens.length,
      fcmTokens: tokens.filter(
        (t) => t.platform !== "webpush" && !isWebPushSubscription(t.token),
      ).length,
      webPushTokens: tokens.filter(
        (t) => t.platform === "webpush" || isWebPushSubscription(t.token),
      ).length,
    });
  } catch (error) {
    console.error("Failed to send push", error);
    return res.status(500).json({
      error: "Failed to send push",
      message: (error as Error).message,
    });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = (req.query.action as string) || "";
  if (!["register", "send", "status", "diag"].includes(action)) {
    return res.status(400).json({ error: "Invalid action" });
  }

  if (action === "diag") return handleDiag(req, res);
  if (action === "register") return handleRegister(req, res);
  if (action === "status") return handleStatus(req, res);
  return handleSend(req, res);
}
