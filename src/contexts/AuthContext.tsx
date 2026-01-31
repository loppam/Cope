// Authentication Context for managing user state
import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";
import { User } from "firebase/auth";
import {
  onAuthStateChange,
  signInWithTwitter,
  handleRedirectResult,
  signOutUser,
  getUserProfile,
  updateUserWallet,
  updateUserBalance,
  updateUserProfile,
  getWatchlist,
  WatchedWallet,
  removeUserWallet,
  getFirebaseCallbackUrl,
} from "@/lib/auth";
import { toast } from "sonner";

interface AuthContextType {
  user: User | null;
  userProfile: any;
  loading: boolean;
  signInWithTwitter: () => Promise<void>;
  signOut: () => Promise<void>;
  isAuthenticated: boolean;
  updateWallet: (
    walletAddress: string,
    balance?: number,
    encryptedMnemonic?: string,
    encryptedSecretKey?: string,
  ) => Promise<void>;
  updateBalance: (balance: number) => Promise<void>;
  updateProfile: (updates: Record<string, any>) => Promise<void>;
  refreshProfile: () => Promise<void>;
  removeWallet: () => Promise<void>;
  addToWatchlist: (
    walletAddress: string,
    walletData?: {
      nickname?: string;
      onPlatform?: boolean;
      uid?: string;
      matched?: number;
      totalInvested?: number;
      totalRemoved?: number;
      profitMargin?: number;
    },
  ) => Promise<void>;
  removeFromWatchlist: (
    walletAddress: string,
    options?: { uid?: string },
  ) => Promise<void>;
  watchlist: WatchedWallet[];
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [watchlist, setWatchlist] = useState<WatchedWallet[]>([]);

