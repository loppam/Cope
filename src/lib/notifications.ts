import {
  doc,
  setDoc,
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  serverTimestamp,
} from "firebase/firestore";
import { auth, db } from "./firebase";
import { requestFirebaseMessagingToken } from "./firebase";

const PUSH_TOKEN_KEY = "cope_push_token";
const PUSH_REGISTER_URL = "/api/push/register";
const PUSH_STATUS_URL = "/api/push/status";

// Detect if browser is Safari (including iOS Safari)
function isSafari(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent.toLowerCase();
  const isIOS =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isSafariUA =
    ua.includes("safari") && !ua.includes("chrome") && !ua.includes("crios");
  return isSafariUA || isIOS;
}

export interface WalletNotification {
  id: string;
  userId: string;
  walletAddress: string;
  type: "transaction" | "buy" | "sell" | "swap";
  title: string;
  message: string;
  txHash?: string;
  tokenAddress?: string;
  amount?: number;
  amountUsd?: number;
  read: boolean;
  deleted?: boolean;
  createdAt: any; // Firestore timestamp
}

async function getIdToken(): Promise<string | null> {
  if (!auth.currentUser) {
    return null;
  }
  return await auth.currentUser.getIdToken();
}

async function sendAuthRequest(method: string, body?: Record<string, any>) {
  const idToken = await getIdToken();
  if (!idToken) {
    throw new Error("User not authenticated");
  }

  return fetch(PUSH_REGISTER_URL, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/**
 * Subscribe to Web Push API (for Safari/iOS)
 * Returns the subscription object as JSON string
 */
async function subscribeToWebPush(): Promise<string | null> {
  if (!("serviceWorker" in navigator)) {
    console.error(
      "[Notifications] Service Worker not supported - required for Web Push",
    );
    return null;
  }

  if (!("PushManager" in window)) {
    console.error(
      "[Notifications] PushManager not supported - iOS 16.4+ required for Web Push",
    );
    return null;
  }

  try {
    // Get service worker registration
    const registration = await navigator.serviceWorker.ready;
    console.log("[Notifications] Service Worker ready:", registration.scope);

    // Get VAPID public key
    const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
    if (!vapidKey) {
      console.error(
        "[Notifications] VAPID key missing for Web Push - check VITE_FIREBASE_VAPID_KEY",
      );
      return null;
    }
    console.log(
      "[Notifications] VAPID key found:",
      vapidKey.substring(0, 20) + "...",
    );

    // Convert VAPID key to Uint8Array (required by Web Push API)
    const vapidKeyBytes = urlBase64ToUint8Array(vapidKey);

    // Check if already subscribed
    const existingSubscription =
      await registration.pushManager.getSubscription();
    if (existingSubscription) {
      console.log("[Notifications] Using existing Web Push subscription");
      return JSON.stringify(existingSubscription);
    }

    // Subscribe to push notifications
    console.log("[Notifications] Creating new Web Push subscription...");
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: vapidKeyBytes,
    });

    console.log("[Notifications] Web Push subscription created successfully:", {
      endpoint: subscription.endpoint?.substring(0, 50) + "...",
      hasKeys: !!(subscription as any).keys,
    });

    // Return subscription as JSON string
    return JSON.stringify(subscription);
  } catch (error: any) {
    console.error("[Notifications] Web Push subscription failed:", {
      error: error.message,
      name: error.name,
      stack: error.stack,
    });

    // Provide helpful error messages
    if (error.name === "NotAllowedError") {
      console.error(
        "[Notifications] Permission denied - user must grant notification permission",
      );
    } else if (error.name === "NotSupportedError") {
      console.error(
        "[Notifications] Web Push not supported - ensure iOS 16.4+ and PWA is installed",
      );
    }

    return null;
  }
}

/**
 * Convert VAPID key from base64 URL to Uint8Array
 */
function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Unified function to get push token/subscription
 * Returns: { token: string, platform: 'fcm' | 'webpush' }
 */
export async function requestPermissionAndGetPushToken(): Promise<{
  token: string;
  platform: "fcm" | "webpush";
} | null> {
  if (typeof Notification === "undefined") {
    console.warn("[Notifications] Notification API not available");
    return null;
  }

  // Request permission first
  if (Notification.permission === "denied") {
    console.warn("[Notifications] Notification permission denied by user");
    return null;
  }

  if (Notification.permission !== "granted") {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.warn("[Notifications] User denied notification permission");
      return null;
    }
  }

  const isSafariBrowser = isSafari();

  // For Safari/iOS: Use Web Push API
  if (isSafariBrowser) {
    console.info("[Notifications] Using Web Push API for Safari/iOS");
    const subscription = await subscribeToWebPush();
    if (subscription) {
      return { token: subscription, platform: "webpush" };
    }
    return null;
  }

  // For other browsers: Try FCM first
  try {
    const fcmToken = await requestFirebaseMessagingToken();
    if (fcmToken) {
      return { token: fcmToken, platform: "fcm" };
    }
  } catch (error: any) {
    const errorCode = error?.code || "";
    const errorMessage = error?.message || "";

    // If FCM fails, try Web Push as fallback
    if (
      errorCode === "messaging/unsupported-browser" ||
      errorMessage.includes("unsupported")
    ) {
      console.info("[Notifications] FCM not supported, trying Web Push API...");
      const subscription = await subscribeToWebPush();
      if (subscription) {
        return { token: subscription, platform: "webpush" };
      }
    } else {
      console.error("[Notifications] Error requesting FCM token:", error);
    }
  }

  return null;
}

/**
 * Legacy function name for backward compatibility
 * @deprecated Use requestPermissionAndGetPushToken instead
 */
