import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { motion } from "motion/react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import {
  Twitter,
  LogOut,
  ExternalLink,
  Trash2,
  Bell,
  Globe,
  GlobeLock,
  Settings,
  DollarSign,
  ArrowLeft,
  Copy,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { getApiBase } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { PullToRefresh } from "@/components/PullToRefresh";
import { shortenAddress } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { getUsdcBalance } from "@/lib/rpc";
import { getWalletPortfolioWithPnL } from "@/lib/birdeye";
import {
  getPushNotificationStatus,
  requestPermissionAndGetPushToken,
  savePushTokenWithPlatform,
  unregisterPushToken,
  getStoredPushToken,
} from "@/lib/notifications";
import { updatePublicWalletStatus } from "@/lib/auth";
import { syncWebhook } from "@/lib/webhook";
import { getFollowersCount } from "@/lib/profile";
import { fetchNativePrices } from "@/lib/coingecko";
import { getWalletProfitability } from "@/lib/moralis";
import { getIntentStatus } from "@/lib/relay";
import { toast } from "sonner";
import type { WatchedWallet } from "@/lib/auth";
import { SOLANA_USDC_MINT, SOL_MINT } from "@/lib/constants";
import { apiCache, UI_CACHE_TTL_MS } from "@/lib/cache";
import { Input } from "@/components/Input";
import { Loader2 } from "lucide-react";
import { DocumentHead } from "@/components/DocumentHead";

interface TokenPosition {
  mint: string;
  symbol: string;
  name: string;
  image?: string;
  amount: number;
  value: number;
  pnl?: number;
  pnlPercent?: number;
  chain?: "solana" | "base" | "bnb";
}

const SOL_RESERVE = 0.005;
const BASE_ETH_RESERVE = 0.0005;
const BNB_RESERVE = 0.001;

function sellableAmount(pos: { mint: string; amount: number }): number {
  if (
    pos.mint === SOL_MINT ||
    pos.mint === "So11111111111111111111111111111111111111111"
  )
    return Math.max(0, pos.amount - SOL_RESERVE);
  if (pos.mint === "base-eth")
    return Math.max(0, pos.amount - BASE_ETH_RESERVE);
  if (pos.mint === "bnb-bnb") return Math.max(0, pos.amount - BNB_RESERVE);
  return pos.amount;
}

