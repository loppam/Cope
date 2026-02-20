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
  WatchedWallet,
} from "@/lib/auth";
import { toUserMessage } from "@/lib/user-errors";
import { getApiBase } from "@/lib/utils";
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
    options?: { suppressToast?: boolean },
  ) => Promise<void>;
  removeFromWatchlist: (
    walletAddress: string,
    options?: { uid?: string },
  ) => Promise<void>;
  watchlist: WatchedWallet[];
  deleteAccount: () => Promise<void>;
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
            setWatchlist(profile?.watchlist ?? []);

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
          toast.error(toUserMessage(error, "Sign-in failed. Please try again."));
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
          setWatchlist(profile?.watchlist ?? []);
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

      if (errorMessage.includes("cancelled")) {
        // Don't show toast for user-initiated cancel
      } else {
        const friendly = toUserMessage(error, "Sign-in failed. Please try again.");
        toast.error(friendly, { duration: 5000 });
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
      toast.error(toUserMessage(error, "Sign out failed. Please try again."));
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
      throw new Error("Wallet address is required");
    }

    if (!encryptedSecretKey || typeof encryptedSecretKey !== "string") {
      throw new Error("Wallet data is required");
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
        throw new Error("Something went wrong. Please try again.");
      }

      if (profile.walletAddress !== walletAddress.trim()) {
        throw new Error("Something went wrong. Please try again.");
      }

      if (profile.walletConnected !== true) {
        throw new Error("Something went wrong. Please try again.");
      }

      if (profile.isNew !== false) {
        throw new Error(
          "Something went wrong. Please try again.",
        );
      }

      toast.success("Wallet updated successfully");
    } catch (error: any) {
      console.error("Update wallet error:", error);
      toast.error(toUserMessage(error, "Couldn't update wallet. Please try again."));
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
      toast.error(toUserMessage(error, "Couldn't update balance. Please try again."));
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
      toast.error(toUserMessage(error, "Couldn't update profile. Please try again."));
      throw error;
    }
  };

  const refreshProfile = async () => {
    if (!user) return;
    try {
      const profile = await getUserProfile(user.uid);
      setUserProfile(profile);
      setWatchlist(profile?.watchlist ?? []);
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
    options?: { suppressToast?: boolean },
  ) => {
    if (!user) throw new Error("User not authenticated");
    const trimmedAddress = walletAddress?.trim();
    const previousWatchlist = watchlist;
    if (trimmedAddress) {
      setWatchlist((prev) => {
        const existingIndex = prev.findIndex(
          (item) =>
            item.address === trimmedAddress ||
            (!!walletData?.uid && item.uid === walletData.uid),
        );
        if (existingIndex >= 0) {
          const next = [...prev];
          next[existingIndex] = {
            ...next[existingIndex],
            address: trimmedAddress,
            ...walletData,
            updatedAt: new Date(),
          };
          return next;
        }
        return [
          ...prev,
          {
            address: trimmedAddress,
            addedAt: new Date(),
            ...walletData,
          },
        ];
      });
    }
    try {
      const token = await user.getIdToken();
      const base = getApiBase();
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

      if (!options?.suppressToast) {
        toast.success("Wallet added to watchlist");
      }
    } catch (error: any) {
      if (trimmedAddress) {
        setWatchlist(previousWatchlist);
      }
      console.error("Add to watchlist error:", error);
      toast.error(toUserMessage(error, "Couldn't add wallet. Please try again."));
      throw error;
    }
  };

  const handleRemoveFromWatchlist = async (
    walletAddress: string,
    options?: { uid?: string },
  ) => {
    if (!user) throw new Error("User not authenticated");
    const trimmedAddress = walletAddress?.trim();
    const targetUid = options?.uid;
    const previousWatchlist = watchlist;
    if (trimmedAddress || targetUid) {
      setWatchlist((prev) =>
        prev.filter((item) => {
          if (targetUid && item.uid === targetUid) return false;
          if (trimmedAddress && item.address === trimmedAddress) return false;
          return true;
        }),
      );
    }
    try {
      const token = await user.getIdToken();
      const base = getApiBase();
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

      toast.success("Wallet removed from watchlist");
    } catch (error: any) {
      if (trimmedAddress || targetUid) {
        setWatchlist(previousWatchlist);
      }
      console.error("Remove from watchlist error:", error);
      toast.error(toUserMessage(error, "Couldn't remove wallet. Please try again."));
      throw error;
    }
  };

  const handleRemoveWallet = async () => {
    if (!user) throw new Error("User not authenticated");
    try {
      const token = await user.getIdToken();
      const base = getApiBase();
      const res = await fetch(`${base}/api/account/remove-wallet`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || res.statusText);
      }
      await refreshProfile();
      toast.success("Wallet removed successfully");
    } catch (error: any) {
      console.error("Remove wallet error:", error);
      toast.error(toUserMessage(error, "Couldn't remove wallet. Please try again."));
      throw error;
    }
  };

  const handleDeleteAccount = async () => {
    if (!user) throw new Error("User not authenticated");
    try {
      const token = await user.getIdToken();
      const base = getApiBase();
      const res = await fetch(`${base}/api/account/delete`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || res.statusText);
      }
      setUser(null);
      setUserProfile(null);
      setWatchlist([]);
      await signOutUser();
      toast.success("Account deleted");
    } catch (error: any) {
      console.error("Delete account error:", error);
      toast.error(toUserMessage(error, "Couldn't delete account. Please try again."));
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
    deleteAccount: handleDeleteAccount,
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
