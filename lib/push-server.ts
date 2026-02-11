/**
 * Server-side push notification helpers.
 * Caller must ensure Firebase Admin is initialized (ensureFirebase / getApps().length > 0).
 */
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import webpush from "web-push";

export interface PushToken {
  token: string;
  platform: string;
}

export interface PushPayload {
  title: string;
  body: string;
  deepLink?: string;
  data?: Record<string, string>;
}

function isWebPushSubscription(token: string): boolean {
  try {
    const parsed = JSON.parse(token);
    return !!(parsed && typeof parsed === "object" && parsed.endpoint && parsed.keys?.p256dh && parsed.keys?.auth);
  } catch {
    return false;
  }
}

function initWebPush(): boolean {
  const vapidPublicKey = process.env.VITE_FIREBASE_VAPID_KEY;
  const vapidPrivateKey = process.env.FIREBASE_VAPID_PRIVATE_KEY;
  if (!vapidPublicKey || !vapidPrivateKey) return false;
  try {
    webpush.setVapidDetails("mailto:your-email@example.com", vapidPublicKey, vapidPrivateKey);
    return true;
  } catch {
    return false;
  }
}

export async function getUserTokens(uid: string): Promise<PushToken[]> {
  const db = getFirestore();
  const snapshot = await db.collection("users").doc(uid).collection("pushTokens").get();
  const tokens: PushToken[] = [];
  snapshot.forEach((doc: QueryDocumentSnapshot) => {
    const data = doc.data();
    if (data.token) tokens.push({ token: data.token, platform: data.platform || "web" });
  });
  return tokens;
}

export async function sendToTokens(
  tokens: PushToken[],
  payload: PushPayload
): Promise<string[]> {
  if (!tokens.length) return [];
  const deepLink = payload.deepLink || "/app/profile";
  const invalidTokens: string[] = [];
  const fcmTokens: string[] = [];
  const webPushSubscriptions: Array<{ token: string; subscription: unknown }> = [];

  for (const tokenData of tokens) {
    if (tokenData.platform === "webpush" || isWebPushSubscription(tokenData.token)) {
      try {
        webPushSubscriptions.push({ token: tokenData.token, subscription: JSON.parse(tokenData.token) });
      } catch {
        invalidTokens.push(tokenData.token);
      }
    } else {
      fcmTokens.push(tokenData.token);
    }
  }

  const messaging = getMessaging();
  if (fcmTokens.length > 0) {
    try {
      const response = await messaging.sendEachForMulticast({
        tokens: fcmTokens,
        notification: { title: payload.title, body: payload.body },
        data: { ...(payload.data || {}), deepLink },
        webpush: { fcmOptions: { link: deepLink } },
      });
      response.responses.forEach((resp, idx) => {
        if (!resp.success && resp.error?.code === "messaging/registration-token-not-registered") {
          invalidTokens.push(fcmTokens[idx]);
        }
      });
    } catch {
      invalidTokens.push(...fcmTokens);
    }
  }

  if (webPushSubscriptions.length > 0) {
    if (!initWebPush()) {
      invalidTokens.push(...webPushSubscriptions.map((s) => s.token));
    } else {
      const webPushPayload = JSON.stringify({
        title: payload.title,
        body: payload.body,
        data: { ...(payload.data || {}), deepLink },
        icon: "/icons/icon-192x192.png",
        badge: "/icons/icon-96x96.png",
      });
      await Promise.all(
        webPushSubscriptions.map(async ({ token, subscription }) => {
          try {
            await webpush.sendNotification(subscription as webpush.PushSubscription, webPushPayload);
          } catch (error: unknown) {
            const statusCode = (error as { statusCode?: number })?.statusCode;
            if ([410, 404, 400].includes(statusCode ?? 0)) invalidTokens.push(token);
          }
        })
      );
    }
  }
  return invalidTokens;
}