export async function requestPermissionAndGetFcmToken(): Promise<
  string | null
> {
  const result = await requestPermissionAndGetPushToken();
  return result?.token || null;
}

// Export helper to check if Safari
export function isSafariBrowser(): boolean {
  return isSafari();
}

export function getStoredPushToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(PUSH_TOKEN_KEY);
}

function setStoredPushToken(token: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PUSH_TOKEN_KEY, token);
}

function clearStoredPushToken() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(PUSH_TOKEN_KEY);
}

export async function savePushToken(
  token: string,
  platform: string = "web",
): Promise<void> {
  if (!token) return;
  await sendAuthRequest("POST", { token, platform });
  setStoredPushToken(token);
}

/**
 * Save push token with platform detection
 */
export async function savePushTokenWithPlatform(
  token: string,
  platform: "fcm" | "webpush",
): Promise<void> {
  await savePushToken(token, platform);
}

export async function unregisterPushToken(token: string): Promise<void> {
  if (!token) return;
  await sendAuthRequest("DELETE", { token });
  clearStoredPushToken();
}

export async function getPushNotificationStatus(): Promise<{
  enabled: boolean;
  permission: NotificationPermission;
}> {
  const permission =
    typeof Notification !== "undefined" ? Notification.permission : "denied";

  try {
    const idToken = await getIdToken();
    if (!idToken) {
      return { enabled: !!getStoredPushToken(), permission };
    }
    const response = await fetch(PUSH_STATUS_URL, {
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });
    if (!response.ok) {
      return { enabled: !!getStoredPushToken(), permission };
    }
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) {
      return { enabled: !!getStoredPushToken(), permission };
    }
    const data = await response.json();
    return { enabled: data.enabled, permission };
  } catch (error) {
    console.error("Error getting push notification status:", error);
    return {
      enabled: !!getStoredPushToken(),
      permission,
    };
  }
}

export async function refreshPushToken(
  platform: string = "web",
): Promise<void> {
  const token = getStoredPushToken();
  if (!token) return;
  await savePushToken(token, platform);
}

/**
 * Create a notification for a user about a watched wallet transaction
 */
export async function createNotification(
  userId: string,
  walletAddress: string,
  notification: {
    type: "transaction" | "buy" | "sell" | "swap";
    title: string;
    message: string;
    txHash?: string;
    tokenAddress?: string;
    amount?: number;
    amountUsd?: number;
  },
): Promise<void> {
  try {
    const notificationRef = doc(collection(db, "notifications"));
    await setDoc(notificationRef, {
      userId,
      walletAddress,
      ...notification,
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    console.error("Error creating notification:", error);
    throw error;
  }
}

/**
 * Get user's notifications (unread first, then by date)
 */
export async function getUserNotifications(
  userId: string,
  limitCount: number = 50,
): Promise<WalletNotification[]> {
  try {
    const notificationsRef = collection(db, "notifications");
    const q = query(
      notificationsRef,
      where("userId", "==", userId),
      orderBy("createdAt", "desc"),
      limit(limitCount),
    );

    const snapshot = await getDocs(q);
    const notifications = snapshot.docs
      .map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
        } as WalletNotification;
      })
      .filter((n) => !n.deleted);

    return notifications;
  } catch (error: any) {
    if (error.code === "failed-precondition") {
      try {
        const notificationsRef = collection(db, "notifications");
        const q = query(
          notificationsRef,
          where("userId", "==", userId),
          limit(limitCount),
        );
        const snapshot = await getDocs(q);
        const notifications = snapshot.docs
          .map((doc) => ({
            id: doc.id,
            ...doc.data(),
          }))
          .filter((n: any) => !n.deleted) as WalletNotification[];
        return notifications.sort((a, b) => {
          const aTime = a.createdAt?.toDate?.()?.getTime() || 0;
          const bTime = b.createdAt?.toDate?.()?.getTime() || 0;
          return bTime - aTime;
        });
      } catch (fallbackError) {
        console.error("Error getting notifications (fallback):", fallbackError);
        return [];
      }
    }
    console.error("Error getting notifications:", error);
    return [];
  }
}

/**
 * Mark notification as read
 */
export async function markNotificationAsRead(
  notificationId: string,
): Promise<void> {
  try {
    const notificationRef = doc(db, "notifications", notificationId);
    await setDoc(notificationRef, { read: true }, { merge: true });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    throw error;
  }
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllNotificationsAsRead(
  userId: string,
): Promise<void> {
  try {
    const notificationsRef = collection(db, "notifications");
    const q = query(
      notificationsRef,
      where("userId", "==", userId),
      where("read", "==", false),
    );

    const snapshot = await getDocs(q);
    const batch = snapshot.docs.map((doc) =>
      setDoc(doc.ref, { read: true }, { merge: true }),
    );

    await Promise.all(batch);
  } catch (error) {
    console.error("Error marking all notifications as read:", error);
    throw error;
  }
}

/**
 * Delete a notification
 */
export async function deleteNotification(
  notificationId: string,
): Promise<void> {
  try {
    const notificationRef = doc(db, "notifications", notificationId);
    await setDoc(notificationRef, { deleted: true }, { merge: true });
  } catch (error) {
    console.error("Error deleting notification:", error);
    throw error;
  }
}

/**
 * Get unread notification count for a user
 */
export async function getUnreadNotificationCount(
  userId: string,
): Promise<number> {
  try {
    const notificationsRef = collection(db, "notifications");
    const q = query(
      notificationsRef,
      where("userId", "==", userId),
      where("read", "==", false),
    );

    const snapshot = await getDocs(q);
    return snapshot.size;
  } catch (error) {
    console.error("Error getting unread notification count:", error);
    return 0;
  }
}
