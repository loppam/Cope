import { ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { Loader2 } from 'lucide-react';

interface ProtectedRouteProps {
  children: ReactNode;
  requireWallet?: boolean;
}

/**
 * ProtectedRoute component that ensures user is authenticated
 * Optionally requires wallet to be connected
 */
export function ProtectedRoute({ children, requireWallet = false }: ProtectedRouteProps) {
  const { user, userProfile, loading, isAuthenticated } = useAuth();

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

  // If wallet is required but not connected, redirect to wallet setup
  if (requireWallet && !userProfile?.walletConnected) {
    return <Navigate to="/auth/wallet-setup" replace />;
  }

  return <>{children}</>;
}
