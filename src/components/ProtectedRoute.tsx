import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: ReactNode;
  requireWallet?: boolean;
  allowWithoutWallet?: boolean; // Allow access even if wallet is not set up (for wallet setup pages)
}

/**
 * ProtectedRoute component that ensures user is authenticated
 * Optionally requires wallet to be connected
 */
export function ProtectedRoute({ children, requireWallet = false, allowWithoutWallet = false }: ProtectedRouteProps) {
  const { user, userProfile, loading, isAuthenticated } = useAuth();
  const location = useLocation();

  // Show loading state while checking auth
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#000000] to-[#0B3D2E] flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 mx-auto mb-4 animate-spin text-[#12d585]" />
          <p className="text-white/60">Loading...</p>
        </div>
      </div>
    );
  }

  // Redirect to sign-in if not authenticated
  if (!isAuthenticated || !user) {
    return <Navigate to="/auth/x-connect" replace />;
  }

  // Check if we're on a wallet setup page - allow access to these pages
  const isWalletSetupPage = location.pathname.startsWith('/auth/wallet-setup') || 
                           location.pathname.startsWith('/auth/import-wallet') ||
                           location.pathname.startsWith('/wallet/fund');

  // If this is a wallet setup page, allow access without wallet
  if (isWalletSetupPage || allowWithoutWallet) {
    return <>{children}</>;
  }

  // Check if user needs wallet setup
  // For existing users: if they have a walletAddress, they're not new (even if isNew is undefined)
  // Only redirect to wallet setup if:
  // 1. They don't have a walletAddress AND isNew is explicitly true, OR
  // 2. They don't have a walletAddress AND isNew is undefined (new user without wallet)
  const hasWallet = !!userProfile?.walletAddress;
  const isNewUser = userProfile?.isNew === true;
  const needsWalletSetup = !hasWallet && (isNewUser || userProfile?.isNew === undefined);

  if (needsWalletSetup) {
    return <Navigate to="/auth/wallet-setup" replace />;
  }

  // If wallet is required but not connected, redirect to wallet setup
  if (requireWallet && !userProfile?.walletConnected) {
    return <Navigate to="/auth/wallet-setup" replace />;
  }

  return <>{children}</>;
}
