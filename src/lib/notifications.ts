import {
  doc,
  setDoc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { requestFirebaseMessagingToken } from './firebase';
import { toast } from 'sonner';

const PUSH_TOKEN_KEY = 'cope_push_token';
const PUSH_REGISTER_URL = '/api/push/register';
const PUSH_STATUS_URL = '/api/push/status';

export interface WalletNotification {
  id: string;
  userId: string;
  walletAddress: string;
  type: 'transaction' | 'large_trade' | 'token_swap';
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
    throw new Error('User not authenticated');
  }

  return fetch(PUSH_REGISTER_URL, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

export async function requestPermissionAndGetFcmToken(): Promise<string | null> {
  if (typeof Notification === 'undefined') {
    return null;
  }

  if (Notification.permission === 'denied') {
    return null;
  }

  if (Notification.permission !== 'granted') {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      return null;
    }
  }

  return await requestFirebaseMessagingToken();
}

export function getStoredPushToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(PUSH_TOKEN_KEY);
}

function setStoredPushToken(token: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(PUSH_TOKEN_KEY, token);
}

function clearStoredPushToken() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(PUSH_TOKEN_KEY);
}

export async function savePushToken(token: string, platform: string = 'web'): Promise<void> {
  if (!token) return;
  await sendAuthRequest('POST', { token, platform });
  setStoredPushToken(token);
}

export async function unregisterPushToken(token: string): Promise<void> {
  if (!token) return;
  await sendAuthRequest('DELETE', { token });
  clearStoredPushToken();
}

export async function getPushNotificationStatus(): Promise<{
  enabled: boolean;
  permission: NotificationPermission;
}> {
  const permission =
    typeof Notification !== 'undefined' ? Notification.permission : 'denied';

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
    const data = await response.json();
    return { enabled: data.enabled, permission };
  } catch (error) {
    console.error('Error getting push notification status:', error);
    return {
      enabled: !!getStoredPushToken(),
      permission,
    };
  }
}

export async function refreshPushToken(platform: string = 'web'): Promise<void> {
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
    type: 'transaction' | 'large_trade' | 'token_swap';
    title: string;
    message: string;
    txHash?: string;
    tokenAddress?: string;
    amount?: number;
    amountUsd?: number;
  }
): Promise<void> {
  try {
    const notificationRef = doc(collection(db, 'notifications'));
    await setDoc(notificationRef, {
      userId,
      walletAddress,
      ...notification,
      read: false,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    console.error('Error creating notification:', error);
    throw error;
  }
}

/**
 * Get user's notifications (unread first, then by date)
 */
export async function getUserNotifications(
  userId: string,
  limitCount: number = 50
): Promise<WalletNotification[]> {
  try {
    const notificationsRef = collection(db, 'notifications');
    const q = query(
      notificationsRef,
      where('userId', '==', userId),
      orderBy('createdAt', 'desc'),
      limit(limitCount)
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
    if (error.code === 'failed-precondition') {
      try {
        const notificationsRef = collection(db, 'notifications');
        const q = query(
          notificationsRef,
          where('userId', '==', userId),
          limit(limitCount)
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
        console.error('Error getting notifications (fallback):', fallbackError);
        return [];
      }
    }
    console.error('Error getting notifications:', error);
    return [];
  }
}

/**
 * Mark notification as read
 */
export async function markNotificationAsRead(notificationId: string): Promise<void> {
  try {
    const notificationRef = doc(db, 'notifications', notificationId);
    await setDoc(
      notificationRef,
      { read: true },
      { merge: true }
    );
  } catch (error) {
    console.error('Error marking notification as read:', error);
    throw error;
  }
}

/**
 * Mark all notifications as read for a user
 */
export async function markAllNotificationsAsRead(userId: string): Promise<void> {
  try {
    const notificationsRef = collection(db, 'notifications');
    const q = query(
      notificationsRef,
      where('userId', '==', userId),
      where('read', '==', false)
    );
    
    const snapshot = await getDocs(q);
    const batch = snapshot.docs.map(doc => 
      setDoc(doc.ref, { read: true }, { merge: true })
    );
    
    await Promise.all(batch);
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    throw error;
  }
}

/**
 * Delete a notification
 */
export async function deleteNotification(notificationId: string): Promise<void> {
  try {
    const notificationRef = doc(db, 'notifications', notificationId);
    await setDoc(notificationRef, { deleted: true }, { merge: true });
  } catch (error) {
    console.error('Error deleting notification:', error);
    throw error;
  }
}

/**
 * Get unread notification count for a user
 */
export async function getUnreadNotificationCount(userId: string): Promise<number> {
  try {
    const notificationsRef = collection(db, 'notifications');
    const q = query(
      notificationsRef,
      where('userId', '==', userId),
      where('read', '==', false)
    );
    
    const snapshot = await getDocs(q);
    return snapshot.size;
  } catch (error) {
    console.error('Error getting unread notification count:', error);
    return 0;
  }
}
