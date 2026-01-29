// Authentication utilities for Twitter OAuth
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
  User,
  TwitterAuthProvider,
} from "firebase/auth";
import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
  collection,
  query,
  where,
  getDocs,
  limit,
  orderBy,
} from "firebase/firestore";
import { auth, db } from "./firebase";

// Twitter OAuth Provider
const twitterProvider = new TwitterAuthProvider();

// Get the Firebase callback URL that needs to be configured in Twitter Developer Portal
export function getFirebaseCallbackUrl(): string {
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN;
  if (!authDomain) {
    return "Please set VITE_FIREBASE_AUTH_DOMAIN in your .env file";
  }
  return `https://${authDomain}/__/auth/handler`;
}

// Detect if user is on a mobile device
function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;
  return (
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent,
    ) ||
    (window.innerWidth <= 768 && window.innerHeight <= 1024)
  );
}

// Helper function to save user profile data
// IMPORTANT: This function preserves existing wallet data - it only sets wallet fields
// if they don't already exist (for new users only)
async function saveUserProfile(user: User, credential: any): Promise<void> {
  // Extract Twitter handle from displayName
  let xHandle = "";
  if (user.displayName) {
    xHandle = user.displayName.startsWith("@")
      ? user.displayName
      : `@${user.displayName}`;
  } else if (user.email) {
    xHandle = `@${user.email.split("@")[0]}`;
  } else {
    xHandle = `@user_${user.uid.slice(0, 8)}`;
  }

  // Check if user already exists and has wallet data
  const userRef = doc(db, "users", user.uid);
  const existingDoc = await getDoc(userRef);
  const existingData = existingDoc.exists() ? existingDoc.data() : null;

  // Only set wallet fields if user doesn't exist or doesn't have a wallet
  // This prevents overwriting existing wallet data on login
  const hasExistingWallet =
    existingData?.walletAddress && existingData?.encryptedSecretKey;

  const twitterData: any = {
    uid: user.uid,
    displayName: user.displayName,
    email: user.email,
    photoURL: user.photoURL,
    xHandle: xHandle,
    avatar: user.photoURL,
    providerId: credential.providerId,
    isPublic:
      existingData?.isPublic !== undefined ? existingData.isPublic : true, // Preserve existing or default to public
    updatedAt: serverTimestamp(),
  };

  // Only set wallet-related fields for NEW users (no existing wallet)
  // This prevents overwriting wallet data when existing users log in
  if (!hasExistingWallet) {
    twitterData.walletAddress = null;
    twitterData.balance = 0;
    twitterData.walletConnected = false;
    twitterData.isNew = true;
  }
  // If user already exists, preserve their wallet fields (don't include them in update)

  // Only set createdAt for new users
  if (!existingDoc.exists()) {
    twitterData.createdAt = serverTimestamp();
  }

  await setDoc(userRef, twitterData, { merge: true });
}

// Sign in with Twitter - uses redirect on mobile, popup on desktop
export async function signInWithTwitter(): Promise<User | void> {
  try {
    // Use redirect on mobile devices to avoid popup blocking
    if (isMobileDevice()) {
      await signInWithRedirect(auth, twitterProvider);
      // Note: signInWithRedirect doesn't return a user immediately
      // The user will be redirected to Twitter, then back to the app
      // We handle the redirect result in handleRedirectResult()
      return;
    }

    // Use popup on desktop
    const result = await signInWithPopup(auth, twitterProvider);
    const user = result.user;
    const credential = TwitterAuthProvider.credentialFromResult(result);

    if (!credential) {
      throw new Error("Failed to get Twitter credential");
    }

    await saveUserProfile(user, credential);
    return user;
  } catch (error: any) {
    console.error("Twitter sign-in error:", error);

    // Check if error message contains Twitter's suspicious login message
    const errorMessage = error.message || "";
    if (
      errorMessage.includes("suspicious") ||
      errorMessage.includes("blocked") ||
      errorMessage.includes("prevented")
    ) {
      throw new Error(
        "Twitter blocked the login attempt. Please check TWITTER_OAUTH_MOBILE_FIX.md for configuration steps. You may need to wait 24 hours before trying again.",
      );
    }

    // Handle specific error cases
    if (
      error.code === "auth/popup-closed-by-user" ||
      error.code === "auth/redirect-cancelled-by-user"
    ) {
      throw new Error("Sign-in was cancelled");
    } else if (error.code === "auth/account-exists-with-different-credential") {
      throw new Error(
        "An account already exists with a different sign-in method",
      );
    } else if (error.code === "auth/invalid-credential") {
      throw new Error(
        "Twitter OAuth is not configured. Please check Firebase Console → Authentication → Sign-in method → Twitter",
      );
    } else if (error.code === "auth/operation-not-allowed") {
      throw new Error(
        "Twitter sign-in is not enabled. Enable it in Firebase Console",
      );
    } else {
      throw new Error(error.message || "Failed to sign in with Twitter");
    }
  }
}

