import { createBrowserRouter } from "react-router";
import { Splash } from "@/pages/Splash";
import { ConnectX } from "@/pages/onboarding/ConnectX";
import { WalletSetup } from "@/pages/onboarding/WalletSetup";
import { ImportWallet } from "@/pages/onboarding/ImportWallet";
import { FundWallet } from "@/pages/onboarding/FundWallet";
import { MainLayout } from "@/layouts/MainLayout";
import { Home } from "@/pages/Home";
import { Positions } from "@/pages/Positions";
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
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { PublicRoute } from "@/components/PublicRoute";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <Splash />,
  },
  {
    path: "/auth/x-connect",
    element: (
      <PublicRoute>
        <ConnectX />
      </PublicRoute>
    ),
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
    path: "/auth/import-wallet",
    element: (
      <ProtectedRoute>
        <ImportWallet />
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
    path: "/app",
    element: (
      <ProtectedRoute>
        <MainLayout />
      </ProtectedRoute>
    ),
    children: [
      { path: "home", element: <Home /> },
      { path: "positions", element: <Positions /> },
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
        <CopeWallet />
      </ProtectedRoute>
    ),
  },
  {
    path: "/cope/wallet/found",
    element: (
      <ProtectedRoute>
        <WalletFound />
      </ProtectedRoute>
    ),
  },
  {
    path: "/cope/wallet/new",
    element: (
      <ProtectedRoute>
        <WalletNotFound />
      </ProtectedRoute>
    ),
  },
  {
    path: "/watchlist",
    element: (
      <ProtectedRoute>
        <Watchlist />
      </ProtectedRoute>
    ),
  },
  {
    path: "/scanner",
    element: (
      <ProtectedRoute>
        <ScannerInput />
      </ProtectedRoute>
    ),
  },
  {
    path: "/scanner/loading",
    element: (
      <ProtectedRoute>
        <ScannerLoading />
      </ProtectedRoute>
    ),
  },
  {
    path: "/scanner/results",
    element: (
      <ProtectedRoute>
        <ScannerResults />
      </ProtectedRoute>
    ),
  },
  {
    path: "/scanner/wallet/:address",
    element: (
      <ProtectedRoute>
        <ScannerWalletDetail />
      </ProtectedRoute>
    ),
  },
  {
    path: "/token/:mint",
    element: (
      <ProtectedRoute>
        <TokenDetail />
      </ProtectedRoute>
    ),
  },
]);
