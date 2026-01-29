import { ReactNode } from "react";
import { Navigate } from "react-router";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2 } from "lucide-react";

interface PublicRouteProps {
  children: ReactNode;
  redirectTo?: string;
}

/**
 * PublicRoute component that redirects authenticated users away from public pages
 * (e.g., sign-in page should redirect to home if already logged in)
 */
export function PublicRoute({
  children,
  redirectTo = "/app/home",
}: PublicRouteProps) {
  const { user, loading, isAuthenticated } = useAuth();

  // Show loading state while checking auth
  if (loading) {
    return (
      <div
        className="min-h-screen bg-gradient-to-b from-[#000000] to-[#0B3D2E] flex items-center justify-center"
        style={{
          paddingTop: "var(--safe-area-inset-top)",
          paddingBottom: "var(--safe-area-inset-bottom)",
        }}
      >
        <div className="text-center">
          <Loader2 className="w-8 h-8 mx-auto mb-4 animate-spin text-[#12d585]" />
          <p className="text-white/60">Loading...</p>
        </div>
      </div>
    );
  }

  // Redirect authenticated users away from public pages
  if (isAuthenticated && user) {
    return <Navigate to={redirectTo} replace />;
  }

  return <>{children}</>;
}
