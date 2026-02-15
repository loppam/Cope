import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router";
import { motion } from "motion/react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import {
  Search,
  ScanLine,
  TrendingUp,
  Copy,
  ExternalLink,
  Loader2,
  ArrowUpRight,
  ArrowDownRight,
  ChevronRight,
  Star,
  BadgeCheck,
  Flame,
  Users,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  doc,
  getDoc,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { WalletNotification } from "@/lib/notifications";
import { shortenAddress, formatCurrency, getApiBase } from "@/lib/utils";
import { getUsdcBalance, getSolBalance } from "@/lib/rpc";
import { getWalletPositions, getSolPrice } from "@/lib/solanatracker";
import { fetchNativePrices } from "@/lib/coingecko";
import { SOL_MINT, SOLANA_USDC_MINT } from "@/lib/constants";
import { apiCache, UI_CACHE_TTL_MS } from "@/lib/cache";
import { toast } from "sonner";
import { DocumentHead } from "@/components/DocumentHead";
import { PullToRefresh } from "@/components/PullToRefresh";
import type { TrendingToken } from "../../api/trending-tokens";

type TabId = "plays" | "trending";
type FilterId = "star" | "verified" | "trending" | "held";

const TRENDING_FETCH_CAP = 25;
const TRENDING_REFETCH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export function Home() {
  const navigate = useNavigate();
  const { user, userProfile, watchlist } = useAuth();
  const [notifications, setNotifications] = useState<WalletNotification[]>([]);
  const [trending, setTrending] = useState<TrendingToken[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("trending");
  const [activeFilter, setActiveFilter] = useState<FilterId>("trending");
  const [refreshTrendingTrigger, setRefreshTrendingTrigger] = useState(0);

  // Balance header (when wallet connected)
  const [totalBalance, setTotalBalance] = useState<number | null>(null);
  const [balance24h, setBalance24h] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  const REFETCH_INTERVAL_MS = 60 * 1000;
  const NOTIFICATIONS_LIMIT = 50;

  const walletAddress = userProfile?.walletAddress ?? null;
  const walletConnected = userProfile?.walletConnected ?? false;

  function evmBalanceUsd(
    evmData: {
      base?: { usdc?: number; native?: number };
      bnb?: { usdc?: number; native?: number };
      tokens?: { value?: number }[];
    } | null,
    prices: { eth: number; bnb: number },
  ): number {
    if (!evmData) return 0;
    if (Array.isArray(evmData.tokens) && evmData.tokens.length > 0) {
      return evmData.tokens.reduce((s, t) => s + (t?.value ?? 0), 0);
    }
    const b = evmData.base ?? { usdc: 0, native: 0 };
    const n = evmData.bnb ?? { usdc: 0, native: 0 };
    return (
      (b.usdc ?? 0) +
      (b.native ?? 0) * prices.eth +
      (n.usdc ?? 0) +
      (n.native ?? 0) * prices.bnb
    );
  }

  // Fetch balance for header (USDC + Solana positions + SOL + EVM)
  // Cache-first: show 30s cache on page enter, then refetch in background
  useEffect(() => {
    if (!walletAddress || !walletConnected || !user) {
      setTotalBalance(null);
      setBalance24h(null);
      setBalanceLoading(false);
      return;
    }
    const cacheKey = `balance_${user.uid}`;
    const cached = apiCache.get<{ totalBalance: number; balance24h: number | null }>(cacheKey);
    if (cached) {
      setTotalBalance(cached.totalBalance);
      setBalance24h(cached.balance24h);
      setBalanceLoading(false);
    } else {
      setBalanceLoading(true);
    }
    let cancelled = false;
    const base = getApiBase();

    (async () => {
      try {
        const tokenPromise = user.getIdToken().then((t) =>
          fetch(`${base}/api/relay/evm-balances`, {
            headers: { Authorization: `Bearer ${t}` },
          })
            .then((r) => r.json())
            .catch(() => null),
        );

        const [usdc, positionsRes, solBal, solPrice, nativePrices, evmData] = await Promise.all([
          getUsdcBalance(walletAddress).catch(() => 0),
          getWalletPositions(walletAddress, true).catch(() => ({ total: 0, tokens: [], totalSol: 0 })),
          getSolBalance(walletAddress).catch(() => 0),
          getSolPrice().catch(() => 0),
          fetchNativePrices(),
          tokenPromise,
        ]);
        if (cancelled) return;

        // Same total as Profile: USDC (Solana + Base + BNB via evmVal) + SOL + EVM + SPL
        const solVal = (solBal ?? 0) * (solPrice ?? 0);
        const evmVal = evmBalanceUsd(evmData, nativePrices);
        const tokens = (positionsRes as { tokens?: Array<{ token: { mint: string; symbol?: string }; value?: number }> })?.tokens ?? [];
        let splVal = 0;
        for (const t of tokens) {
          const mint = t.token?.mint;
          const symbol = (t.token?.symbol ?? "").toUpperCase();
          if (mint === SOL_MINT || mint === SOLANA_USDC_MINT || symbol === "SOL") continue;
          splVal += t.value ?? 0;
        }
        const total = usdc + solVal + evmVal + splVal;

        setTotalBalance(total);

        const now = Date.now();
        const HOURS_MIN = 18;
        const HOURS_MAX = 30;

        // Prefer 24h from user doc (cron), fallback to balanceSnapshots
        let prev = 0;
        let prevAt = 0;
        const profilePrev = userProfile?.balancePrev;
        const profilePrevAt = userProfile?.balancePrevAt;
        if (
          profilePrev != null &&
          (typeof profilePrev === "number" || typeof profilePrev === "string")
        ) {
          prev = typeof profilePrev === "number" ? profilePrev : parseFloat(profilePrev) || 0;
          if (profilePrevAt != null) {
            prevAt =
              typeof profilePrevAt === "number"
                ? profilePrevAt
                : (profilePrevAt as Timestamp)?.toMillis?.() ?? 0;
          }
        }
        if (prevAt === 0) {
          const snapRef = doc(db, "balanceSnapshots", user!.uid);
          const snap = await getDoc(snapRef).catch(() => null);
          const data = snap?.data();
          prev = data?.prev ?? 0;
          prevAt = (data?.prevAt as Timestamp)?.toMillis?.() ?? 0;
        }
        const hoursAgo = prevAt > 0 ? (now - prevAt) / (60 * 60 * 1000) : 0;
        let balance24h: number | null = null;
        if (prevAt > 0 && hoursAgo >= HOURS_MIN && hoursAgo <= HOURS_MAX) {
          balance24h = total - prev;
          setBalance24h(balance24h);
        } else {
          setBalance24h(null);
        }

        if (!cancelled) {
          apiCache.set(cacheKey, { totalBalance: total, balance24h }, UI_CACHE_TTL_MS);
        }
      } catch {
        if (!cancelled) setTotalBalance(null);
      } finally {
        if (!cancelled) setBalanceLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [walletAddress, walletConnected, user, userProfile]);

  useEffect(() => {
    const onRefresh = () => {
      if (!walletAddress || !user) return;
      setBalanceLoading(true);
      const base = getApiBase();
      Promise.all([
        getUsdcBalance(walletAddress).catch(() => 0),
        getWalletPositions(walletAddress, false).catch(() => ({ total: 0 })),
        getSolBalance(walletAddress).catch(() => 0),
        getSolPrice().catch(() => 0),
        fetchNativePrices(),
        user.getIdToken().then((t) =>
          fetch(`${base}/api/relay/evm-balances`, {
            headers: { Authorization: `Bearer ${t}` },
          })
            .then((r) => r.json())
            .catch(() => null),
        ),
      ]).then(([usdc, positionsRes, solBal, solPrice, nativePrices, evmData]) => {
        const solVal = (solBal ?? 0) * (solPrice ?? 0);
        const evmVal = evmBalanceUsd(evmData, nativePrices);
        const tokens = (positionsRes as { tokens?: Array<{ token: { mint: string; symbol?: string }; value?: number }> })?.tokens ?? [];
        let splVal = 0;
        for (const t of tokens) {
          const mint = t.token?.mint;
          const symbol = (t.token?.symbol ?? "").toUpperCase();
          if (mint === SOL_MINT || mint === SOLANA_USDC_MINT || symbol === "SOL") continue;
          splVal += t.value ?? 0;
        }
        const total = usdc + solVal + evmVal + splVal;
        setTotalBalance(total);
      }).catch(() => setTotalBalance(null)).finally(() => setBalanceLoading(false));
    };
    window.addEventListener("cope-refresh-balance", onRefresh);
    return () => window.removeEventListener("cope-refresh-balance", onRefresh);
  }, [walletAddress, user]);

  // Fetch notifications (cache-first: 30s cache on page enter, then refetch in background)
  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    const watchedAddresses = watchlist.map((w) => w.address);
    if (watchedAddresses.length === 0) {
      setNotifications([]);
      setLoading(false);
      return;
    }

    const cacheKey = `notifications_${user.uid}`;
    const cached = apiCache.get<WalletNotification[]>(cacheKey);
    if (cached) {
      const filtered = cached.filter((n) => watchedAddresses.includes(n.walletAddress));
      setNotifications(filtered);
      setLoading(false);
    }

    const notificationsRef = collection(db, "notifications");

    async function fetchNotifications() {
      try {
        const q = query(
          notificationsRef,
          where("userId", "==", user!.uid),
          orderBy("createdAt", "desc"),
          limit(NOTIFICATIONS_LIMIT),
        );
        let snapshot;
        try {
          snapshot = await getDocs(q);
        } catch (err: any) {
          if (err?.code === "failed-precondition") {
            const fallbackQ = query(
              notificationsRef,
              where("userId", "==", user!.uid),
              limit(NOTIFICATIONS_LIMIT),
            );
            snapshot = await getDocs(fallbackQ);
          } else {
            throw err;
          }
        }
        const rawList = snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter((n: any) => !n.deleted)
          .sort((a: any, b: any) => {
            const aTime = a.createdAt?.toDate?.()?.getTime() || 0;
            const bTime = b.createdAt?.toDate?.()?.getTime() || 0;
            return bTime - aTime;
          }) as WalletNotification[];
        apiCache.set(cacheKey, rawList, UI_CACHE_TTL_MS);
        const filtered = rawList.filter((n) => watchedAddresses.includes(n.walletAddress));
        setNotifications(filtered);
      } catch (error) {
        console.error("Error fetching notifications:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchNotifications();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") fetchNotifications();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    const intervalId = setInterval(() => {
      if (document.visibilityState === "visible") fetchNotifications();
    }, REFETCH_INTERVAL_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearInterval(intervalId);
    };
  }, [user, watchlist]);

  // sort_by for API: liquidity helps Verified/Most held; rank for Trending/Top gainers
  const trendingSortBy =
    activeFilter === "verified" || activeFilter === "held" ? "liquidity" : "rank";

  // Fetch trending tokens (Birdeye, multi-chain). Cap at TRENDING_FETCH_CAP. Refetch every 30 mins.
  useEffect(() => {
    let cancelled = false;
    const base = getApiBase();
    const cacheKey = `trending_tokens_${trendingSortBy}`;
    if (refreshTrendingTrigger > 0) apiCache.clear(cacheKey);
    const cached = apiCache.get<{ tokens: TrendingToken[] }>(cacheKey);
    if (cached?.tokens?.length) {
      setTrending(cached.tokens);
      setTrendingLoading(false);
    } else {
      setTrendingLoading(true);
    }

    async function fetchTrending() {
      try {
        const res = await fetch(
          `${base}/api/trending-tokens?offset=0&limit=${TRENDING_FETCH_CAP}&sort_by=${trendingSortBy}&interval=4h`,
        );
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        const tokens = Array.isArray(data?.tokens) ? data.tokens.slice(0, TRENDING_FETCH_CAP) : [];
        setTrending(tokens);
        if (tokens.length > 0) {
          apiCache.set(cacheKey, { tokens }, UI_CACHE_TTL_MS);
        }
      } catch (error) {
        console.error("Error fetching trending tokens:", error);
      } finally {
        if (!cancelled) setTrendingLoading(false);
      }
    }

    fetchTrending();
    const intervalId = setInterval(fetchTrending, TRENDING_REFETCH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [trendingSortBy, refreshTrendingTrigger]);

  const formatTime = (timestamp: any) => {
    if (!timestamp) return "Just now";
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const formatTokenAmount = (value: number | undefined | null) => {
    if (value == null || Number.isNaN(value)) return null;
    const abs = Math.abs(value);
    if (abs >= 1000000) return `${(value / 1000000).toFixed(2)}M`;
    if (abs >= 1000) return `${(value / 1000).toFixed(2)}K`;
    const maximumFractionDigits = abs >= 1 ? 4 : 6;
    return value.toLocaleString("en-US", { maximumFractionDigits });
  };

  const getAmountLabel = (notification: WalletNotification) => {
    if (notification.amount != null && notification.amountSymbol) {
      const formatted = formatTokenAmount(notification.amount);
      return formatted ? `${formatted} ${notification.amountSymbol}` : null;
    }
    if (notification.amountUsd != null) {
      return formatCurrency(notification.amountUsd);
    }
    return null;
  };

  const getWalletNickname = (walletAddress: string) => {
    const watched = watchlist.find((w) => w.address === walletAddress);
    return watched?.nickname || shortenAddress(walletAddress);
  };

  const handleCopyTrade = (e: React.MouseEvent, notification: WalletNotification) => {
    e.stopPropagation();
    if (!notification.tokenAddress) {
      toast.error("No token address available for this trade");
      return;
    }
    navigate("/app/trade", {
      state: {
        mint: notification.tokenAddress,
        chain: "solana",
        fromFeed: true,
        walletNickname: getWalletNickname(notification.walletAddress),
      },
    });
  };

  const handleTokenClick = (token: TrendingToken) => {
    const chain = token.chainId === "bsc" ? "bnb" : token.chainId;
    navigate("/app/trade", {
      state: {
        mint: token.tokenAddress,
        chain,
        fromFeed: true,
      },
    });
  };

  const getTradeIcon = (type: string) => {
    switch (type) {
      case "buy":
        return <ArrowDownRight className="w-4 h-4 text-[#12d585]" />;
      case "sell":
        return <ArrowUpRight className="w-4 h-4 text-[#FF6B6B]" />;
      case "swap":
        return <ArrowDownRight className="w-4 h-4 text-[#54A0FF]" />;
      default:
        return <TrendingUp className="w-4 h-4 text-white/60" />;
    }
  };

  const getTradeTypeLabel = (type: string) => {
    switch (type) {
      case "buy":
        return "Buy";
      case "sell":
        return "Sell";
      case "swap":
        return "Swap";
      default:
        return "Transaction";
    }
  };

  const formatMarketCap = (val: number) => {
    if (!val || Number.isNaN(val)) return "—";
    if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(2)}M`;
    if (val >= 1_000) return `$${(val / 1_000).toFixed(2)}K`;
    return `$${val.toFixed(2)}`;
  };

  const formatPrice = (val: string) => {
    if (!val || val === "0") return "—";
    const n = parseFloat(val);
    if (Number.isNaN(n)) return val;
    if (n < 0.0001) return `$${n.toExponential(2)}`;
    if (n >= 1) return `$${n.toFixed(4)}`;
    return `$${n.toFixed(6)}`;
  };

  const filterPills: { id: FilterId; icon: React.ReactNode; label: string }[] = [
    { id: "star", icon: <Star className="w-3.5 h-3.5" />, label: "Top gainers" },
    { id: "verified", icon: <BadgeCheck className="w-3.5 h-3.5" />, label: "Verified" },
    { id: "trending", icon: <Flame className="w-3.5 h-3.5" />, label: "Trending" },
    { id: "held", icon: <Users className="w-3.5 h-3.5" />, label: "Most held" },
  ];

  const filteredTrending = useMemo(() => {
    const list = [...trending];
    switch (activeFilter) {
      case "star":
        return list.sort((a, b) => {
          const ah = a.priceChange24 ?? -Infinity;
          const bh = b.priceChange24 ?? -Infinity;
          return bh - ah;
        });
      case "verified":
        return list.filter((t) => t.marketCap >= 500_000);
      case "held":
        return list.sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
      case "trending":
      default:
        return list;
    }
  }, [trending, activeFilter]);

  const handlePullRefresh = useCallback(async () => {
    window.dispatchEvent(new CustomEvent("cope-refresh-balance"));
    setRefreshTrendingTrigger((t) => t + 1);
  }, []);

  return (
    <PullToRefresh onRefresh={handlePullRefresh}>
      <>
        <DocumentHead
          title="Home"
          description="Trending tokens and your followed plays on COPE"
        />
        <div className="p-4 sm:p-6 max-w-[720px] mx-auto pb-8">
        {/* Wallet balance header – when connected */}
        {walletConnected && walletAddress && (
          <div className="mb-5 flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-2xl sm:text-3xl font-bold tracking-tight text-white truncate">
                {balanceLoading || totalBalance == null
                  ? "$0.00"
                  : `$${totalBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </p>
              <p
                className={`text-sm mt-0.5 ${
                  balance24h != null && balance24h >= 0
                    ? "text-[#12d585]"
                    : balance24h != null
                      ? "text-[#FF6B6B]"
                      : "text-white/50"
                }`}
              >
                {balance24h != null
                  ? `${balance24h >= 0 ? "+" : ""}$${balance24h.toFixed(2)} 24h`
                  : "+$0.00 24h"}
              </p>
            </div>
            <button
              onClick={() => navigate("/app/profile?open=deposit")}
              data-tap-haptic
              className="tap-press flex-shrink-0 min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl bg-[#3B82F6] hover:bg-[#2563EB] text-white font-medium text-sm transition-colors"
            >
              Deposit
            </button>
          </div>
        )}

        {/* Two primary CTAs – in place of Weekly Top Trades */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <button
            onClick={() => navigate("/cope/wallet")}
            data-tap-haptic
            className="tap-press flex flex-col items-center justify-center gap-2 p-4 min-h-[72px] rounded-2xl bg-gradient-to-br from-accent-primary/25 to-accent-primary/10 border border-accent-primary/30 hover:border-accent-primary/50 transition-colors text-left w-full"
          >
            <Search className="w-6 h-6 text-accent-primary flex-shrink-0" />
            <span className="font-semibold text-white text-sm">Scan a Wallet</span>
            <span className="text-xs text-white/60">Follow & copy</span>
          </button>
          <button
            onClick={() => navigate("/scanner")}
            data-tap-haptic
            className="tap-press flex flex-col items-center justify-center gap-2 p-4 min-h-[72px] rounded-2xl bg-white/5 border border-white/10 hover:border-white/20 hover:bg-white/[0.07] transition-colors text-left w-full"
          >
            <ScanLine className="w-6 h-6 text-accent-purple flex-shrink-0" />
            <span className="font-semibold text-white text-sm">COPE Scanner</span>
            <span className="text-xs text-white/60">Find top traders</span>
          </button>
        </div>

        {/* Filter pills */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 scrollbar-hide mb-4">
          {filterPills.map(({ id, icon, label }) => (
            <button
              key={id}
              onClick={() => setActiveFilter(id)}
              data-tap-haptic
              className={`tap-press flex items-center gap-1.5 flex-shrink-0 px-3 py-2 rounded-full text-sm font-medium min-h-[44px] transition-colors ${
                activeFilter === id
                  ? "bg-white/15 text-white"
                  : "bg-white/5 text-white/60 hover:text-white/80"
              }`}
            >
              {icon}
              {label && <span>{label}</span>}
            </button>
          ))}
        </div>

        {/* Tabs: Your Plays | Trending */}
        <div className="flex gap-1 p-1 rounded-xl bg-white/5 border border-white/5 mb-4">
          <button
            onClick={() => setActiveTab("trending")}
            data-tap-haptic
            className={`tap-press flex-1 py-2.5 rounded-lg text-sm font-medium min-h-[44px] transition-colors ${
              activeTab === "trending"
                ? "bg-white/10 text-white"
                : "text-white/60 hover:text-white/80"
            }`}
          >
            Trending
          </button>
          <button
            onClick={() => setActiveTab("plays")}
            data-tap-haptic
            className={`tap-press flex-1 py-2.5 rounded-lg text-sm font-medium min-h-[44px] transition-colors ${
              activeTab === "plays"
                ? "bg-white/10 text-white"
                : "text-white/60 hover:text-white/80"
            }`}
          >
            Your Plays
          </button>
        </div>

        {/* Trending feed with lazy scroll */}
        {activeTab === "trending" && (
          <>
            {trendingLoading ? (
              <div className="flex flex-col items-center justify-center py-16">
                <Loader2 className="w-8 h-8 animate-spin text-accent-primary mb-4" />
                <p className="text-white/60 text-sm">Loading trending tokens...</p>
              </div>
            ) : filteredTrending.length === 0 ? (
              <Card glass className="overflow-hidden">
                <div className="p-8 text-center">
                  <div className="w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-4">
                    <TrendingUp className="w-7 h-7 text-white/40" />
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2">
                    No trending data
                  </h3>
                  <p className="text-sm text-white/60 max-w-xs mx-auto">
                    Trending tokens will appear here. Try again later.
                  </p>
                </div>
              </Card>
            ) : (
              <motion.div
                className="space-y-1"
                initial="initial"
                animate="animate"
                variants={{
                  animate: {
                    transition: {
                      staggerChildren: 0.03,
                      delayChildren: 0.05,
                    },
                  },
                }}
              >
                {filteredTrending.map((token) => (
                  <motion.button
                    key={`${token.chainId}-${token.tokenAddress}`}
                    variants={{
                      initial: { opacity: 0, y: 8 },
                      animate: {
                        opacity: 1,
                        y: 0,
                        transition: { duration: 0.25, ease: "easeOut" },
                      },
                    }}
                    onClick={() => handleTokenClick(token)}
                    data-tap-haptic
                    className="tap-press w-full flex items-center gap-3 p-3 sm:p-4 rounded-xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] hover:border-white/10 transition-all text-left min-h-[68px]"
                  >
                    <div className="relative w-11 h-11 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0 overflow-hidden">
                      {token.imageUrl ? (
                        <img
                          src={token.imageUrl}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-lg font-bold text-white/50">
                          {token.symbol?.slice(0, 1) ?? "?"}
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white truncate">
                          {token.symbol ?? "—"}
                        </span>
                        <span className="text-xs text-white/50 truncate hidden sm:inline">
                          {token.name}
                        </span>
                      </div>
                      <p className="text-xs text-white/50 truncate mt-0.5">
                        {formatMarketCap(token.marketCap)} MC
                        {token.volumeChange24 != null && (
                          <span
                            className={
                              token.volumeChange24 >= 0
                                ? " text-[#12d585]"
                                : " text-[#FF6B6B]"
                            }
                          >
                            {" "}
                            Vol {token.volumeChange24 >= 0 ? "+" : ""}
                            {token.volumeChange24.toFixed(1)}%
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                      <span className="font-medium text-white text-sm tabular-nums">
                        {formatPrice(token.priceUsd)}
                      </span>
                      <span
                        className={`text-xs font-medium tabular-nums inline-flex items-center gap-0.5 ${
                          token.priceChange24 != null
                            ? token.priceChange24 >= 0
                              ? "text-[#12d585]"
                              : "text-[#FF6B6B]"
                            : "text-white/50"
                        }`}
                      >
                        {token.priceChange24 != null ? (
                          <>
                            {token.priceChange24 >= 0 ? (
                              <span aria-hidden>▲</span>
                            ) : (
                              <span aria-hidden>▼</span>
                            )}
                            {` ${Math.abs(token.priceChange24).toFixed(2)}%`}
                          </>
                        ) : (
                          "—"
                        )}
                      </span>
                    </div>
                    <ChevronRight className="w-5 h-5 text-white/30 flex-shrink-0" />
                  </motion.button>
                ))}
              </motion.div>
            )}
          </>
        )}

        {/* Your Plays feed */}
        {activeTab === "plays" && (
          <>
            {loading ? (
              <div className="flex flex-col items-center justify-center py-16">
                <Loader2 className="w-8 h-8 animate-spin text-accent-primary mb-4" />
                <p className="text-white/60 text-sm">Loading your plays...</p>
              </div>
            ) : notifications.length === 0 ? (
              <Card glass className="overflow-hidden">
                <div className="h-0.5 bg-gradient-to-r from-accent-primary/30 to-transparent" />
                <div className="p-6 sm:p-8 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-accent-primary/10 flex items-center justify-center mx-auto mb-4">
                    <TrendingUp className="w-8 h-8 text-accent-primary" />
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2">
                    No Plays Yet
                  </h3>
                  <p className="text-white/60 text-sm max-w-sm mx-auto mb-6">
                    Follow wallets or run the Scanner to see their trades here
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2 justify-center">
                    <Button
                      onClick={() => navigate("/cope/wallet")}
                      variant="primary"
                      size="sm"
                      className="min-h-[44px]"
                    >
                      <Search className="w-4 h-4" />
                      Scan a Wallet
                    </Button>
                    <Button
                      onClick={() => navigate("/scanner")}
                      variant="secondary"
                      size="sm"
                      className="min-h-[44px]"
                    >
                      <ScanLine className="w-4 h-4 text-accent-purple" />
                      COPE Scanner
                    </Button>
                  </div>
                </div>
              </Card>
            ) : (
              <motion.div
                className="space-y-3"
                initial="initial"
                animate="animate"
                variants={{
                  animate: {
                    transition: {
                      staggerChildren: 0.05,
                      delayChildren: 0.08,
                    },
                  },
                }}
              >
                {notifications.map((notification) => {
                  const amountLabel = getAmountLabel(notification);
                  return (
                    <motion.div
                      key={notification.id}
                      variants={{
                        initial: { opacity: 0, y: 12 },
                        animate: {
                          opacity: 1,
                          y: 0,
                          transition: { duration: 0.35, ease: "easeOut" },
                        },
                      }}
                    >
                      <Card
                        glass
                        className="overflow-hidden hover:border-white/15 transition-colors"
                      >
                        <div className="h-0.5 bg-gradient-to-r from-[#12d585]/20 to-transparent" />
                        <div className="p-4">
                          <div className="flex items-start gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                {getTradeIcon(notification.type)}
                                <span className="text-xs font-medium text-white/70 uppercase">
                                  {getTradeTypeLabel(notification.type)}
                                </span>
                              </div>
                              <h3 className="font-semibold text-white truncate">
                                {getWalletNickname(notification.walletAddress)}
                              </h3>
                              <p className="text-sm text-white/70 line-clamp-2 mt-1">
                                {notification.message}
                              </p>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/50 mt-2">
                                {amountLabel && (
                                  <span className="font-medium text-white/70">
                                    {amountLabel}
                                  </span>
                                )}
                                {notification.tokenAddress && (
                                  <code className="font-mono">
                                    {shortenAddress(notification.tokenAddress)}
                                  </code>
                                )}
                                <span>{formatTime(notification.createdAt)}</span>
                              </div>
                              {notification.txHash && (
                                <a
                                  href={`https://solscan.io/tx/${notification.txHash}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-xs text-accent-primary hover:text-accent-hover mt-2"
                                >
                                  View TX
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </div>
                            {notification.tokenAddress && (
                              <Button
                                onClick={(e) =>
                                  handleCopyTrade(e, notification)
                                }
                                variant="primary"
                                size="sm"
                                className="flex-shrink-0 min-h-[44px] min-w-[44px]"
                              >
                                <Copy className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </Card>
                    </motion.div>
                  );
                })}
              </motion.div>
            )}
          </>
        )}

        {/* Info card */}
        <div className="mt-8">
          <Card glass className="overflow-hidden">
            <div className="h-0.5 bg-gradient-to-r from-accent-purple/30 to-transparent" />
            <div className="p-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-8 h-8 rounded-lg bg-accent-purple/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-accent-purple text-sm">💡</span>
                </div>
                <h4 className="font-semibold text-white text-sm">What is COPE?</h4>
              </div>
              <p className="text-sm text-white/60 leading-relaxed">
                <span className="text-accent-primary font-medium">COPE</span> =
                Catch Onchain Plays Early. Follow proven wallets, see their
                verified trades in real-time, and copy plays instantly.
              </p>
            </div>
          </Card>
        </div>
      </div>
      </>
    </PullToRefresh>
  );
}
