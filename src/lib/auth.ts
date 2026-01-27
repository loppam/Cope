// Authentication utilities for Twitter OAuth
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  User,
  TwitterAuthProvider,
} from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp, collection, query, where, getDocs } from 'firebase/firestore';
import { auth, db } from './firebase';

// Twitter OAuth Provider
const twitterProvider = new TwitterAuthProvider();

// Sign in with Twitter
export async function signInWithTwitter(): Promise<User> {
  try {
    const result = await signInWithPopup(auth, twitterProvider);
    const user = result.user;
    const credential = TwitterAuthProvider.credentialFromResult(result);
    
    if (!credential) {
      throw new Error('Failed to get Twitter credential');
    }

    // Extract Twitter handle from displayName
    // Twitter displayName from OAuth is usually the username without @
    let xHandle = '';
    if (user.displayName) {
      // If it already has @, use it; otherwise add @
      xHandle = user.displayName.startsWith('@') 
        ? user.displayName 
        : `@${user.displayName}`;
    } else if (user.email) {
      // Fallback: extract from email
      xHandle = `@${user.email.split('@')[0]}`;
    } else {
      // Last resort: use uid
      xHandle = `@user_${user.uid.slice(0, 8)}`;
    }

    // Get Twitter user info - complete user profile
    const twitterData = {
      uid: user.uid,
      displayName: user.displayName,
      email: user.email,
      photoURL: user.photoURL,
      xHandle: xHandle, // Twitter handle
      avatar: user.photoURL, // Profile picture
      providerId: credential.providerId,
      // Wallet data (will be set later during wallet setup)
      walletAddress: null,
      balance: 0, // SOL balance
      // Status
      walletConnected: false,
      isNew: true, // Flag to track if user needs wallet setup
      // Timestamps
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    // Save/update user profile in Firestore
    const userRef = doc(db, 'users', user.uid);
    await setDoc(userRef, twitterData, { merge: true });

    return user;
  } catch (error: any) {
    console.error('Twitter sign-in error:', error);
    
    // Handle specific error cases
    if (error.code === 'auth/popup-closed-by-user') {
      throw new Error('Sign-in was cancelled');
    } else if (error.code === 'auth/account-exists-with-different-credential') {
      throw new Error('An account already exists with a different sign-in method');
    } else if (error.code === 'auth/invalid-credential') {
      throw new Error('Twitter OAuth is not configured. Please check Firebase Console → Authentication → Sign-in method → Twitter');
    } else if (error.code === 'auth/operation-not-allowed') {
      throw new Error('Twitter sign-in is not enabled. Enable it in Firebase Console');
    } else {
      throw new Error(error.message || 'Failed to sign in with Twitter');
    }
  }
}

// Sign out
export async function signOutUser(): Promise<void> {
  try {
    await signOut(auth);
  } catch (error: any) {
    console.error('Sign-out error:', error);
    throw new Error(error.message || 'Failed to sign out');
  }
}

// Get current user
export function getCurrentUser(): User | null {
  return auth.currentUser;
}

// Subscribe to auth state changes
export function onAuthStateChange(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(auth, callback);
}

// Get user profile from Firestore
export async function getUserProfile(uid: string) {
  try {
    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);
    
    if (userSnap.exists()) {
      return userSnap.data();
    }
    return null;
  } catch (error) {
    console.error('Error getting user profile:', error);
    return null;
  }
}

// Get encrypted wallet credentials from Firestore
// Returns: { encryptedMnemonic?: string, encryptedSecretKey?: string }
export async function getEncryptedWalletCredentials(uid: string) {
  try {
    const userProfile = await getUserProfile(uid);
    if (!userProfile) {
      return null;
    }

    return {
      encryptedMnemonic: userProfile.encryptedMnemonic,
      encryptedSecretKey: userProfile.encryptedSecretKey,
    };
  } catch (error) {
    console.error('Error getting encrypted wallet credentials:', error);
    return null;
  }
}

// Check if user is authenticated
export function isAuthenticated(): boolean {
  return auth.currentUser !== null;
}

// Update user wallet information
export async function updateUserWallet(
  uid: string,
  walletAddress: string,
  balance: number = 0,
  encryptedMnemonic?: string,
  encryptedSecretKey?: string
) {
  try {
    const userRef = doc(db, 'users', uid);
    const updateData: any = {
      walletAddress,
      balance,
      walletConnected: true,
      isNew: false, // Wallet is now set up, user is no longer new
      updatedAt: serverTimestamp(),
    };

    // Only include encrypted credentials if provided
    if (encryptedMnemonic) {
      updateData.encryptedMnemonic = encryptedMnemonic;
    }
    if (encryptedSecretKey) {
      updateData.encryptedSecretKey = encryptedSecretKey;
    }

    await setDoc(userRef, updateData, { merge: true });
    return true;
  } catch (error) {
    console.error('Error updating user wallet:', error);
    throw error;
  }
}