  // CRITICAL: Handle redirect FIRST, then set up auth state listener
  // getRedirectResult() can only be called once per redirect and must be called
  // before onAuthStateChanged processes the redirect, otherwise it returns null
  // This fixes mobile authentication where redirects weren't being detected
  useEffect(() => {
    let unsubscribe: (() => void) | null = null;

    const initializeAuth = async () => {
      // Step 1: Handle redirect result BEFORE setting up auth state listener
      // This is critical for mobile OAuth redirects in browsers
      // On mobile browsers, the redirect happens in the same tab/window,
      // so we need to check for redirect results immediately on page load
      let redirectHandled = false;
      try {
        const redirectUser = await handleRedirectResult();
        if (redirectUser) {
          console.log(
            "[AuthContext] Redirect user authenticated:",
            redirectUser.uid,
          );
          redirectHandled = true;

          // Immediately fetch and set profile after redirect
          // This ensures the profile is available even if onAuthStateChange hasn't fired yet
          try {
            const profile = await getUserProfile(redirectUser.uid);
            console.log(
              "[AuthContext] Profile fetched after redirect:",
              profile,
            );
            setUserProfile(profile);
            setUser(redirectUser);

            // Load watchlist
            const userWatchlist = await getWatchlist(redirectUser.uid);
            setWatchlist(userWatchlist);

            setLoading(false);
            toast.success("Successfully signed in with Twitter");
          } catch (profileError) {
            console.error(
              "[AuthContext] Error fetching profile after redirect:",
              profileError,
            );
            // Continue - onAuthStateChange will handle it
          }
        } else {
          console.log(
            "[AuthContext] No redirect result (normal if not returning from OAuth)",
          );
        }
      } catch (error: any) {
        console.error("[AuthContext] Error handling redirect result:", error);
        // Only show error if it's not a "no redirect" case (which is normal)
        if (
          error.message &&
          !error.message.includes("no redirect") &&
          error.code !== "auth/no-auth-event"
        ) {
          toast.error(error.message || "Failed to complete sign-in");
        }
      }

      // Step 2: Now set up auth state listener after redirect is handled
      // This will handle cases where redirect wasn't detected or for subsequent auth changes
      unsubscribe = onAuthStateChange(async (currentUser) => {
        console.log("[AuthContext] Auth state changed:", {
          hasUser: !!currentUser,
          uid: currentUser?.uid,
          redirectHandled,
        });

        setUser(currentUser);

        if (currentUser) {
          // Fetch user profile from Firestore
          const profile = await getUserProfile(currentUser.uid);
          console.log("[AuthContext] Profile fetched from onAuthStateChange:", {
            hasProfile: !!profile,
            walletAddress: profile?.walletAddress,
            isNew: profile?.isNew,
          });

          // For existing users without isNew field: set it based on walletAddress
          // If they have a walletAddress, they're not new
          if (profile && profile.isNew === undefined && profile.walletAddress) {
            // Existing user with wallet - update isNew to false (migrate existing users)
            try {
              await updateUserProfile(currentUser.uid, { isNew: false });
              profile.isNew = false;
            } catch (error) {
              console.warn("Failed to update isNew flag:", error);
              // Continue anyway - the ProtectedRoute will check walletAddress
            }
          }

          setUserProfile(profile);
          // Load watchlist
          const userWatchlist = await getWatchlist(currentUser.uid);
          setWatchlist(userWatchlist);
        } else {
          setUserProfile(null);
          setWatchlist([]);
        }

        setLoading(false);
      });
    };

    initializeAuth();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  const handleSignInWithTwitter = async () => {
    try {
      setLoading(true);
      const result = await signInWithTwitter();
      // On mobile, signInWithTwitter returns void (redirect happens)
      // On desktop, it returns the user
      if (result) {
        toast.success("Successfully signed in with Twitter");
      }
      // On mobile, the redirect will happen and handleRedirectResult will handle it
    } catch (error: any) {
      console.error("Sign-in error:", error);
      const errorMessage = error.message || "Failed to sign in with Twitter";

      // Show more helpful error message
      if (
        errorMessage.includes("invalid-credential") ||
        errorMessage.includes("not configured")
      ) {
        toast.error(
          "Twitter OAuth not configured. Check Firebase Console → Authentication → Twitter",
          {
            duration: 5000,
          },
        );
      } else if (
        errorMessage.includes("blocked") ||
        errorMessage.includes("suspicious") ||
        errorMessage.includes("prevented")
      ) {
        const callbackUrl = getFirebaseCallbackUrl();
        toast.error(
          `Twitter blocked the login. Add this callback URL to Twitter Developer Portal: ${callbackUrl}. See TWITTER_OAUTH_MOBILE_FIX.md for details.`,
          { duration: 10000 },
        );
      } else if (!errorMessage.includes("cancelled")) {
        toast.error(errorMessage);
      }
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    try {
      setLoading(true);
      await signOutUser();
      toast.success("Signed out successfully");
    } catch (error: any) {
      console.error("Sign-out error:", error);
      toast.error(error.message || "Failed to sign out");
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateWallet = async (
    walletAddress: string,
    balance: number = 0,
    encryptedMnemonic?: string,
    encryptedSecretKey?: string,
  ) => {
    if (!user) throw new Error("User not authenticated");

    // Validate inputs before proceeding
    if (
      !walletAddress ||
      typeof walletAddress !== "string" ||
      walletAddress.trim() === ""
    ) {
      throw new Error("Wallet address is required and must be a valid string");
    }

    if (!encryptedSecretKey || typeof encryptedSecretKey !== "string") {
      throw new Error("Encrypted secret key is required");
    }

    try {
      await updateUserWallet(
        user.uid,
        walletAddress.trim(),
        balance,
        encryptedMnemonic,
        encryptedSecretKey,
      );

      // Refresh profile after update to verify the update succeeded
      await refreshProfile();

      // Verify the update was successful
      const profile = await getUserProfile(user.uid);
      if (!profile) {
        throw new Error("Failed to verify wallet update: profile not found");
      }

      if (profile.walletAddress !== walletAddress.trim()) {
        throw new Error(
          `Wallet update verification failed: expected ${walletAddress.trim()}, got ${profile.walletAddress}`,
        );
      }

      if (profile.walletConnected !== true) {
        throw new Error(
          "Wallet update verification failed: walletConnected is not true",
        );
      }

      if (profile.isNew !== false) {
        throw new Error(
          "Wallet update verification failed: isNew is not false",
        );
      }

      toast.success("Wallet updated successfully");
    } catch (error: any) {
      console.error("Update wallet error:", error);
      toast.error(error.message || "Failed to update wallet");
      throw error;
    }
  };

  const handleUpdateBalance = async (balance: number) => {
    if (!user) throw new Error("User not authenticated");
    try {
      await updateUserBalance(user.uid, balance);
      // Refresh profile after update
      await refreshProfile();
    } catch (error: any) {
      console.error("Update balance error:", error);
      toast.error(error.message || "Failed to update balance");
      throw error;
    }
  };

  const handleUpdateProfile = async (updates: Record<string, any>) => {
    if (!user) throw new Error("User not authenticated");
    try {
      await updateUserProfile(user.uid, updates);
      // Refresh profile after update
      await refreshProfile();
      toast.success("Profile updated successfully");
    } catch (error: any) {
      console.error("Update profile error:", error);
      toast.error(error.message || "Failed to update profile");
      throw error;
    }
  };

  const refreshProfile = async () => {
    if (!user) return;
    try {
      const profile = await getUserProfile(user.uid);
      setUserProfile(profile);
      // Refresh watchlist
      const userWatchlist = await getWatchlist(user.uid);
      setWatchlist(userWatchlist);
    } catch (error) {
      console.error("Error refreshing profile:", error);
    }
  };

  const handleAddToWatchlist = async (
    walletAddress: string,
    walletData?: {
      nickname?: string;
      onPlatform?: boolean;
      uid?: string;
      matched?: number;
      totalInvested?: number;
      totalRemoved?: number;
      profitMargin?: number;
    },
  ) => {
    if (!user) throw new Error("User not authenticated");
    try {
      const token = await user.getIdToken();
      const base = import.meta.env.VITE_API_BASE_URL || "";
      const res = await fetch(`${base}/api/watchlist/add`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          walletAddress,
          ...walletData,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || res.statusText);
      }
      await refreshProfile();

      // Sync webhook in background (don't wait for it)
      import("@/lib/webhook")
        .then(({ syncWebhook }) => syncWebhook())
        .catch(() => {});

      toast.success("Wallet added to watchlist");
    } catch (error: any) {
      console.error("Add to watchlist error:", error);
      toast.error(error.message || "Failed to add wallet to watchlist");
      throw error;
    }
  };

  const handleRemoveFromWatchlist = async (
    walletAddress: string,
    options?: { uid?: string },
  ) => {
    if (!user) throw new Error("User not authenticated");
    try {
      const token = await user.getIdToken();
      const base = import.meta.env.VITE_API_BASE_URL || "";
      const res = await fetch(`${base}/api/watchlist/remove`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ walletAddress, ...options }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || res.statusText);
      }
      await refreshProfile();

      // Sync webhook in background (don't wait for it)
      import("@/lib/webhook")
        .then(({ syncWebhook }) => syncWebhook())
        .catch(() => {});

      toast.success("Wallet removed from watchlist");
    } catch (error: any) {
      console.error("Remove from watchlist error:", error);
      toast.error(error.message || "Failed to remove wallet from watchlist");
      throw error;
    }
  };

  const handleRemoveWallet = async () => {
    if (!user) throw new Error("User not authenticated");
    try {
      await removeUserWallet(user.uid);
      await refreshProfile();
      toast.success("Wallet removed successfully");
    } catch (error: any) {
      console.error("Remove wallet error:", error);
      toast.error(error.message || "Failed to remove wallet");
      throw error;
    }
  };

  const value: AuthContextType = {
    user,
    userProfile,
    loading,
    signInWithTwitter: handleSignInWithTwitter,
    signOut: handleSignOut,
    isAuthenticated: !!user,
    updateWallet: handleUpdateWallet,
    updateBalance: handleUpdateBalance,
    updateProfile: handleUpdateProfile,
    refreshProfile,
    removeWallet: handleRemoveWallet,
    addToWatchlist: handleAddToWatchlist,
    removeFromWatchlist: handleRemoveFromWatchlist,
    watchlist,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
