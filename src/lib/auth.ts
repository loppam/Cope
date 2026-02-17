// Authentication utilities for Twitter OAuth
import {
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

// Treat absence of isPublic as public (true). If the field exists, use its boolean value.
function isUserPublic(data: { isPublic?: boolean }): boolean {
  return data.isPublic !== false;
}

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

// Helper function to save user profile data
// IMPORTANT: This function preserves existing wallet data - it only sets wallet fields
// if they don't already exist (for new users only)
async function saveUserProfile(user: User, credential: any): Promise<void> {
  // Extract Twitter handle from displayName (store as-is; search is case-insensitive)
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

  // Only set wallet fields if user doesn't exist or doesn't have a wallet.
  // Use walletAddress only - never require encryptedSecretKey for preservation.
  // If a user has a wallet address, we must never overwrite it (prevents "lose wallet on refresh" bug).
  const hasExistingWallet = !!(
    existingData?.walletAddress &&
    typeof existingData.walletAddress === "string" &&
    existingData.walletAddress.trim() !== ""
  );

  const twitterData: any = {
    uid: user.uid,
    displayName: user.displayName,
    email: user.email,
    photoURL: user.photoURL,
    xHandle: xHandle,
    xHandleLower: xHandle.toLowerCase(),
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

// Sign in with Twitter - uses redirect on both web and mobile (avoids X "suspicious activity" on popup)
export async function signInWithTwitter(): Promise<User | void> {
  try {
    await signInWithRedirect(auth, twitterProvider);
    // signInWithRedirect doesn't return; user goes to X then back to app
    // handleRedirectResult() in AuthContext completes sign-in on return
    return;
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
    const merged = { ...updates, updatedAt: serverTimestamp() };
    if (typeof merged.xHandle === "string") {
      merged.xHandleLower = merged.xHandle.toLowerCase();
    }
    await setDoc(userRef, merged, { merge: true });
    return true;
  } catch (error) {
    console.error("Error updating user profile:", error);
    throw error;
  }
}

// Remove wallet (delete wallet and reset isNew flag). Call relay evm-address-remove first to remove from Alchemy webhooks.
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
        evmAddress: null,
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
// onPlatform: true = following (platform user); false/omit = watchlist (external wallet)
// uid: when onPlatform, the followed user's uid (enables UID-based following, wallet changes)
export interface WatchedWallet {
  address: string;
  addedAt: any; // Date object (can't use serverTimestamp() in arrays)
  nickname?: string;
  onPlatform?: boolean;
  uid?: string; // When onPlatform: the followed user's uid
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

    if (requirePublic && !isUserPublic(userData)) {
      return null;
    }

    return {
      uid: userDoc.id,
      displayName: userData.displayName || userData.xHandle || null,
      xHandle: userData.xHandle || null,
      avatar: userData.avatar || userData.photoURL || null,
      walletAddress: userData.walletAddress,
      isPublic: isUserPublic(userData),
      // Add any other user data you want to return
    };
  } catch (error) {
    console.error("Error finding user by wallet address:", error);
    return null;
  }
}

// Find user by X handle (Twitter username); case-insensitive via xHandleLower
// Only returns public users: absence of isPublic → public; if exists, use the boolean
// Fallback: if xHandleLower query returns null (migration not run), try xHandle exact match
export async function findUserByXHandle(xHandle: string) {
  const withAt = xHandle.trim().startsWith("@")
    ? xHandle.trim()
    : `@${xHandle.trim()}`;
  const normalizedHandle = withAt.toLowerCase();

  const usersRef = collection(db, "users");

  // Primary: query xHandleLower (case-insensitive; requires migration)
  try {
    const q = query(
      usersRef,
      where("xHandleLower", "==", normalizedHandle),
      limit(1),
    );
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      const exactMatch = snapshot.docs[0];
      const userData = exactMatch.data();
      if (userData.walletAddress && isUserPublic(userData)) {
        return {
          uid: exactMatch.id,
          displayName: userData.displayName || userData.xHandle || null,
          xHandle: userData.xHandle || null,
          avatar: userData.avatar || userData.photoURL || null,
          walletAddress: userData.walletAddress,
          isPublic: isUserPublic(userData),
        };
      }
    }
  } catch (err) {
    console.warn("[auth] xHandleLower query failed, trying fallback:", err);
  }

  // Fallback: xHandle exact match (when migration not run or index missing)
  try {
    const q = query(usersRef, where("xHandle", "==", withAt), limit(1));
    const snapshot = await getDocs(q);
    if (snapshot.empty) return null;

    const exactMatch = snapshot.docs[0];
    const userData = exactMatch.data();
    if (!userData.walletAddress || !isUserPublic(userData)) return null;

    return {
      uid: exactMatch.id,
      displayName: userData.displayName || userData.xHandle || null,
      xHandle: userData.xHandle || null,
      avatar: userData.avatar || userData.photoURL || null,
      walletAddress: userData.walletAddress,
      isPublic: isUserPublic(userData),
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

// Search users by X handle prefix (for dropdown suggestions); case-insensitive via xHandleLower
// Only returns public users: absence of isPublic → public; if exists, use the boolean
// Fallback: when xHandleLower index missing or migration not run, try xHandle range + client-side filter
export async function searchUsersByHandle(
  handleQuery: string,
  limitCount: number = 20,
): Promise<UserSearchResult[]> {
  const trimmed = handleQuery.trim();
  if (!trimmed.length) return [];

  const normalizedPrefix = trimmed.startsWith("@")
    ? trimmed.toLowerCase()
    : `@${trimmed.toLowerCase()}`;
  const usersRef = collection(db, "users");

  // Primary: xHandleLower range query (requires Firestore composite index + migration)
  try {
    const q = query(
      usersRef,
      where("xHandleLower", ">=", normalizedPrefix),
      where("xHandleLower", "<=", normalizedPrefix + "\uf8ff"),
      orderBy("xHandleLower"),
      limit(limitCount),
    );
    const snapshot = await getDocs(q);

    const publicUsers = snapshot.docs.filter((docSnap) => {
      const data = docSnap.data();
      if (!data.walletAddress) return false;
      if (!isUserPublic(data)) return false;
      return true;
    });

    return publicUsers.slice(0, limitCount).map((docSnap) => {
      const userData = docSnap.data();
      return {
        uid: docSnap.id,
        displayName: userData.displayName || userData.xHandle || null,
        xHandle: userData.xHandle || null,
        avatar: userData.avatar || userData.photoURL || null,
        walletAddress: userData.walletAddress,
        isPublic: isUserPublic(userData),
      };
    });
  } catch (err: unknown) {
    console.warn(
      "[auth] xHandleLower prefix search failed, trying fallback:",
      err,
    );
    const firestoreErr = err as { message?: string; code?: number };
    if (firestoreErr?.message?.includes("index")) {
      console.warn(
        "[auth] Firestore index may be missing. Run: firebase deploy --only firestore:indexes",
      );
    }
  }

  // Fallback: fetch users, filter by xHandle prefix client-side (when index missing or migration not run)
  try {
    const q = query(usersRef, limit(500));
    const snapshot = await getDocs(q);

    const filtered = snapshot.docs.filter((docSnap) => {
      const data = docSnap.data();
      if (!data.walletAddress || !isUserPublic(data)) return false;
      const h = ((data.xHandle as string) || "").toLowerCase();
      return h.startsWith(normalizedPrefix);
    });

    return filtered.slice(0, limitCount).map((docSnap) => {
      const userData = docSnap.data();
      return {
        uid: docSnap.id,
        displayName: userData.displayName || userData.xHandle || null,
        xHandle: userData.xHandle || null,
        avatar: userData.avatar || userData.photoURL || null,
        walletAddress: userData.walletAddress,
        isPublic: isUserPublic(userData),
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
// Absence of isPublic → public; if exists, use the boolean
export async function getPublicWallets(limitCount: number = 50) {
  try {
    const usersRef = collection(db, "users");
    const q = query(
      usersRef,
      where("walletAddress", "!=", null),
      limit(limitCount * 2), // Get more to account for filtering
    );

    const snapshot = await getDocs(q);

    const publicUsers = snapshot.docs
      .filter((doc) => isUserPublic(doc.data()))
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