// Handle redirect result when user returns from Twitter OAuth
export async function handleRedirectResult(): Promise<User | null> {
  try {
    // Check if we're coming back from a redirect (mobile browsers)
    // Firebase stores redirect state in sessionStorage, but mobile browsers
    // might clear it. Check URL params as a fallback indicator.
    const urlParams = new URLSearchParams(window.location.search);
    const hasRedirectParams =
      urlParams.has("mode") ||
      urlParams.has("oobCode") ||
      urlParams.has("apiKey") ||
      window.location.hash.includes("__/auth/");

    console.log("[Auth] Checking redirect result...", {
      hasRedirectParams,
      url: window.location.href,
      hash: window.location.hash,
    });

    // Wait a brief moment for Firebase to initialize (mobile browsers may need this)
    await new Promise((resolve) => setTimeout(resolve, 100));

    const result = await getRedirectResult(auth);

    if (result) {
      console.log("[Auth] Redirect result found:", {
        uid: result.user.uid,
        email: result.user.email,
        displayName: result.user.displayName,
      });

      const user = result.user;
      const credential = TwitterAuthProvider.credentialFromResult(result);

      if (!credential) {
        console.error("[Auth] Failed to get Twitter credential from redirect");
        return null;
      }

      await saveUserProfile(user, credential);
      console.log("[Auth] User profile saved successfully");
      return user;
    } else if (hasRedirectParams) {
      // We have redirect params but no result - might be a timing issue
      console.warn(
        "[Auth] Redirect params detected but no result. This might indicate:",
      );
      console.warn("1. Redirect was already processed");
      console.warn("2. Mobile browser cleared sessionStorage");
      console.warn(
        "3. Timing issue - auth state might update via onAuthStateChanged",
      );

      // Fallback: Check if user is already authenticated (redirect might have worked)
      // This can happen on mobile browsers where sessionStorage is cleared
      const currentUser = auth.currentUser;
      if (currentUser) {
        console.log(
          "[Auth] User already authenticated, redirect may have succeeded:",
          currentUser.uid,
        );
        // Ensure profile exists (it might not have been saved if redirect was missed)
        try {
          let profile = await getUserProfile(currentUser.uid);
          if (!profile) {
            console.log("[Auth] Profile missing, creating it now...");
            // Create a basic credential-like object for saveUserProfile
            await saveUserProfile(currentUser, { providerId: "twitter.com" });
            // Fetch the newly created profile
            profile = await getUserProfile(currentUser.uid);
            console.log("[Auth] Profile created and fetched:", profile);
          } else {
            console.log("[Auth] Profile found in fallback:", {
              walletAddress: profile.walletAddress,
              isNew: profile.isNew,
            });
          }
          return currentUser;
        } catch (error) {
          console.error("[Auth] Error checking/creating profile:", error);
          // Still return user even if profile fetch fails - onAuthStateChange will handle it
          return currentUser;
        }
      }
    }

    return null;
  } catch (error: any) {
    console.error("[Auth] Error handling redirect result:", error);
    console.error("[Auth] Error details:", {
      code: error.code,
      message: error.message,
      stack: error.stack,
    });

    // Check if error message contains Twitter's suspicious login message
    const errorMessage = error.message || "";
    if (
      errorMessage.includes("suspicious") ||
      errorMessage.includes("blocked") ||
      errorMessage.includes("prevented")
    ) {
      throw new Error(
        "Twitter blocked the login attempt. Please check TWITTER_OAUTH_MOBILE_FIX.md for configuration steps. You may need to wait 24 hours before trying again.",
      );
    }

    // Don't throw for "no redirect" errors - this is normal when there's no pending redirect
    if (
      error.code === "auth/no-auth-event" ||
      errorMessage.includes("no redirect")
    ) {
      console.log("[Auth] No pending redirect (this is normal)");
      return null;
    }

    throw error;
  }
}