// Update user balance
export async function updateUserBalance(uid: string, balance: number) {
  try {
    const userRef = doc(db, 'users', uid);
    await setDoc(
      userRef,
      {
        balance,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    return true;
  } catch (error) {
    console.error('Error updating user balance:', error);
    throw error;
  }
}

// Update user profile
export async function updateUserProfile(uid: string, updates: Record<string, any>) {
  try {
    const userRef = doc(db, 'users', uid);
    await setDoc(
      userRef,
      {
        ...updates,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    return true;
  } catch (error) {
    console.error('Error updating user profile:', error);
    throw error;
  }
}

// Remove wallet (delete wallet and reset isNew flag)
export async function removeUserWallet(uid: string) {
  try {
    const userRef = doc(db, 'users', uid);
    await setDoc(
      userRef,
      {
        walletAddress: null,
        balance: 0,
        walletConnected: false,
        isNew: true, // Reset to new user state
        encryptedMnemonic: null,
        encryptedSecretKey: null,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    return true;
  } catch (error) {
    console.error('Error removing user wallet:', error);
    throw error;
  }
}

// Watchlist interfaces
export interface WatchedWallet {
  address: string;
  addedAt: any; // Date object (can't use serverTimestamp() in arrays)
  nickname?: string;
  matched?: number; // Number of tokens matched (from scanner)
  totalInvested?: number;
  totalRemoved?: number;
  profitMargin?: number;
  updatedAt?: any; // Date object (can't use serverTimestamp() in arrays)
  lastCheckedAt?: any; // Firestore timestamp - last time we checked for transactions
  lastTransactionHash?: string; // Last transaction hash we've seen
}

// Add wallet to user's watchlist
export async function addWalletToWatchlist(
  uid: string,
  walletAddress: string,
  walletData?: {
    nickname?: string;
    matched?: number;
    totalInvested?: number;
    totalRemoved?: number;
    profitMargin?: number;
  }
) {
  try {
    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);
    
    if (!userSnap.exists()) {
      throw new Error('User not found');
    }

    const userData = userSnap.data();
    const watchlist: WatchedWallet[] = userData.watchlist || [];

    // Check if wallet is already in watchlist
    const existingIndex = watchlist.findIndex(w => w.address === walletAddress);
    
    if (existingIndex >= 0) {
      // Update existing entry
      watchlist[existingIndex] = {
        ...watchlist[existingIndex],
        ...walletData,
        updatedAt: new Date(),
      };
    } else {
      // Add new wallet to watchlist
      // Note: Can't use serverTimestamp() inside arrays, so we use Date
      watchlist.push({
        address: walletAddress,
        addedAt: new Date(),
        ...walletData,
      });
    }

    await setDoc(
      userRef,
      {
        watchlist,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return true;
  } catch (error) {
    console.error('Error adding wallet to watchlist:', error);
    throw error;
  }
}

// Remove wallet from user's watchlist
export async function removeWalletFromWatchlist(uid: string, walletAddress: string) {
  try {
    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);
    
    if (!userSnap.exists()) {
      throw new Error('User not found');
    }

    const userData = userSnap.data();
    const watchlist: WatchedWallet[] = userData.watchlist || [];

    // Remove wallet from watchlist
    const filteredWatchlist = watchlist.filter(w => w.address !== walletAddress);

    await setDoc(
      userRef,
      {
        watchlist: filteredWatchlist,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return true;
  } catch (error) {
    console.error('Error removing wallet from watchlist:', error);
    throw error;
  }
}

// Get user's watchlist
export async function getWatchlist(uid: string): Promise<WatchedWallet[]> {
  try {
    const userProfile = await getUserProfile(uid);
    return userProfile?.watchlist || [];
  } catch (error) {
    console.error('Error getting watchlist:', error);
    return [];
  }
}

// Update wallet nickname in watchlist
export async function updateWatchedWalletNickname(
  uid: string,
  walletAddress: string,
  nickname: string
) {
  try {
    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);
    
    if (!userSnap.exists()) {
      throw new Error('User not found');
    }

    const userData = userSnap.data();
    const watchlist: WatchedWallet[] = userData.watchlist || [];

    // Update nickname for the wallet
    // Note: Can't use serverTimestamp() inside arrays, so we use Date
    const updatedWatchlist = watchlist.map(w => 
      w.address === walletAddress 
        ? { ...w, nickname, updatedAt: new Date() }
        : w
    );

    await setDoc(
      userRef,
      {
        watchlist: updatedWatchlist,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return true;
  } catch (error) {
    console.error('Error updating wallet nickname:', error);
    throw error;
  }
}

// Find user by wallet address
// Returns user data if wallet is found in database, null otherwise
export async function findUserByWalletAddress(walletAddress: string) {
  try {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('walletAddress', '==', walletAddress));
    const snapshot = await getDocs(q);
    
    if (snapshot.empty) {
      return null;
    }

    // Get the first matching user (should only be one)
    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();
    
    return {
      uid: userDoc.id,
      displayName: userData.displayName || userData.xHandle || null,
      xHandle: userData.xHandle || null,
      avatar: userData.avatar || userData.photoURL || null,
      walletAddress: userData.walletAddress,
      // Add any other user data you want to return
    };
  } catch (error) {
    console.error('Error finding user by wallet address:', error);
    return null;
  }
}
