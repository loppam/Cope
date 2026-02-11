import { createBrowserRouter } from "react-router";
import { Splash } from "@/pages/Splash";
import { ConnectX } from "@/pages/onboarding/ConnectX";
import { WalletSetup } from "@/pages/onboarding/WalletSetup";
import { FundWallet } from "@/pages/onboarding/FundWallet";
import { Withdraw } from "@/pages/Withdraw";
import { MainLayout } from "@/layouts/MainLayout";
import { AppLayout } from "@/layouts/AppLayout";
import { Home } from "@/pages/Home";
import { TokenScanner } from "@/pages/TokenScanner";
import { Trade } from "@/pages/Trade";
import { Alerts } from "@/pages/Alerts";
import { Profile } from "@/pages/Profile";
import { CopeWallet } from "@/pages/cope/CopeWallet";
import { WalletFound } from "@/pages/cope/WalletFound";
import { WalletNotFound } from "@/pages/cope/WalletNotFound";
import { Watchlist } from "@/pages/Watchlist";
import { ScannerInput } from "@/pages/scanner/ScannerInput";
import { ScannerLoading } from "@/pages/scanner/ScannerLoading";
import { ScannerResults } from "@/pages/scanner/ScannerResults";
import { ScannerWalletDetail } from "@/pages/scanner/ScannerWalletDetail";
import { TokenDetail } from "@/pages/TokenDetail";
import { PublicProfile } from "@/pages/PublicProfile";
import { ProtectedRoute } from "@/components/ProtectedRoute";
// import { PublicRoute } from "@/components/PublicRoute";
import { AdminPush } from "@/pages/lopam/AdminPush";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Splash />,
  },
  {
    path: "/auth/x-connect",
    element: <ConnectX />,
  },
  {
    path: "/auth/wallet-setup",
    element: (
      <ProtectedRoute>
        <WalletSetup />
      </ProtectedRoute>
    ),
  },
  {
    path: "/wallet/fund",
    element: (
      <ProtectedRoute>
        <FundWallet />
      </ProtectedRoute>
    ),
  },
  {
    path: "/wallet/withdraw",
    element: (
      <ProtectedRoute>
        <Withdraw />
      </ProtectedRoute>
    ),
  },
  {
    path: "/app",
    element: (
      <ProtectedRoute>
        <MainLayout />
      </ProtectedRoute>
    ),
    children: [
      { path: "home", element: <Home /> },
      { path: "tscanner", element: <TokenScanner /> },
      { path: "trade", element: <Trade /> },
      { path: "alerts", element: <Alerts /> },
      { path: "profile", element: <Profile /> },
      { path: "watchlist", element: <Watchlist /> },
    ],
  },
  {
    path: "/cope/wallet",
    element: (
      <ProtectedRoute>
        <AppLayout>
          <CopeWallet />
        </AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: "/cope/wallet/found",
    element: (
      <ProtectedRoute>
        <AppLayout>
          <WalletFound />
        </AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: "/cope/wallet/new",
    element: (
      <ProtectedRoute>
        <AppLayout>
          <WalletNotFound />
        </AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: "/watchlist",
    element: (
      <ProtectedRoute>
        <AppLayout>
          <Watchlist />
        </AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: "/scanner",
    element: (
      <ProtectedRoute>
        <AppLayout>
          <ScannerInput />
        </AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: "/scanner/loading",
    element: (
      <ProtectedRoute>
        <AppLayout>
          <ScannerLoading />
        </AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: "/scanner/results",
    element: (
      <ProtectedRoute>
        <AppLayout>
          <ScannerResults />
        </AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: "/scanner/wallet/:address",
    element: (
      <ProtectedRoute>
        <AppLayout>
          <ScannerWalletDetail />
        </AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: "/token/:mint",
    element: (
      <ProtectedRoute>
        <AppLayout>
          <TokenDetail />
        </AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: "/lopam/push",
    element: (
      <ProtectedRoute>
        <AppLayout>
          <AdminPush />
        </AppLayout>
      </ProtectedRoute>
    ),
  },
  {
    path: "/:handle",
    element: <PublicProfile />,
  },
]);