// Sign out
export async function signOutUser(): Promise<void> {
  try {
    await signOut(auth);
  } catch (error: any) {
    console.error("Sign-out error:", error);
    throw new Error(error.message || "Failed to sign out");
  }
}

// Get current user
export function getCurrentUser(): User | null {
  return auth.currentUser;
}

// Subscribe to auth state changes
export function onAuthStateChange(
  callback: (user: User | null) => void,
): () => void {
  return onAuthStateChanged(auth, callback);
}

// Get user profile from Firestore
export async function getUserProfile(uid: string) {
  try {
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      return userSnap.data();
    }
    return null;
  } catch (error) {
    console.error("Error getting user profile:", error);
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
    console.error("Error getting encrypted wallet credentials:", error);
    return null;
  }
}

// Check if user is authenticated
export function isAuthenticated(): boolean {
  return auth.currentUser !== null;
}

// Update user wallet information
// This function ensures all wallet-related fields are set consistently
// for both generated and imported wallets
export async function updateUserWallet(
  uid: string,
  walletAddress: string,
  balance: number = 0,
  encryptedMnemonic?: string,
  encryptedSecretKey?: string,
) {
  try {
    // Validate wallet address is provided
    if (
      !walletAddress ||
      typeof walletAddress !== "string" ||
      walletAddress.trim() === ""
    ) {
      throw new Error(
        "Wallet address is required and must be a non-empty string",
      );
    }

    const userRef = doc(db, "users", uid);

    // Always set all wallet-related fields explicitly for consistency
    // This ensures generated and imported wallets have the same structure
    const updateData: any = {
      walletAddress: walletAddress.trim(), // Explicitly set wallet address (trimmed)
      balance: balance || 0, // Explicitly set balance (default to 0)
      walletConnected: true, // Wallet is connected - always true when wallet is set up
      isNew: false, // Wallet is now set up, user is no longer new
      isPublic: true, // Default to public if not already set
      updatedAt: serverTimestamp(),
      // Always include encrypted credentials fields for consistency
      // Set to null if not provided (e.g., when importing from private key without mnemonic)
      encryptedMnemonic: encryptedMnemonic || null,
      encryptedSecretKey: encryptedSecretKey || null,
    };

    // Use setDoc with merge to ensure atomic update of all fields
    // This prevents partial updates that could leave the document in an inconsistent state
    await setDoc(userRef, updateData, { merge: true });

    // Verify the update succeeded by reading back the document
    const updatedDoc = await getDoc(userRef);
    if (!updatedDoc.exists()) {
      throw new Error("Failed to verify wallet update: document not found");
    }

    const updatedData = updatedDoc.data();
    if (updatedData.walletAddress !== walletAddress.trim()) {
      throw new Error(
        `Wallet update verification failed: walletAddress mismatch`,
      );
    }

    if (updatedData.walletConnected !== true) {
      throw new Error(
        "Wallet update verification failed: walletConnected is not true",
      );
    }

    if (updatedData.isNew !== false) {
      throw new Error("Wallet update verification failed: isNew is not false");
    }

    return true;
  } catch (error) {
    console.error("Error updating user wallet:", error);
    throw error;
  }
}

