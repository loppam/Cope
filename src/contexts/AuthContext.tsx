// Authentication Context for managing user state
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User } from 'firebase/auth';
import { onAuthStateChange, signInWithTwitter, signOutUser, getUserProfile, updateUserWallet, updateUserBalance, updateUserProfile, addWalletToWatchlist, removeWalletFromWatchlist, getWatchlist, WatchedWallet, removeUserWallet } from '@/lib/auth';
import { toast } from 'sonner';

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
    encryptedSecretKey?: string
  ) => Promise<void>;
  updateBalance: (balance: number) => Promise<void>;
  updateProfile: (updates: Record<string, any>) => Promise<void>;
  refreshProfile: () => Promise<void>;
  removeWallet: () => Promise<void>;
  addToWatchlist: (walletAddress: string, walletData?: { nickname?: string; matched?: number; totalInvested?: number; totalRemoved?: number; profitMargin?: number }) => Promise<void>;
  removeFromWatchlist: (walletAddress: string) => Promise<void>;
  watchlist: WatchedWallet[];
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [watchlist, setWatchlist] = useState<WatchedWallet[]>([]);

  useEffect(() => {
    const unsubscribe = onAuthStateChange(async (currentUser) => {
      setUser(currentUser);
      
      if (currentUser) {
        // Fetch user profile from Firestore
        const profile = await getUserProfile(currentUser.uid);
        
        // For existing users without isNew field: set it based on walletAddress
        // If they have a walletAddress, they're not new
        if (profile && profile.isNew === undefined && profile.walletAddress) {
          // Existing user with wallet - update isNew to false (migrate existing users)
          try {
            await updateUserProfile(currentUser.uid, { isNew: false });
            profile.isNew = false;
          } catch (error) {
            console.warn('Failed to update isNew flag:', error);
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

    return () => unsubscribe();
  }, []);

  const handleSignInWithTwitter = async () => {
    try {
      setLoading(true);
      await signInWithTwitter();
      toast.success('Successfully signed in with Twitter');
    } catch (error: any) {
      console.error('Sign-in error:', error);
      const errorMessage = error.message || 'Failed to sign in with Twitter';
      
      // Show more helpful error message
      if (errorMessage.includes('invalid-credential') || errorMessage.includes('not configured')) {
        toast.error('Twitter OAuth not configured. Check Firebase Console → Authentication → Twitter', {
          duration: 5000,
        });
      } else {
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
      toast.success('Signed out successfully');
    } catch (error: any) {
      console.error('Sign-out error:', error);
      toast.error(error.message || 'Failed to sign out');
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateWallet = async (
    walletAddress: string,
    balance: number = 0,
    encryptedMnemonic?: string,
    encryptedSecretKey?: string
  ) => {
    if (!user) throw new Error('User not authenticated');
    try {
      await updateUserWallet(user.uid, walletAddress, balance, encryptedMnemonic, encryptedSecretKey);
      // Refresh profile after update
      await refreshProfile();
      toast.success('Wallet updated successfully');
    } catch (error: any) {
      console.error('Update wallet error:', error);
      toast.error(error.message || 'Failed to update wallet');
      throw error;
    }
  };

  const handleUpdateBalance = async (balance: number) => {
    if (!user) throw new Error('User not authenticated');
    try {
      await updateUserBalance(user.uid, balance);
      // Refresh profile after update
      await refreshProfile();
    } catch (error: any) {
      console.error('Update balance error:', error);
      toast.error(error.message || 'Failed to update balance');
      throw error;
    }
  };

  const handleUpdateProfile = async (updates: Record<string, any>) => {
    if (!user) throw new Error('User not authenticated');
    try {
      await updateUserProfile(user.uid, updates);
      // Refresh profile after update
      await refreshProfile();
      toast.success('Profile updated successfully');
    } catch (error: any) {
      console.error('Update profile error:', error);
      toast.error(error.message || 'Failed to update profile');
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
      console.error('Error refreshing profile:', error);
    }
  };

  const handleAddToWatchlist = async (
    walletAddress: string,
    walletData?: { nickname?: string; matched?: number; totalInvested?: number; totalRemoved?: number; profitMargin?: number }
  ) => {
    if (!user) throw new Error('User not authenticated');
    try {
      await addWalletToWatchlist(user.uid, walletAddress, walletData);
      await refreshProfile();
      
      // Sync webhook in background (don't wait for it)
      import('@/lib/webhook').then(({ syncWebhook }) => syncWebhook()).catch(() => {});
      
      toast.success('Wallet added to watchlist');
    } catch (error: any) {
      console.error('Add to watchlist error:', error);
      toast.error(error.message || 'Failed to add wallet to watchlist');
      throw error;
    }
  };

  const handleRemoveFromWatchlist = async (walletAddress: string) => {
    if (!user) throw new Error('User not authenticated');
    try {
      await removeWalletFromWatchlist(user.uid, walletAddress);
      await refreshProfile();
      
      // Sync webhook in background (don't wait for it)
      import('@/lib/webhook').then(({ syncWebhook }) => syncWebhook()).catch(() => {});
      
      toast.success('Wallet removed from watchlist');
    } catch (error: any) {
      console.error('Remove from watchlist error:', error);
      toast.error(error.message || 'Failed to remove wallet from watchlist');
      throw error;
    }
  };

  const handleRemoveWallet = async () => {
    if (!user) throw new Error('User not authenticated');
    try {
      await removeUserWallet(user.uid);
      await refreshProfile();
      toast.success('Wallet removed successfully');
    } catch (error: any) {
      console.error('Remove wallet error:', error);
      toast.error(error.message || 'Failed to remove wallet');
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
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
