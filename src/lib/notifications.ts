// Notification system for watched wallet transactions
import { doc, setDoc, getDoc, collection, query, where, getDocs, orderBy, limit, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

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
    return snapshot.docs
      .map(doc => ({
        id: doc.id,
        ...doc.data(),
      }))
      .filter(n => !n.deleted) as WalletNotification[];
  } catch (error: any) {
    // If index doesn't exist, try without orderBy
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
          .map(doc => ({
            id: doc.id,
            ...doc.data(),
          }))
          .filter(n => !n.deleted) as WalletNotification[];
        // Sort manually by createdAt
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
    // Note: In production, you might want to actually delete the document
    // For now, we'll just mark it as deleted
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