// Update user balance
export async function updateUserBalance(uid: string, balance: number) {
  try {
    const userRef = doc(db, "users", uid);
    await setDoc(
      userRef,
      {
        balance,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    return true;
  } catch (error) {
    console.error("Error updating user balance:", error);
    throw error;
  }
}

// Update user profile
export async function updateUserProfile(
  uid: string,
  updates: Record<string, any>,
) {
  try {
    const userRef = doc(db, "users", uid);
    await setDoc(
      userRef,
      {
        ...updates,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    return true;
  } catch (error) {
    console.error("Error updating user profile:", error);
    throw error;
  }
}

// Remove wallet (delete wallet and reset isNew flag)
export async function removeUserWallet(uid: string) {
  try {
    const userRef = doc(db, "users", uid);
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
      { merge: true },
    );
    return true;
  } catch (error) {
    console.error("Error removing user wallet:", error);
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
  },
) {
  try {
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      throw new Error("User not found");
    }

    const userData = userSnap.data();
    const watchlist: WatchedWallet[] = userData.watchlist || [];

    // Check if wallet is already in watchlist
    const existingIndex = watchlist.findIndex(
      (w) => w.address === walletAddress,
    );

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
      { merge: true },
    );

    return true;
  } catch (error) {
    console.error("Error adding wallet to watchlist:", error);
    throw error;
  }
}

// Remove wallet from user's watchlist
export async function removeWalletFromWatchlist(
  uid: string,
  walletAddress: string,
) {
  try {
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      throw new Error("User not found");
    }

    const userData = userSnap.data();
    const watchlist: WatchedWallet[] = userData.watchlist || [];

    // Remove wallet from watchlist
    const filteredWatchlist = watchlist.filter(
      (w) => w.address !== walletAddress,
    );

    await setDoc(
      userRef,
      {
        watchlist: filteredWatchlist,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    return true;
  } catch (error) {
    console.error("Error removing wallet from watchlist:", error);
    throw error;
  }
}

// Get user's watchlist
export async function getWatchlist(uid: string): Promise<WatchedWallet[]> {
  try {
    const userProfile = await getUserProfile(uid);
    return userProfile?.watchlist || [];
  } catch (error) {
    console.error("Error getting watchlist:", error);
    return [];
  }
}

// Update wallet nickname in watchlist
export async function updateWatchedWalletNickname(
  uid: string,
  walletAddress: string,
  nickname: string,
) {
  try {
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      throw new Error("User not found");
    }

    const userData = userSnap.data();
    const watchlist: WatchedWallet[] = userData.watchlist || [];

    // Update nickname for the wallet
    // Note: Can't use serverTimestamp() inside arrays, so we use Date
    const updatedWatchlist = watchlist.map((w) =>
      w.address === walletAddress
        ? { ...w, nickname, updatedAt: new Date() }
        : w,
    );

    await setDoc(
      userRef,
      {
        watchlist: updatedWatchlist,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );

    return true;
  } catch (error) {
    console.error("Error updating wallet nickname:", error);
    throw error;
  }
}

// Find user by wallet address
// Returns user data if wallet is found in database, null otherwise
// Respects privacy: only returns if user is public OR if searching by exact wallet address
export async function findUserByWalletAddress(
  walletAddress: string,
  requirePublic: boolean = false,
) {
  try {
    const usersRef = collection(db, "users");
    const q = query(usersRef, where("walletAddress", "==", walletAddress));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return null;
    }

    // Get the first matching user (should only be one)
    const userDoc = snapshot.docs[0];
    const userData = userDoc.data();

    // If requirePublic is true, only return if user is public
    // Default to public if isPublic field doesn't exist (for existing users)
    // Only filter out if isPublic is explicitly false
    const isPublic = userData.isPublic !== false; // Default to true if undefined/null
    if (requirePublic && !isPublic) {
      return null;
    }

    return {
      uid: userDoc.id,
      displayName: userData.displayName || userData.xHandle || null,
      xHandle: userData.xHandle || null,
      avatar: userData.avatar || userData.photoURL || null,
      walletAddress: userData.walletAddress,
      isPublic: userData.isPublic !== false, // Default to true if undefined
      // Add any other user data you want to return
    };
  } catch (error) {
    console.error("Error finding user by wallet address:", error);
    return null;
  }
}

// Find user by X handle (Twitter username)
// Only returns public users (or users without isPublic field - treated as public by default)
export async function findUserByXHandle(xHandle: string) {
  try {
    // Normalize handle - ensure it starts with @
    const normalizedHandle = xHandle.startsWith("@")
      ? xHandle.toLowerCase()
      : `@${xHandle.toLowerCase()}`;

    const usersRef = collection(db, "users");
    // Query for users with matching X handle
    // Note: Firestore doesn't support != null queries well, so we query all and filter
    const q = query(usersRef, where("xHandle", "==", normalizedHandle));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return null;
    }

    // Filter for public users with wallets (treat missing isPublic as public)
    const publicUsers = snapshot.docs.filter((doc) => {
      const data = doc.data();
      // User must have a wallet address
      if (!data.walletAddress) {
        return false;
      }
      // User is public if isPublic is not explicitly false
      return data.isPublic !== false;
    });

    if (publicUsers.length === 0) {
      return null;
    }

    // Get the first matching public user
    const userDoc = publicUsers[0];
    const userData = userDoc.data();

    return {
      uid: userDoc.id,
      displayName: userData.displayName || userData.xHandle || null,
      xHandle: userData.xHandle || null,
      avatar: userData.avatar || userData.photoURL || null,
      walletAddress: userData.walletAddress,
      isPublic: userData.isPublic !== false, // Default to true if undefined
    };
  } catch (error) {
    console.error("Error finding user by X handle:", error);
    return null;
  }
}

