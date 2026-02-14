import { useState, useEffect, useRef } from "react";
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
  Brain,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { WalletNotification } from "@/lib/notifications";
import { shortenAddress, formatCurrency, getApiBase } from "@/lib/utils";
import { getUsdcBalance, getSolBalance } from "@/lib/rpc";
import { getWalletPositions, getSolPrice } from "@/lib/solanatracker";
import { toast } from "sonner";
import { DocumentHead } from "@/components/DocumentHead";
import type { TrendingToken } from "../../api/trending-tokens";

type TabId = "plays" | "trending";
type FilterId = "star" | "verified" | "trending" | "held";

const LAZY_PAGE_SIZE = 12;

export function Home() {
  const navigate = useNavigate();
  const { user, userProfile, watchlist } = useAuth();
  const [notifications, setNotifications] = useState<WalletNotification[]>([]);
  const [trending, setTrending] = useState<TrendingToken[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("trending");
  const [activeFilter, setActiveFilter] = useState<FilterId>("trending");
  const [visibleTrendingCount, setVisibleTrendingCount] = useState(LAZY_PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Balance header (when wallet connected)
  const [totalBalance, setTotalBalance] = useState<number | null>(null);
  const [balance24h, setBalance24h] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  const REFETCH_INTERVAL_MS = 60 * 1000;
  const NOTIFICATIONS_LIMIT = 50;

  const walletAddress = userProfile?.walletAddress ?? null;
  const walletConnected = userProfile?.walletConnected ?? false;

  // Fetch balance for header (USDC + positions)
  useEffect(() => {
    if (!walletAddress || !walletConnected) {
      setTotalBalance(null);
      setBalance24h(null);
      setBalanceLoading(false);
      return;
    }
    let cancelled = false;
    setBalanceLoading(true);
    (async () => {
      try {
        const [usdc, positionsRes, solBal, solPrice] = await Promise.all([
          getUsdcBalance(walletAddress),
          getWalletPositions(walletAddress, true).catch(() => ({ total: 0, tokens: [], totalSol: 0 })),
          getSolBalance(walletAddress),
          getSolPrice().catch(() => 0),
        ]);
        if (cancelled) return;
        const res = positionsRes as { total?: number; tokens?: { value?: number }[] };
        const positionsValue = res?.total ?? (Array.isArray(res?.tokens)
          ? (res.tokens as any[]).reduce((s, p) => s + (p?.value ?? 0), 0)
          : 0);
        const solValue = (solBal ?? 0) * (solPrice ?? 0);
        setTotalBalance(usdc + positionsValue + solValue);
        setBalance24h(null); // Placeholder – 24h portfolio delta would need historical data
      } catch {
        if (!cancelled) setTotalBalance(null);
      } finally {
        if (!cancelled) setBalanceLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [walletAddress, walletConnected]);

  useEffect(() => {
    const onRefresh = () => {
      if (!walletAddress) return;
      setBalanceLoading(true);
      Promise.all([
        getUsdcBalance(walletAddress),
        getWalletPositions(walletAddress, false).catch(() => ({ total: 0, tokens: [], totalSol: 0 })),
        getSolBalance(walletAddress),
        getSolPrice().catch(() => 0),
      ]).then(([usdc, positionsRes, solBal, solPrice]) => {
        const res = positionsRes as { total?: number };
        const posVal = res?.total ?? 0;
        const solVal = (solBal ?? 0) * (solPrice ?? 0);
        setTotalBalance(usdc + posVal + solVal);
      }).catch(() => setTotalBalance(null)).finally(() => setBalanceLoading(false));
    };
    window.addEventListener("cope-refresh-balance", onRefresh);
    return () => window.removeEventListener("cope-refresh-balance", onRefresh);
  }, [walletAddress]);

  // Fetch notifications
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
        const fetched = snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter(
            (n: any) =>
              !n.deleted && watchedAddresses.includes(n.walletAddress),
          )
          .sort((a: any, b: any) => {
            const aTime = a.createdAt?.toDate?.()?.getTime() || 0;
            const bTime = b.createdAt?.toDate?.()?.getTime() || 0;
            return bTime - aTime;
          }) as WalletNotification[];
        setNotifications(fetched);
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

  // Fetch trending tokens
  useEffect(() => {
    let cancelled = false;
    const base = getApiBase();

    async function fetchTrending() {
      try {
        setTrendingLoading(true);
        const res = await fetch(`${base}/api/trending-tokens`);
        const data = await res.json().catch(() => ({}));
        if (!cancelled && Array.isArray(data?.tokens)) {
          setTrending(data.tokens);
          setVisibleTrendingCount(LAZY_PAGE_SIZE);
        }
      } catch (error) {
        console.error("Error fetching trending tokens:", error);
      } finally {
        if (!cancelled) setTrendingLoading(false);
      }
    }

    fetchTrending();
    return () => {
      cancelled = true;
    };
  }, []);

  // Lazy load more trending on scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || activeTab !== "trending" || trending.length <= visibleTrendingCount)
      return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleTrendingCount((n) => Math.min(n + LAZY_PAGE_SIZE, trending.length));
        }
      },
      { rootMargin: "100px", threshold: 0.1 },
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [activeTab, trending.length, visibleTrendingCount]);

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
    { id: "star", icon: <Star className="w-3.5 h-3.5" />, label: "" },
    { id: "verified", icon: <BadgeCheck className="w-3.5 h-3.5" />, label: "Verified" },
    { id: "trending", icon: <Flame className="w-3.5 h-3.5" />, label: "Trending" },
    { id: "held", icon: <Users className="w-3.5 h-3.5" />, label: "Most held" },
  ];

  return (
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
                {balanceLoading
                  ? "—"
                  : totalBalance != null
                    ? `$${totalBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                    : "—"}
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
                  : "— 24h"}
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

        {/* Featured card */}
        <button
          onClick={() => setActiveTab("trending")}
          data-tap-haptic
          className="tap-press w-full mb-5 rounded-2xl overflow-hidden bg-gradient-to-br from-orange-500/40 via-red-500/30 to-orange-600/20 border border-orange-400/20 hover:border-orange-400/40 transition-colors text-left"
        >
          <div className="p-4 sm:p-5 flex items-center gap-4 min-h-[88px]">
            <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
              <Brain className="w-6 h-6 text-orange-400" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-white text-base">AI Tokens</h3>
              <p className="text-sm text-white/70 mt-0.5">Viral tokens from the AI meta</p>
            </div>
            <ChevronRight className="w-5 h-5 text-white/50 flex-shrink-0" />
          </div>
        </button>

        {/* Two primary CTAs – in place of Weekly Top Trades */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <button
            onClick={() => navigate("/scanner")}
            data-tap-haptic
            className="tap-press flex flex-col items-center justify-center gap-2 p-4 min-h-[72px] rounded-2xl bg-gradient-to-br from-accent-primary/25 to-accent-primary/10 border border-accent-primary/30 hover:border-accent-primary/50 transition-colors text-left w-full"
          >
            <ScanLine className="w-6 h-6 text-accent-primary flex-shrink-0" />
            <span className="font-semibold text-white text-sm">COPE Scanner</span>
            <span className="text-xs text-white/60">Find top traders</span>
          </button>
          <button
            onClick={() => navigate("/cope/wallet")}
            data-tap-haptic
            className="tap-press flex flex-col items-center justify-center gap-2 p-4 min-h-[72px] rounded-2xl bg-white/5 border border-white/10 hover:border-white/20 hover:bg-white/[0.07] transition-colors text-left w-full"
          >
            <Search className="w-6 h-6 text-accent-purple flex-shrink-0" />
            <span className="font-semibold text-white text-sm">Scan a Wallet</span>
            <span className="text-xs text-white/60">Follow & copy</span>
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
            ) : trending.length === 0 ? (
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
                {trending.slice(0, visibleTrendingCount).map((token) => (
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
                {/* Sentinel for lazy load */}
                {trending.length > visibleTrendingCount && (
                  <div ref={sentinelRef} className="h-4 flex-shrink-0" aria-hidden />
                )}
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
                                className="flex-shrink-0 min-h-[40px] min-w-[44px]"
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
  );
}