export function Profile() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    user,
    userProfile,
    signOut,
    removeWallet,
    deleteAccount,
    loading,
    watchlist,
  } = useAuth();
  const [isRemovingWallet, setIsRemovingWallet] = useState(false);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [usdcBalance, setUsdcBalance] = useState<number>(0);
  const [usdcBalanceLoading, setUsdcBalanceLoading] = useState(true);
  const [openPositions, setOpenPositions] = useState<TokenPosition[]>([]);
  const [closedPositions, setClosedPositions] = useState<TokenPosition[]>([]);
  const [closedExpanded, setClosedExpanded] = useState(false);
  const [followersCount, setFollowersCount] = useState<number | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [isPublic, setIsPublic] = useState(userProfile?.isPublic !== false);
  const [isTogglingPublic, setIsTogglingPublic] = useState(false);
  const [isTogglingPush, setIsTogglingPush] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [depositSheetOpen, setDepositSheetOpen] = useState(false);
  const [depositStep, setDepositStep] = useState<"chain" | "detail">("chain");
  const [selectedDepositChain, setSelectedDepositChain] = useState<
    "solana" | "base" | "bnb"
  >("solana");
  const [evmAddress, setEvmAddress] = useState<string | null>(null);
  const [withdrawSheetOpen, setWithdrawSheetOpen] = useState(false);
  const [withdrawStep, setWithdrawStep] = useState<"chain" | "form">("chain");
  const [withdrawNetwork, setWithdrawNetwork] = useState<
    "solana" | "base" | "bnb"
  >("solana");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawDestination, setWithdrawDestination] = useState("");
  const [withdrawQuote, setWithdrawQuote] = useState<unknown>(null);
  const [withdrawQuoteLoading, setWithdrawQuoteLoading] = useState(false);
  const [withdrawExecuting, setWithdrawExecuting] = useState(false);
  const [withdrawRequestId, setWithdrawRequestId] = useState<string | null>(
    null,
  );
  const following = watchlist.filter(
    (w): w is WatchedWallet & { uid: string } =>
      w.onPlatform === true && !!w.uid,
  );
  const watchlistExternal = watchlist.filter((w) => !w.onPlatform);

  // Get user data from Firebase or use defaults
  const xHandle =
    userProfile?.xHandle ||
    userProfile?.displayName ||
    user?.displayName ||
    "@user";
  const avatar =
    userProfile?.avatar || userProfile?.photoURL || user?.photoURL || "";
  const walletAddress = userProfile?.walletAddress || null;
  const walletConnected = userProfile?.walletConnected || false;

  // Fetch Solana USDC (SPL) balance via RPC (same method as scripts/get-sol-usdc-balance.mjs)
  const fetchBalance = async () => {
    if (!walletAddress) return;
    setUsdcBalanceLoading(true);
    try {
      const balance = await getUsdcBalance(walletAddress).catch(() => 0);
      setUsdcBalance(balance);
    } catch (error) {
      console.error("Error fetching Solana USDC balance:", error);
      setUsdcBalance(0);
    } finally {
      setUsdcBalanceLoading(false);
    }
  };

  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    if (walletAddress) {
      fetchBalance();
    } else {
      setUsdcBalance(0);
      setUsdcBalanceLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    const handleRefresh = () => {
      if (walletAddress) {
        apiCache.clear(`profile_positions_${walletAddress}`);
        fetchBalance();
        setRefreshTrigger((r) => r + 1);
      }
    };
    window.addEventListener("cope-refresh-balance", handleRefresh);
    return () =>
      window.removeEventListener("cope-refresh-balance", handleRefresh);
  }, [walletAddress]);

  // Open deposit sheet when navigated with ?open=deposit (e.g. from Home)
  useEffect(() => {
    if (searchParams.get("open") === "deposit") {
      setDepositStep("chain");
      setDepositSheetOpen(true);
      setSearchParams(
        (p) => {
          const next = new URLSearchParams(p);
          next.delete("open");
          return next;
        },
        { replace: true },
      );
    }
  }, [searchParams, setSearchParams]);

  // Fetch open positions: SOL + EVM (Base/BNB USDC and native) + SPL tokens
  // Phased loading: positions first, then 1s delay, then PnL (Solana Tracker 1 RPS) + Moralis (EVM PnL)
  // Cache-first: 30s cache on page enter, then refetch in background
  useEffect(() => {
    if (!walletAddress) {
      setOpenPositions([]);
      setClosedPositions([]);
      return;
    }
    const cacheKey = `profile_positions_${walletAddress}`;
    const cached = apiCache.get<{
      openPositions: TokenPosition[];
      closedPositions: TokenPosition[];
    }>(cacheKey);
    if (cached) {
      setOpenPositions(cached.openPositions);
      setClosedPositions(cached.closedPositions);
    }
    let cancelled = false;
    const base = getApiBase();

    (async () => {
      try {
        // Phase 1: Birdeye unified portfolio (SOL, USDC, SPL positions + PnL) + prices + EVM
        const [portfolio, nativePrices, evmData] = await Promise.all([
          getWalletPortfolioWithPnL(walletAddress).catch(() => ({
            solBalance: 0,
            usdcBalance: 0,
            positions: [],
            totalUsd: 0,
          })),
          fetchNativePrices(),
          user
            ? user.getIdToken().then((token) =>
                fetch(`${base}/api/relay/evm-balances`, {
                  headers: { Authorization: `Bearer ${token}` },
                })
                  .then((r) => r.json())
                  .catch(() => null),
              )
            : Promise.resolve(null),
        ]);

        if (cancelled) return;

        // Phase 2: Moralis EVM PnL only (Solana PnL already in portfolio)
        const evmAddress = evmData?.evmAddress;
        const [evmPnlBase, evmPnlBnb] = await Promise.all([
          evmAddress
            ? getWalletProfitability(evmAddress, "base")
            : Promise.resolve([]),
          evmAddress
            ? getWalletProfitability(evmAddress, "bsc")
            : Promise.resolve([]),
        ]);

        if (cancelled) return;

        // Build EVM PnL lookup by mint
        const evmPnlByMint = new Map<
          string,
          { pnl: number; pnlPercent?: number }
        >();
        for (const item of [...evmPnlBase, ...evmPnlBnb]) {
          evmPnlByMint.set(item.mint, {
            pnl: item.pnl,
            pnlPercent: item.pnlPercent,
          });
        }

        const combined: TokenPosition[] = [];
        const closed: TokenPosition[] = [];
        const SOLANA_LOGO =
          "https://assets.coingecko.com/coins/images/4128/small/solana.png";

        // 1) USDC first: Solana + Base + BNB combined (one row)
        const solBalance = portfolio.solBalance;
        const solanaUsdc = portfolio.usdcBalance;
        const baseUsdc = evmData?.base?.usdc ?? 0;
        const bnbUsdc = evmData?.bnb?.usdc ?? 0;
        const totalUsdc =
          (Number.isFinite(solanaUsdc) ? solanaUsdc : 0) + baseUsdc + bnbUsdc;
        if (totalUsdc > 0) {
          combined.push({
            mint: SOLANA_USDC_MINT,
            symbol: "USDC",
            name: "USDC",
            image: undefined,
            amount: totalUsdc,
            value: totalUsdc,
          });
        }
        setUsdcBalance(totalUsdc);

        // 2) SOL is in portfolio.positions (handled in step 5)

        // 4) EVM tokens (ETH, BNB, others) — open when amount > 0 and value > 0; else closed
        if (evmData?.evmAddress) {
          const addedMints = new Set<string>();
          if (evmData.base?.native > 0) {
            addedMints.add("base-eth");
            const evmPnl = evmPnlByMint.get("base-eth");
            const val = evmData.base.native * nativePrices.eth;
            const pos = {
              mint: "base-eth",
              symbol: "ETH",
              name: "Ethereum (Base)",
              amount: evmData.base.native,
              value: val,
              pnl: evmPnl?.pnl,
              pnlPercent: evmPnl?.pnlPercent,
              chain: "base" as const,
              image: undefined as string | undefined,
            };
            if (val > 0 && sellableAmount(pos) > 0) combined.push(pos);
            else closed.push(pos);
          }
          if (evmData.bnb?.native > 0) {
            addedMints.add("bnb-bnb");
            const evmPnl = evmPnlByMint.get("bnb-bnb");
            const val = evmData.bnb.native * nativePrices.bnb;
            const pos = {
              mint: "bnb-bnb",
              symbol: "BNB",
              name: "BNB",
              amount: evmData.bnb.native,
              value: val,
              pnl: evmPnl?.pnl,
              pnlPercent: evmPnl?.pnlPercent,
              chain: "bnb" as const,
              image: undefined as string | undefined,
            };
            if (val > 0 && sellableAmount(pos) > 0) combined.push(pos);
            else closed.push(pos);
          }
          const BASE_USDC_ADDR = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
          const BNB_USDC_ADDR = "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d";
          if (Array.isArray(evmData.tokens) && evmData.tokens.length > 0) {
            for (const t of evmData.tokens) {
              const amount = t.amount ?? 0;
              const value = t.value ?? 0;
              const m = (t.mint ?? "").toLowerCase();
              if (addedMints.has(m)) continue;
              // Skip USDC (already in combined USDC row); support both address and normalized mint
              if (m === BASE_USDC_ADDR || m === BNB_USDC_ADDR || m === "base-usdc" || m === "bnb-usdc") continue;
              addedMints.add(m);
              const evmPnl = evmPnlByMint.get(m);
              const pos: TokenPosition = {
                mint: m,
                symbol: t.symbol ?? "???",
                name: t.name ?? "Unknown Token",
                image: t.image,
                amount,
                value,
                pnl: evmPnl?.pnl,
                pnlPercent: evmPnl?.pnlPercent,
                chain: t.chain ?? "base",
              };
              if (amount > 0 && value > 0) combined.push(pos);
              else closed.push(pos);
            }
          }
        }

        // 5) SPL tokens from Birdeye portfolio (includes SOL; exclude USDC) — open when value > 0 and sellable > 0 for native; else closed
        for (const t of portfolio.positions) {
          const mint = t.mint;
          const symbol = (t.symbol || "").toUpperCase();
          if (mint === SOLANA_USDC_MINT) continue;
          const pos: TokenPosition = {
            mint,
            symbol: t.symbol || mint.slice(0, 8),
            name: t.name || "Unknown",
            image: t.image,
            amount: t.amount,
            value: t.value,
            pnl: t.pnl,
            pnlPercent: t.pnlPercent,
          };
          const hasSellable = sellableAmount(pos) > 0;
          if (t.amount > 0 && t.value > 0 && hasSellable) combined.push(pos);
          else closed.push(pos);
        }

        setOpenPositions(combined);
        setClosedPositions(closed);
        if (!cancelled) {
          apiCache.set(
            cacheKey,
            { openPositions: combined, closedPositions: closed },
            UI_CACHE_TTL_MS,
          );
        }
      } catch {
        if (!cancelled) {
          setOpenPositions([]);
          setClosedPositions([]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [walletAddress, user, refreshTrigger]);

  // Fetch stats
  useEffect(() => {
    if (user) {
      getPushNotificationStatus().then((status) => {
        setPushEnabled(status.enabled && status.permission === "granted");
      });

      user.getIdToken().then((token) => {
        getFollowersCount(token)
          .then(setFollowersCount)
          .catch(() => setFollowersCount(0));
      });
    }
  }, [user]);

  // Load evmAddress from user collection (or API) for deposit/withdraw when needed
  useEffect(() => {
    if (
      !user ||
      (selectedDepositChain !== "base" &&
        selectedDepositChain !== "bnb" &&
        withdrawNetwork !== "base" &&
        withdrawNetwork !== "bnb")
    ) {
      return;
    }
    if (userProfile?.evmAddress) {
      setEvmAddress(userProfile.evmAddress);
      return;
    }
    let cancelled = false;
    user
      .getIdToken()
      .then((token) => {
        const base = getApiBase();
        return fetch(`${base}/api/relay/evm-address`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data.evmAddress) setEvmAddress(data.evmAddress);
        else if (!cancelled) setEvmAddress(null);
      })
      .catch(() => {
        if (!cancelled) setEvmAddress(null);
      });
    return () => {
      cancelled = true;
    };
  }, [user, userProfile?.evmAddress, selectedDepositChain, withdrawNetwork]);

  const copyAddress = (value: string) => {
    navigator.clipboard.writeText(value);
    toast.success("Address copied!");
  };

  const fetchWithdrawQuote = async () => {
    if (!user || !walletAddress) return;
    const num = parseFloat(withdrawAmount);
    if (!Number.isFinite(num) || num <= 0 || num > usdcBalance) {
      toast.error("Enter a valid amount");
      return;
    }
    const dest = withdrawDestination.trim();
    if (!dest || dest.length < 20) {
      toast.error("Enter a valid destination address");
      return;
    }
    setWithdrawQuoteLoading(true);
    setWithdrawQuote(null);
    setWithdrawRequestId(null);
    try {
      const token = await user.getIdToken();
      const base = getApiBase();
      const res = await fetch(`${base}/api/relay/withdraw-quote`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          destinationNetwork: withdrawNetwork,
          amount: num,
          destinationAddress: dest,
          originAddress: walletAddress,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to get quote");
      setWithdrawQuote(data);
      const firstStep = data?.steps?.[0];
      if (firstStep?.requestId) setWithdrawRequestId(firstStep.requestId);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to get quote");
    } finally {
      setWithdrawQuoteLoading(false);
    }
  };

  const executeWithdraw = async () => {
    if (!user || !withdrawQuote) return;
    setWithdrawExecuting(true);
    try {
      const token = await user.getIdToken();
      const base = getApiBase();
      const res = await fetch(`${base}/api/relay/execute-step`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          quoteResponse: withdrawQuote,
          stepIndex: 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Execution failed");
      if (data.signature) {
        const completedAmount = parseFloat(withdrawAmount);
        const completedNetwork =
          withdrawNetwork === "solana"
            ? "Solana"
            : withdrawNetwork === "base"
              ? "Base"
              : "BNB";
        toast.success("Withdraw submitted", {
          description: "Transaction sent. Relay will complete the transfer.",
        });
        setWithdrawQuote(null);
        setWithdrawAmount("");
        if (Number.isFinite(completedAmount))
          setUsdcBalance((prev) => Math.max(0, prev - completedAmount));
        if (withdrawRequestId) {
          let attempts = 0;
          const interval = setInterval(async () => {
            attempts++;
            try {
              const status = await getIntentStatus(withdrawRequestId);
              if (
                status?.status === "filled" ||
                status?.status === "complete"
              ) {
                clearInterval(interval);
                toast.success("Withdraw complete");
                window.dispatchEvent(new CustomEvent("cope-refresh-balance"));
                user?.getIdToken().then((token) => {
                  const base = getApiBase();
                  fetch(`${base}/api/relay/notify-withdrawal-complete`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({
                      amount: completedAmount,
                      network: completedNetwork,
                    }),
                  }).catch(() => {});
                });
              }
            } catch {
              // ignore
            }
            if (attempts >= 30) clearInterval(interval);
          }, 2000);
        }
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Withdraw failed");
    } finally {
      setWithdrawExecuting(false);
    }
  };

  const handleTogglePublic = async () => {
    if (!user) return;

    setIsTogglingPublic(true);
    const previousValue = isPublic;
    const newValue = !previousValue;
    setIsPublic(newValue);
    try {
      await updatePublicWalletStatus(user.uid, newValue);
      toast.success(
        newValue ? "Wallet is now public" : "Wallet is now private",
      );
      // Sync webhook so private users' addresses are removed from Helius
      syncWebhook().catch(() => {});
    } catch (error) {
      setIsPublic(previousValue);
      console.error("Error toggling public wallet:", error);
      toast.error("Failed to update wallet visibility");
    } finally {
      setIsTogglingPublic(false);
    }
  };

  const handleTogglePush = async () => {
    if (!user) return;

    setIsTogglingPush(true);
    const previousValue = pushEnabled;
    try {
      if (!pushEnabled) {
        // Check if notifications are supported
        if (typeof Notification === "undefined") {
          toast.error("Push notifications are not supported on this device");
          setIsTogglingPush(false);
          return;
        }

        // Check current permission
        const permBefore = Notification.permission;
        if (permBefore === "denied") {
          toast.error(
            "Notification permission was denied. Please enable it in your browser settings.",
          );
          setIsTogglingPush(false);
          return;
        }

        // Get push token (automatically uses FCM or Web Push based on browser)
        const result = await requestPermissionAndGetPushToken();
        if (result && result.token) {
          setPushEnabled(true);
          await savePushTokenWithPlatform(result.token, result.platform);
          toast.success("Push notifications enabled");
        } else {
          // Token is null - re-check permission (may have changed during request)
          const permAfter = Notification.permission;
          if (permAfter === "denied") {
            toast.error(
              "Notification permission denied. Please enable it in your browser settings.",
            );
          } else if (permAfter === "default") {
            toast.error("Please allow notifications when prompted");
          } else {
            // Likely unsupported browser
            toast.info("Push notifications are not supported on this browser");
          }
        }
      } else {
        const token = getStoredPushToken();
        setPushEnabled(false);
        await unregisterPushToken(token || "");
        toast.success("Push notifications disabled");
      }
    } catch (error: any) {
      setPushEnabled(previousValue);
      console.error("Error toggling push notifications:", error);
      const errorMessage = error?.message || "";
      if (
        errorMessage.includes("unsupported") ||
        errorMessage.includes("not supported")
      ) {
        toast.info("Push notifications are not supported on this browser");
      } else {
        toast.error("Failed to update push notification settings");
      }
    } finally {
      setIsTogglingPush(false);
    }
  };

  const container = {
    animate: {
      transition: {
        staggerChildren: 0.06,
        delayChildren: 0.1,
      },
    },
  };

  const item = {
    initial: { opacity: 0, y: 12 },
    animate: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.35, ease: "easeOut" as const },
    },
  };

  // Only show positions with amount > 0 and value >= 0 (no ghost/zero balances)
  const displayedOpenPositions = openPositions; // openPositions now only contains tradeable (amount > 0 && value > 0)

  const handlePullRefresh = async () => {
    if (walletAddress) await fetchBalance();
    setRefreshTrigger((k) => k + 1);
  };

  return (
    <PullToRefresh onRefresh={handlePullRefresh}>
      <>
        <DocumentHead
          title="Profile"
          description="Your COPE profile, wallet, positions, and settings"
        />
        <motion.div
          className="p-4 sm:p-6 max-w-[720px] mx-auto pb-8"
          variants={container}
          initial="initial"
          animate="animate"
        >
          <motion.div
            className="mb-6 flex items-center justify-between"
            variants={item}
          >
            <h1 className="text-2xl font-bold">Profile</h1>
            <button
              onClick={() => setSettingsOpen(true)}
              data-tap-haptic
              className="tap-press p-2 rounded-full hover:bg-white/10 text-white/70 hover:text-white"
              aria-label="Settings"
            >
              <Settings className="w-5 h-5" />
            </button>
          </motion.div>

          {/* User + Stats merged card */}
          <motion.div variants={item} className="mb-6">
            <Card glass className="overflow-hidden">
              <div className="relative">
                {/* Subtle gradient header strip */}
                <div className="h-1 bg-gradient-to-r from-[#12d585]/40 via-[#08b16b]/30 to-transparent" />
                <div className="p-4 sm:p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
                    <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                      {avatar ? (
                        <img
                          src={avatar}
                          alt={xHandle}
                          className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl object-cover ring-2 ring-white/10 flex-shrink-0"
                        />
                      ) : (
                        <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-[#12d585] to-[#08b16b] flex items-center justify-center ring-2 ring-white/10 flex-shrink-0">
                          <span className="text-lg sm:text-xl font-bold text-[#000000]">
                            {xHandle.charAt(1)?.toUpperCase() || "U"}
                          </span>
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <h3 className="font-bold text-base sm:text-lg truncate">
                          {xHandle}
                        </h3>
                        <div className="flex items-center gap-2 text-sm text-white/60 mt-0.5">
                          <Twitter className="w-4 h-4" />
                          <span>Connected</span>
                        </div>
                        <button className="text-sm text-accent-primary hover:underline mt-0.5">
                          + Add a bio
                        </button>
                        {walletConnected && walletAddress && (
                          <div className="flex items-center gap-2 mt-1 min-w-0 overflow-hidden">
                            <code className="text-xs font-mono text-white/50 truncate">
                              {shortenAddress(walletAddress)}
                            </code>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Stats row - integrated */}
                    <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-6 pl-0 sm:pl-4 border-l-0 sm:border-l border-white/10 mt-2 sm:mt-0">
                      <button
                        onClick={() =>
                          navigate("/app/watchlist", {
                            state: { tab: "following" },
                          })
                        }
                        className="flex flex-col items-center min-w-0 flex-1 sm:flex-initial hover:opacity-80 transition-opacity py-1 active:scale-95"
                      >
                        <span className="text-lg sm:text-2xl font-bold">
                          {following.length}
                        </span>
                        <span className="text-[10px] sm:text-xs text-white/60">
                          Following
                        </span>
                      </button>
                      <button
                        onClick={() =>
                          navigate("/app/watchlist", {
                            state: { tab: "followers" },
                          })
                        }
                        className="flex flex-col items-center min-w-0 flex-1 sm:flex-initial hover:opacity-80 transition-opacity py-1 active:scale-95"
                      >
                        <span className="text-lg sm:text-2xl font-bold">
                          {followersCount ?? "—"}
                        </span>
                        <span className="text-[10px] sm:text-xs text-white/60">
                          Followers
                        </span>
                      </button>
                      <button
                        onClick={() =>
                          navigate("/app/watchlist", {
                            state: { tab: "watchlist" },
                          })
                        }
                        className="flex flex-col items-center min-w-0 flex-1 sm:flex-initial hover:opacity-80 transition-opacity py-1 active:scale-95"
                      >
                        <span className="text-lg sm:text-2xl font-bold">
                          {watchlistExternal.length}
                        </span>
                        <span className="text-[10px] sm:text-xs text-white/60">
                          Watchlist
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Total wallet balance (USDC + positions) + cash row - when connected */}
                  {walletConnected && walletAddress && (
                    <>
                      <div className="mt-4 pt-4 border-t border-white/10">
                        <p className="text-2xl sm:text-3xl font-bold">
                          {usdcBalanceLoading
                            ? "$0.00"
                            : `$${openPositions.reduce((s, p) => s + p.value, 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                        </p>
                        <p className="text-xs text-white/50 mt-0.5">
                          Total wallet balance (both wallets)
                        </p>
                      </div>
                      <div className="mt-4 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center">
                            <DollarSign className="w-4 h-4 text-white/70" />
                          </div>
                          <div>
                            <p className="text-sm text-white/60">
                              Cash balance
                            </p>
                            <p className="font-semibold">
                              {usdcBalanceLoading
                                ? "$0.00"
                                : `$${usdcBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => {
                              setDepositStep("chain");
                              setDepositSheetOpen(true);
                            }}
                            data-tap-haptic
                            className="tap-press w-9 h-9 min-w-[44px] min-h-[44px] rounded-full bg-white/10 hover:bg-white/15 flex items-center justify-center text-lg font-medium touch-manipulation"
                            aria-label="Deposit"
                          >
                            +
                          </button>
                          <button
                            onClick={() => {
                              setWithdrawStep("chain");
                              setWithdrawNetwork("solana");
                              setWithdrawAmount("");
                              setWithdrawDestination("");
                              setWithdrawQuote(null);
                              setWithdrawSheetOpen(true);
                            }}
                            data-tap-haptic
                            className="tap-press w-9 h-9 min-w-[44px] min-h-[44px] rounded-full bg-white/10 hover:bg-white/15 flex items-center justify-center text-white/70 touch-manipulation"
                            aria-label="Withdraw"
                          >
                            …
                          </button>
                        </div>
                      </div>
                      <div className="mt-4 pt-4 border-t border-white/10">
                        <button
                          onClick={() => navigate("/app/trade")}
                          data-tap-haptic
                          className="tap-press text-sm font-medium mb-2 block w-full text-left py-2 -mx-2 px-2 rounded-lg min-h-[44px] flex items-center hover:bg-white/5 active:bg-white/10 hover:text-accent-primary transition-colors touch-manipulation"
                        >
                          Open positions
                        </button>
                        {displayedOpenPositions.length === 0 ? (
                          <p className="text-sm text-white/50">
                            No open positions
                          </p>
                        ) : (
                          <ul className="space-y-2">
                            {displayedOpenPositions.map((pos) => {
                              const isNative =
                                pos.symbol === "SOL" ||
                                pos.symbol === "ETH" ||
                                pos.symbol === "BNB";
                              const quantityStr = isNative
                                ? pos.amount.toLocaleString(undefined, {
                                    minimumFractionDigits: 0,
                                    maximumFractionDigits: 4,
                                  })
                                : pos.amount.toLocaleString(undefined, {
                                    minimumFractionDigits: 0,
                                    maximumFractionDigits: 2,
                                  });
                              const pct =
                                pos.pnlPercent != null &&
                                !Number.isNaN(pos.pnlPercent)
                                  ? pos.pnlPercent
                                  : 0;
                              const pctPositive = pct >= 0;
                              return (
                                <li
                                  key={pos.mint}
                                  data-tap-haptic
                                  className="tap-press flex items-center gap-3 py-3 px-2 rounded-lg min-h-[44px] hover:bg-white/5 active:bg-white/10 touch-manipulation"
                                  role="button"
                                  onClick={() => {
                                    const params = new URLSearchParams({
                                      mint: pos.mint,
                                    });
                                    if (
                                      pos.chain === "base" ||
                                      pos.chain === "bnb"
                                    )
                                      params.set("chain", pos.chain);
                                    navigate(`/app/trade?${params.toString()}`);
                                  }}
                                >
                                  {pos.image ? (
                                    <img
                                      src={pos.image}
                                      alt=""
                                      className="w-9 h-9 rounded-full object-cover flex-shrink-0"
                                      onError={(e) => {
                                        (
                                          e.target as HTMLImageElement
                                        ).style.display = "none";
                                        (
                                          e.target as HTMLImageElement
                                        ).nextElementSibling?.classList.remove(
                                          "hidden",
                                        );
                                      }}
                                    />
                                  ) : null}
                                  <div
                                    className={`w-9 h-9 rounded-full bg-white/10 flex-shrink-0 ${pos.image ? "hidden" : ""}`}
                                  />
                                  <div className="flex-1 min-w-0">
                                    <p className="font-semibold truncate">
                                      {pos.name}
                                    </p>
                                    <p className="text-xs text-white/50 truncate">
                                      {quantityStr} {pos.symbol}
                                    </p>
                                  </div>
                                  <div className="text-right flex-shrink-0">
                                    <p className="font-semibold">
                                      $
                                      {pos.value.toLocaleString("en-US", {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                      })}
                                    </p>
                                    <p
                                      className={`text-sm flex items-center justify-end gap-0.5 ${pctPositive ? "text-[#12d585]" : "text-red-400"}`}
                                    >
                                      {pctPositive ? (
                                        <TrendingUp className="w-3.5 h-3.5" />
                                      ) : (
                                        <TrendingDown className="w-3.5 h-3.5" />
                                      )}
                                      {pctPositive ? "+" : ""}
                                      {pct.toFixed(2)}%
                                    </p>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                      <div className="mt-4 pt-4 border-t border-white/10">
                        <button
                          type="button"
                          data-tap-haptic
                          className="flex w-full items-center justify-between min-h-[44px] rounded-lg hover:bg-white/5 -m-2 p-2 transition-colors"
                          onClick={() => setClosedExpanded((v) => !v)}
                        >
                          <div className="flex items-center gap-2">
                            {closedExpanded ? (
                              <ChevronUp className="w-4 h-4 text-white/50 flex-shrink-0" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-white/50 flex-shrink-0" />
                            )}
                            <p className="text-sm font-medium">
                              Closed positions
                            </p>
                            {closedPositions.length > 0 && (
                              <span className="text-xs text-white/50">
                                ({closedPositions.length})
                              </span>
                            )}
                          </div>
                        </button>
                        {closedExpanded && (
                          <>
                            {closedPositions.length === 0 ? (
                              <p className="text-sm text-white/50 mt-2 pl-6">
                                No closed positions
                              </p>
                            ) : (
                              <ul className="space-y-2 mt-2 pl-2">
                                {closedPositions.map((pos) => (
                                  <li
                                    key={pos.mint}
                                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5"
                                  >
                                    {pos.image ? (
                                      <img
                                        src={pos.image}
                                        alt=""
                                        className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                                        onError={(e) => {
                                          (
                                            e.target as HTMLImageElement
                                          ).style.display = "none";
                                          (
                                            e.target as HTMLImageElement
                                          ).nextElementSibling?.classList.remove(
                                            "hidden",
                                          );
                                        }}
                                      />
                                    ) : null}
                                    <div
                                      className={`w-8 h-8 rounded-full bg-white/10 flex-shrink-0 ${pos.image ? "hidden" : ""}`}
                                    />
                                    <div className="flex-1 min-w-0">
                                      <p className="font-medium truncate">
                                        {pos.symbol}
                                      </p>
                                      <p className="text-xs text-white/50">
                                        {pos.amount > 0
                                          ? `${pos.amount.toLocaleString()} ${pos.symbol}`
                                          : "0 held"}
                                      </p>
                                    </div>
                                    <p className="text-sm flex-shrink-0">
                                      {`$${(pos.value ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                                    </p>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </>
                        )}
                      </div>
                      <div className="mt-2 flex justify-end">
                        <a
                          href={`https://solscan.io/account/${walletAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-accent-primary hover:text-accent-hover flex items-center gap-1"
                        >
                          View on Explorer
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </>
                  )}

                  {!walletConnected && (
                    <div className="mt-4 pt-4 border-t border-white/6 text-center">
                      <p className="text-sm text-white/60 mb-2">
                        No wallet connected
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => navigate("/auth/wallet-setup")}
                        className="text-accent-primary hover:text-accent-hover"
                      >
                        Connect Wallet
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          </motion.div>

          {/* Deposit sheet - from bottom: chain picker then deposit detail */}
          <Sheet
            open={depositSheetOpen}
            onOpenChange={(open) => {
              setDepositSheetOpen(open);
              if (!open) setDepositStep("chain");
            }}
          >
            <SheetContent
              side="bottom"
              className="bg-white/[0.06] backdrop-blur-xl border border-white/10 text-white w-full max-w-[100%] sm:max-w-md mx-auto rounded-t-2xl overflow-hidden flex flex-col shadow-2xl"
              style={{
                paddingBottom:
                  "calc(1rem + var(--safe-area-inset-bottom, 0px))",
              }}
            >
              <div
                className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#12d585]/50 via-[#08b16b]/40 to-transparent rounded-t-2xl"
                aria-hidden
              />
              <div
                className="absolute top-2.5 left-1/2 -translate-x-1/2 w-10 h-1 rounded-full bg-white/30"
                aria-hidden
              />
              {depositStep === "chain" ? (
                <>
                  <SheetHeader className="text-center pt-2">
                    <SheetTitle className="text-white text-xl">
                      Deposit crypto
                    </SheetTitle>
                  </SheetHeader>
                  <p className="text-sm text-white/70 text-center px-4 -mt-1">
                    Choose a chain to deposit from
                  </p>
                  <div className="p-4 space-y-3 flex-1 overflow-y-auto">
                    {(
                      [
                        { id: "solana" as const, label: "Solana" },
                        { id: "base" as const, label: "Base" },
                        { id: "bnb" as const, label: "BNB Chain" },
                      ] as const
                    ).map(({ id, label }) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          setSelectedDepositChain(id);
                          setDepositStep("detail");
                        }}
                        data-tap-haptic
                        className="w-full min-h-[44px] rounded-[12px] border border-white/20 bg-white/5 hover:bg-white/10 backdrop-blur-sm flex items-center justify-center px-4 py-3 touch-manipulation font-medium transition-colors hover:border-[#12d585]/30"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-3 p-4 border-b border-white/10">
                    <button
                      type="button"
                      onClick={() => setDepositStep("chain")}
                      data-tap-haptic
                      className="p-2 -ml-2 rounded-full hover:bg-white/10 min-w-[44px] min-h-[44px] flex items-center justify-center touch-manipulation"
                      aria-label="Back"
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                    <h2 className="text-lg font-semibold flex-1 text-center pr-10">
                      Deposit crypto
                    </h2>
                  </div>
                  <div className="p-4 flex-1 overflow-y-auto space-y-5 text-center">
                    {selectedDepositChain === "solana" && (
                      <>
                        <p className="text-sm text-white/90">
                          Send any token on the Solana network
                        </p>
                        <p className="text-sm text-white/60">
                          Deposit USDC to add to your cash balance
                        </p>
                      </>
                    )}
                    {(selectedDepositChain === "base" ||
                      selectedDepositChain === "bnb") && (
                      <>
                        <p className="text-sm text-white/90">
                          Send any token on the{" "}
                          {selectedDepositChain === "base"
                            ? "Base"
                            : "BNB Chain"}{" "}
                          network
                        </p>
                        <p className="text-sm text-white/60">
                          Deposit USDC to add to your cash balance
                        </p>
                      </>
                    )}
                    {(() => {
                      const address =
                        selectedDepositChain === "solana"
                          ? walletAddress
                          : selectedDepositChain === "base" ||
                              selectedDepositChain === "bnb"
                            ? evmAddress
                            : null;
                      const showQr = !!address;
                      return (
                        <>
                          {showQr ? (
                            <div className="w-48 h-48 mx-auto bg-white rounded-2xl flex items-center justify-center p-3 shadow-lg ring-1 ring-white/20">
                              <QRCodeSVG
                                value={address}
                                size={192}
                                level="H"
                                includeMargin={false}
                              />
                            </div>
                          ) : (
                            <div className="w-48 h-48 mx-auto bg-white/10 rounded-2xl flex items-center justify-center backdrop-blur-sm">
                              <p className="text-white/40 text-sm">
                                Loading address…
                              </p>
                            </div>
                          )}
                          {address && (
                            <div className="space-y-3 w-full">
                              <div className="w-full px-1">
                                <code className="block w-full px-3 py-2.5 bg-black/30 rounded-[12px] text-xs font-mono text-white/90 break-all text-center">
                                  {address}
                                </code>
                              </div>
                              <Button
                                onClick={() => copyAddress(address)}
                                className="w-full min-h-[44px] rounded-[12px] bg-gradient-to-r from-[#12d585]/20 to-[#08b16b]/20 border border-[#12d585]/30 hover:from-[#12d585]/30 hover:to-[#08b16b]/30 text-white font-medium"
                              >
                                <Copy className="w-4 h-4 mr-2 inline" />
                                Copy wallet address
                              </Button>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </>
              )}
            </SheetContent>
          </Sheet>

          {/* Withdraw sheet - from bottom: chain picker then amount + destination (same flow as deposit) */}
          <Sheet
            open={withdrawSheetOpen}
            onOpenChange={(open) => {
              setWithdrawSheetOpen(open);
              if (!open) {
                setWithdrawStep("chain");
                setWithdrawQuote(null);
                setWithdrawAmount("");
                setWithdrawDestination("");
              }
            }}
          >
            <SheetContent
              side="bottom"
              className="bg-white/[0.06] backdrop-blur-xl border border-white/10 text-white w-full max-w-[100%] sm:max-w-md mx-auto rounded-t-2xl overflow-hidden flex flex-col shadow-2xl"
              style={{
                paddingBottom:
                  "calc(1rem + var(--safe-area-inset-bottom, 0px))",
              }}
            >
              <div
                className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#12d585]/50 via-[#08b16b]/40 to-transparent rounded-t-2xl"
                aria-hidden
              />
              <div
                className="absolute top-2.5 left-1/2 -translate-x-1/2 w-10 h-1 rounded-full bg-white/30"
                aria-hidden
              />
              {withdrawStep === "chain" ? (
                <>
                  <SheetHeader className="text-center pt-2">
                    <SheetTitle className="text-white text-xl">
                      Withdraw
                    </SheetTitle>
                  </SheetHeader>
                  <p className="text-sm text-white/70 text-center px-4 -mt-1">
                    Choose a chain to withdraw to
                  </p>
                  <div className="p-4 space-y-3 flex-1 overflow-y-auto">
                    {(
                      [
                        { id: "solana" as const, label: "Solana" },
                        { id: "base" as const, label: "Base" },
                        { id: "bnb" as const, label: "BNB Chain" },
                      ] as const
                    ).map(({ id, label }) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          setWithdrawNetwork(id);
                          setWithdrawAmount("");
                          setWithdrawDestination("");
                          setWithdrawQuote(null);
                          setWithdrawStep("form");
                        }}
                        data-tap-haptic
                        className="w-full min-h-[44px] rounded-[12px] border border-white/20 bg-white/5 hover:bg-white/10 backdrop-blur-sm flex items-center justify-center px-4 py-3 touch-manipulation font-medium transition-colors hover:border-[#12d585]/30"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-3 p-4 border-b border-white/10">
                    <button
                      type="button"
                      onClick={() =>
                        !withdrawQuote
                          ? setWithdrawStep("chain")
                          : setWithdrawQuote(null)
                      }
                      data-tap-haptic
                      className="p-2 -ml-2 rounded-full hover:bg-white/10 min-w-[44px] min-h-[44px] flex items-center justify-center touch-manipulation"
                      aria-label="Back"
                    >
                      <ArrowLeft className="w-5 h-5" />
                    </button>
                    <h2 className="text-lg font-semibold flex-1 text-center pr-10">
                      Withdraw
                    </h2>
                  </div>
                  <div className="p-4 flex-1 overflow-y-auto space-y-4">
                    <p className="text-sm text-white/70 text-center">
                      Withdraw USDC to{" "}
                      {withdrawNetwork === "solana"
                        ? "Solana"
                        : withdrawNetwork === "base"
                          ? "Base"
                          : "BNB Chain"}
                      . You will receive USDC on the selected network.
                    </p>
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-white/80">
                        Amount (USDC)
                      </label>
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          placeholder="0.00"
                          value={withdrawAmount}
                          onChange={(e) => setWithdrawAmount(e.target.value)}
                          className="flex-1 min-w-0 min-h-[44px] bg-white/5 border-white/10 rounded-[12px]"
                        />
                        <Button
                          variant="outline"
                          onClick={() =>
                            setWithdrawAmount(usdcBalance.toFixed(2))
                          }
                          className="min-h-[44px] shrink-0 border-white/20 hover:bg-white/10"
                        >
                          Max
                        </Button>
                      </div>
                      <p className="text-xs text-white/50">
                        Available: {usdcBalance.toFixed(2)} USDC
                      </p>
                    </div>
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-white/80">
                        Destination address (
                        {withdrawNetwork === "solana"
                          ? "Solana"
                          : withdrawNetwork === "base"
                            ? "Base"
                            : "BNB"}
                        )
                      </label>
                      <Input
                        type="text"
                        placeholder={
                          withdrawNetwork === "solana"
                            ? "Enter Solana address"
                            : "Enter 0x address"
                        }
                        value={withdrawDestination}
                        onChange={(e) => setWithdrawDestination(e.target.value)}
                        className="min-w-0 min-h-[44px] bg-white/5 border-white/10 rounded-[12px]"
                      />
                    </div>
                    {!withdrawQuote ? (
                      <Button
                        onClick={fetchWithdrawQuote}
                        disabled={
                          withdrawQuoteLoading ||
                          !withdrawAmount ||
                          !withdrawDestination.trim()
                        }
                        className="w-full min-h-[44px] rounded-[12px] bg-gradient-to-r from-[#12d585] to-[#08b16b] text-[#000000] font-medium hover:opacity-90"
                      >
                        {withdrawQuoteLoading ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Getting quote...
                          </>
                        ) : (
                          "Get quote"
                        )}
                      </Button>
                    ) : (
                      <div className="space-y-3">
                        <p className="text-sm text-white/80 text-center">
                          Review and confirm withdraw
                        </p>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            className="flex-1 min-h-[44px] border-white/20 hover:bg-white/10"
                            onClick={() => setWithdrawQuote(null)}
                            disabled={withdrawExecuting}
                          >
                            Back
                          </Button>
                          <Button
                            className="flex-1 min-h-[44px] rounded-[12px] bg-gradient-to-r from-[#12d585] to-[#08b16b] text-[#000000] font-medium hover:opacity-90"
                            onClick={executeWithdraw}
                            disabled={withdrawExecuting}
                          >
                            {withdrawExecuting ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                Sending...
                              </>
                            ) : (
                              "Confirm"
                            )}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </SheetContent>
          </Sheet>

          {/* Settings sheet (cog) - bottom sheet, PWA safe area */}
          <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
            <SheetContent
              side="bottom"
              className="bg-white/[0.06] backdrop-blur-xl border border-white/10 text-white w-full max-w-[100%] sm:max-w-md mx-auto rounded-t-2xl overflow-y-auto shadow-2xl"
              style={{
                paddingBottom:
                  "calc(1rem + var(--safe-area-inset-bottom, 0px))",
              }}
            >
              <div
                className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#12d585]/50 via-[#08b16b]/40 to-transparent rounded-t-2xl"
                aria-hidden
              />
              <div
                className="absolute top-2.5 left-1/2 -translate-x-1/2 w-10 h-1 rounded-full bg-white/30"
                aria-hidden
              />
              <SheetHeader className="text-center pt-2">
                <SheetTitle className="text-white text-xl">Settings</SheetTitle>
              </SheetHeader>
              <div className="mt-6 space-y-1 overflow-y-auto flex-1 min-h-0">
                {/* Push Notifications Toggle */}
                <div className="flex items-center justify-between gap-3 py-3 rounded-xl hover:bg-white/5 active:bg-white/10 -mx-2 px-3 transition-colors min-h-[44px] touch-manipulation">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0">
                      <Bell className="w-4 h-4 text-white/70" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium text-sm">Push Notifications</p>
                      <p className="text-xs text-white/60">
                        Get notified about watched wallet trades
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={handleTogglePush}
                    disabled={isTogglingPush}
                    data-tap-haptic
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      pushEnabled ? "bg-accent-primary" : "bg-white/20"
                    } disabled:opacity-50`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        pushEnabled ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>

                {/* Public Wallet Toggle */}
                {walletAddress && (
                  <div className="flex items-center justify-between gap-3 py-3 rounded-xl hover:bg-white/5 active:bg-white/10 -mx-2 px-3 transition-colors border-t border-white/6 min-h-[44px] touch-manipulation">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0">
                        {isPublic ? (
                          <Globe className="w-4 h-4 text-accent-primary" />
                        ) : (
                          <GlobeLock className="w-4 h-4 text-white/70" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-sm">Public Wallet</p>
                        <p className="text-xs text-white/60">
                          {isPublic
                            ? "Your wallet is visible to others"
                            : "Your wallet is private"}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={handleTogglePublic}
                      disabled={isTogglingPublic}
                      data-tap-haptic
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        isPublic ? "bg-accent-primary" : "bg-white/20"
                      } disabled:opacity-50`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          isPublic ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                )}

                {/* Remove Wallet */}
                {walletAddress && (
                  <button
                    onClick={async () => {
                      if (
                        !confirm(
                          "Are you sure you want to remove your wallet? You will need to set it up again.",
                        )
                      ) {
                        return;
                      }
                      setIsRemovingWallet(true);
                      try {
                        await removeWallet();
                        setSettingsOpen(false);
                        navigate("/auth/wallet-setup");
                      } catch (error) {
                        console.error("Remove wallet error:", error);
                      } finally {
                        setIsRemovingWallet(false);
                      }
                    }}
                    data-tap-haptic
                    className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-[#FF4757]/10 active:bg-[#FF4757]/15 transition-colors text-left group min-h-[48px] mt-2"
                  >
                    <div className="w-9 h-9 rounded-lg bg-[#FF4757]/10 flex items-center justify-center flex-shrink-0">
                      <Trash2 className="w-4 h-4 text-[#FF4757]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-[#FF4757]">
                        {isRemovingWallet ? "Removing..." : "Remove Wallet"}
                      </p>
                      <p className="text-xs text-white/60">
                        Disconnect and delete wallet from account
                      </p>
                    </div>
                  </button>
                )}

                {/* Delete account */}
                <button
                  onClick={() => {
                    setSettingsOpen(false);
                    setShowDeleteConfirmModal(true);
                  }}
                  data-tap-haptic
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-[#FF4757]/10 active:bg-[#FF4757]/15 transition-colors text-left group min-h-[48px]"
                >
                  <div className="w-9 h-9 rounded-lg bg-[#FF4757]/10 flex items-center justify-center flex-shrink-0">
                    <Trash2 className="w-4 h-4 text-[#FF4757]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-[#FF4757]">
                      Delete account
                    </p>
                    <p className="text-xs text-white/60">
                      Permanently delete your account and all data
                    </p>
                  </div>
                </button>
              </div>
            </SheetContent>
          </Sheet>

          {/* Delete account confirmation modal - double verification */}
          <AlertDialog
            open={showDeleteConfirmModal}
            onOpenChange={setShowDeleteConfirmModal}
          >
            <AlertDialogContent className="bg-[#0f0f0f] border-white/10 text-white">
              <AlertDialogHeader>
                <AlertDialogTitle>Delete account?</AlertDialogTitle>
                <AlertDialogDescription className="text-white/70">
                  This will permanently delete your account and all data from
                  our platform. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="bg-white/10 border-white/10 text-white hover:bg-white/15">
                  Cancel
                </AlertDialogCancel>
                <button
                  onClick={async () => {
                    setIsDeletingAccount(true);
                    try {
                      await deleteAccount();
                      setShowDeleteConfirmModal(false);
                      navigate("/");
                    } catch {
                      // toast already shown by deleteAccount
                    } finally {
                      setIsDeletingAccount(false);
                    }
                  }}
                  disabled={isDeletingAccount}
                  data-tap-haptic
                  className="bg-[#FF4757] hover:bg-[#FF4757]/90 text-white px-4 py-2 rounded-lg font-medium disabled:opacity-50"
                >
                  {isDeletingAccount ? "Deleting…" : "Delete my account"}
                </button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Disconnect */}
          <motion.div variants={item}>
            <Card glass className="overflow-hidden border-white/10">
              <div className="p-4 sm:p-6">
                <button
                  onClick={async () => {
                    try {
                      await signOut();
                      navigate("/");
                    } catch (error) {
                      console.error("Sign out error:", error);
                    }
                  }}
                  disabled={loading}
                  data-tap-haptic
                  className="w-full flex items-center justify-center gap-3 py-3 min-h-[48px] rounded-xl border border-white/10 hover:border-[#FF4757]/30 hover:bg-[#FF4757]/5 active:bg-[#FF4757]/10 text-[#FF4757] transition-all duration-200 disabled:opacity-50"
                >
                  <LogOut className="w-5 h-5" />
                  <span className="font-medium">Disconnect</span>
                </button>
              </div>
            </Card>
          </motion.div>
        </motion.div>
      </>
    </PullToRefresh>
  );
}