// User search result (public users only; absence of isPublic means true)
export interface UserSearchResult {
  uid: string;
  displayName: string | null;
  xHandle: string | null;
  avatar: string | null;
  walletAddress: string;
  isPublic?: boolean;
}

// Search users by X handle prefix (for dropdown suggestions)
// Only returns public users; absence of isPublic field is treated as true
export async function searchUsersByHandle(
  handleQuery: string,
  limitCount: number = 20,
): Promise<UserSearchResult[]> {
  try {
    const trimmed = handleQuery.trim();
    if (!trimmed.length) return [];

    const normalizedPrefix = trimmed.startsWith("@")
      ? trimmed.toLowerCase()
      : `@${trimmed.toLowerCase()}`;

    const usersRef = collection(db, "users");
    const q = query(
      usersRef,
      where("xHandle", ">=", normalizedPrefix),
      where("xHandle", "<=", normalizedPrefix + "\uf8ff"),
      orderBy("xHandle"),
      limit(limitCount * 2),
    );
    const snapshot = await getDocs(q);

    const publicUsers = snapshot.docs.filter((docSnap) => {
      const data = docSnap.data();
      if (!data.walletAddress) return false;
      return data.isPublic !== false; // default to true if undefined
    });

    return publicUsers.slice(0, limitCount).map((docSnap) => {
      const userData = docSnap.data();
      return {
        uid: docSnap.id,
        displayName: userData.displayName || userData.xHandle || null,
        xHandle: userData.xHandle || null,
        avatar: userData.avatar || userData.photoURL || null,
        walletAddress: userData.walletAddress,
        isPublic: userData.isPublic !== false,
      };
    });
  } catch (error) {
    console.error("Error searching users by handle:", error);
    return [];
  }
}

// Update public wallet status
export async function updatePublicWalletStatus(uid: string, isPublic: boolean) {
  try {
    const userRef = doc(db, "users", uid);
    await setDoc(
      userRef,
      {
        isPublic,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    return true;
  } catch (error) {
    console.error("Error updating public wallet status:", error);
    throw error;
  }
}

// Get public wallets (for future discovery feature)
// Includes users with isPublic: true OR users without isPublic field (default public)
export async function getPublicWallets(limitCount: number = 50) {
  try {
    const usersRef = collection(db, "users");
    // Query all users with wallets, then filter for public ones
    const q = query(
      usersRef,
      where("walletAddress", "!=", null),
      limit(limitCount * 2), // Get more to account for filtering
    );

    const snapshot = await getDocs(q);

    // Filter for public users (treat missing isPublic as public)
    const publicUsers = snapshot.docs
      .filter((doc) => {
        const data = doc.data();
        // User is public if isPublic is not explicitly false
        return data.isPublic !== false;
      })
      .slice(0, limitCount);

    return publicUsers.map((doc) => ({
      uid: doc.id,
      ...doc.data(),
    }));
  } catch (error) {
    console.error("Error getting public wallets:", error);
    return [];
  }
}
