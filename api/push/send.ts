import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash } from "crypto";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import webpush from "web-push";

function pushTokenDocId(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });
  const user = await getUserData(req);
  if (!user || user.xHandle !== "@lopam.eth") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { title, body, deepLink } = req.body || {};
  if (!title || !body) {
    return res.status(400).json({ error: "Title and body required" });
  }

  try {
    const tokensWithUid = await getAllUserTokens();
    const tokens: PushToken[] = tokensWithUid.map(({ token, platform }) => ({
      token,
      platform,
    }));
    const tokenToUid = new Map(tokensWithUid.map((t) => [t.token, t.uid]));

    console.log(`[Push] Sending to all users: ${tokens.length} total tokens`);
    console.log(
      `[Push] Token platforms:`,
      tokens.map((t) => ({
        platform: t.platform,
        isWebPush: isWebPushSubscription(t.token),
      })),
    );

    const invalidTokens = await sendToTokens(tokens, { title, body, deepLink });

    if (invalidTokens.length > 0) {
      console.log(`[Push] Removing ${invalidTokens.length} invalid tokens`);
      await Promise.all(
        invalidTokens.map((token) => {
          const uid = tokenToUid.get(token);
          if (!uid) return Promise.resolve();
          return adminDb
            .collection("users")
            .doc(uid)
            .collection("pushTokens")
            .doc(pushTokenDocId(token))
            .delete();
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

interface PushToken {
  token: string;
  platform: string;
}

interface PushTokenWithUid extends PushToken {
  uid: string;
}

/** Collect push tokens from all users (for admin broadcast). */
async function getAllUserTokens(): Promise<PushTokenWithUid[]> {
  const usersSnap = await adminDb.collection("users").get();
  const result: PushTokenWithUid[] = [];
  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const tokensSnap = await adminDb
      .collection("users")
      .doc(uid)
      .collection("pushTokens")
      .get();
    tokensSnap.forEach((doc) => {
      const data = doc.data();
      if (data.token) {
        result.push({
          token: data.token,
          platform: data.platform || "web",
          uid,
        });
      }
    });
  }
  return result;
}

/**
 * Check if token is a Web Push subscription (JSON object) or FCM token (string)
 */
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

/**
 * Initialize Web Push with VAPID keys
 */
function initWebPush() {
  const vapidPublicKey = process.env.VITE_FIREBASE_VAPID_KEY;
  const vapidPrivateKey = process.env.FIREBASE_VAPID_PRIVATE_KEY;

  if (!vapidPublicKey || !vapidPrivateKey) {
    console.error("[Push] VAPID keys not configured for Web Push");
    console.error("[Push] VAPID_PUBLIC_KEY exists:", !!vapidPublicKey);
    console.error("[Push] VAPID_PRIVATE_KEY exists:", !!vapidPrivateKey);
    console.error(
      "[Push] Make sure both are set in Vercel environment variables",
    );
    return false;
  }

  try {
    webpush.setVapidDetails(
      "mailto:your-email@example.com", // Contact email (update this)
      vapidPublicKey,
      vapidPrivateKey,
    );
    console.log("[Push] Web Push initialized successfully with VAPID keys");
    return true;
  } catch (error: any) {
    console.error("[Push] Failed to initialize Web Push:", {
      error: error.message,
      name: error.name,
    });
    return false;
  }
}

/**
 * Send notifications to tokens (supports both FCM and Web Push)
 */
async function sendToTokens(
  tokens: PushToken[],
  payload: any,
): Promise<string[]> {
  if (!tokens.length) return [];

  const deepLink = payload.deepLink || "/app/alerts";
  const invalidTokens: string[] = [];

  // Separate FCM tokens and Web Push subscriptions
  const fcmTokens: string[] = [];
  const webPushSubscriptions: Array<{ token: string; subscription: any }> = [];

  for (const tokenData of tokens) {
    if (
      tokenData.platform === "webpush" ||
      isWebPushSubscription(tokenData.token)
    ) {
      try {
        const subscription = JSON.parse(tokenData.token);
        webPushSubscriptions.push({
          token: tokenData.token,
          subscription,
        });
      } catch (e) {
        console.error("[Push] Invalid Web Push subscription:", e);
        invalidTokens.push(tokenData.token);
      }
    } else {
      fcmTokens.push(tokenData.token);
    }
  }

  // Send FCM notifications
  if (fcmTokens.length > 0) {
    try {
      const data = { ...(payload.data || {}), deepLink };
      const response = await adminMessaging.sendEachForMulticast({
        tokens: fcmTokens,
        notification: {
          title: payload.title,
          body: payload.body,
        },
        data,
        webpush: {
          fcmOptions: {
            link: deepLink,
          },
        },
      });

      response.responses.forEach((resp, idx) => {
        if (
          !resp.success &&
          resp.error?.code === "messaging/registration-token-not-registered"
        ) {
          invalidTokens.push(fcmTokens[idx]);
        }
      });
    } catch (error) {
      console.error("[Push] FCM send error:", error);
      // Mark all FCM tokens as invalid on error
      invalidTokens.push(...fcmTokens);
    }
  }

  // Send Web Push notifications
  if (webPushSubscriptions.length > 0) {
    console.log(
      `[Push] Sending to ${webPushSubscriptions.length} Web Push subscriptions`,
    );
    if (!initWebPush()) {
      console.error(
        "[Push] Web Push not initialized, skipping Web Push tokens",
      );
      invalidTokens.push(...webPushSubscriptions.map((s) => s.token));
    } else {
      const webPushPayload = JSON.stringify({
        title: payload.title,
        body: payload.body,
        data: { ...(payload.data || {}), deepLink },
        icon: "/icons/icon-192x192.png",
        badge: "/icons/icon-96x96.png",
      });

      const results = await Promise.allSettled(
        webPushSubscriptions.map(async ({ token, subscription }) => {
          try {
            console.log(`[Push] Sending Web Push to subscription:`, {
              endpoint: subscription.endpoint?.substring(0, 50) + "...",
              keys: !!subscription.keys,
            });
            await webpush.sendNotification(subscription, webPushPayload);
            console.log(`[Push] Web Push sent successfully`);
            return { success: true, token };
          } catch (error: any) {
            console.error("[Push] Web Push send error:", {
              statusCode: error.statusCode,
              message: error.message,
              body: error.body,
            });
            // Mark as invalid if subscription expired or invalid
            if (
              error.statusCode === 410 || // Gone
              error.statusCode === 404 || // Not Found
              error.statusCode === 400 // Bad Request
            ) {
              invalidTokens.push(token);
            }
            return { success: false, token, error };
          }
        }),
      );

      const successCount = results.filter(
        (r) => r.status === "fulfilled" && r.value.success,
      ).length;
      const failCount = results.length - successCount;
      console.log(
        `[Push] Web Push results: ${successCount} succeeded, ${failCount} failed`,
      );
    }
  }

  return invalidTokens;
}
