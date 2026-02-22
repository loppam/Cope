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
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { doc, getDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { formatCurrency, formatTokenAmountCompact, formatPriceCompact, getApiBase } from "@/lib/utils";
import { getWalletPortfolioWithPnL, getWalletTradesMultiChain, type UserTrade } from "@/lib/birdeye";
import { fetchNativePrices } from "@/lib/coingecko";
import { apiCache, UI_CACHE_TTL_MS } from "@/lib/cache";
import { toast } from "sonner";
import { DocumentHead } from "@/components/DocumentHead";
import { PullToRefresh } from "@/components/PullToRefresh";
import type { TrendingToken } from "../../api/trending-tokens";

type TabId = "plays" | "trending";
type FilterId = "trending" | "gainers" | "volume" | "liquidity";

const TRENDING_FETCH_CAP = 25;
const TRENDING_REFETCH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

export function Home() {
  const navigate = useNavigate();
  const { user, userProfile } = useAuth();
  const [userTrades, setUserTrades] = useState<UserTrade[]>([]);
  const [playsLoading, setPlaysLoading] = useState(true);
  const [trending, setTrending] = useState<TrendingToken[]>([]);
  const [trendingLoading, setTrendingLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("trending");
  const [activeFilter, setActiveFilter] = useState<FilterId>("trending");
  const [refreshTrendingTrigger, setRefreshTrendingTrigger] = useState(0);
  const [refreshPlaysTrigger, setRefreshPlaysTrigger] = useState(0);

  // Balance header (when wallet connected)
  const [totalBalance, setTotalBalance] = useState<number | null>(null);
  const [balance24h, setBalance24h] = useState<number | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  const walletAddress = userProfile?.walletAddress ?? null;
  const walletConnected = userProfile?.walletConnected ?? false;

  // EVM address for Base/BNB trades: from profile or fetched when balance loads
  const [evmAddressFetched, setEvmAddressFetched] = useState<string | null>(null);

  function evmBalanceUsd(
    evmData: {
      base?: { usdc?: number; native?: number };
      bnb?: { usdc?: number; native?: number };
      tokens?: Array<{ value?: number }>;
    } | null,
    prices: { eth: number; bnb: number },
  ): number {
    if (!evmData) return 0;
    let fromTokens = 0;
    if (Array.isArray(evmData.tokens) && evmData.tokens.length > 0) {
      fromTokens = evmData.tokens.reduce((s, t) => s + (t?.value ?? 0), 0);
    }
    const b = evmData.base ?? { usdc: 0, native: 0 };
    const n = evmData.bnb ?? { usdc: 0, native: 0 };
    const fromBaseBnb =
      (b.usdc ?? 0) +
      (b.native ?? 0) * prices.eth +
      (n.usdc ?? 0) +
      (n.native ?? 0) * prices.bnb;
    return fromTokens > 0 ? fromTokens : fromBaseBnb;
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
        const tokenPromise = user.getIdToken().then(async (t) => {
          const res = await fetch(`${base}/api/relay/evm-balances`, {
            headers: { Authorization: `Bearer ${t}` },
          }).then((r) => r.json()).catch(() => null);
          if (res?.evmAddress && !cancelled) setEvmAddressFetched(res.evmAddress);
          return res;
        });

        const [portfolio, nativePrices, evmData] = await Promise.all([
          getWalletPortfolioWithPnL(walletAddress).catch(() => ({
            solBalance: 0,
            usdcBalance: 0,
            positions: [],
            totalUsd: 0,
          })),
          fetchNativePrices(),
          tokenPromise,
        ]);
        if (cancelled) return;

        // Total: Solana (USDC + positions) + EVM
        const solanaVal =
          portfolio.usdcBalance +
          portfolio.positions.reduce((s, p) => s + (p.value ?? 0), 0);
        const evmVal = evmBalanceUsd(evmData, nativePrices);
        const total = solanaVal + evmVal;

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
      apiCache.clear(`balance_${user.uid}`);
      setBalanceLoading(true);
      const base = getApiBase();
      Promise.all([
        getWalletPortfolioWithPnL(walletAddress).catch(() => ({
          solBalance: 0,
          usdcBalance: 0,
          positions: [],
          totalUsd: 0,
        })),
        fetchNativePrices(),
        user.getIdToken().then((t) =>
          fetch(`${base}/api/relay/evm-balances`, {
            headers: { Authorization: `Bearer ${t}` },
          })
            .then((r) => r.json())
            .catch(() => null),
        ),
      ]).then(([portfolio, nativePrices, evmData]) => {
        const solanaVal =
          portfolio.usdcBalance +
          portfolio.positions.reduce((s, p) => s + (p.value ?? 0), 0);
        const evmVal = evmBalanceUsd(evmData, nativePrices);
        const total = solanaVal + evmVal;
        setTotalBalance(total);
      }).catch(() => setTotalBalance(null)).finally(() => setBalanceLoading(false));
    };
    window.addEventListener("cope-refresh-balance", onRefresh);
    return () => window.removeEventListener("cope-refresh-balance", onRefresh);
  }, [walletAddress, user]);

  // Fetch user's own trades for "Your Plays" (Solana + Base + BNB, cache-first)
  const evmAddress = userProfile?.evmAddress ?? evmAddressFetched ?? null;
  useEffect(() => {
    if (!walletAddress) {
      setUserTrades([]);
      setPlaysLoading(false);
      return;
    }

    const cacheKey = `user_trades_${walletAddress}_${evmAddress ?? "sol"}`;
    const cached = apiCache.get<UserTrade[]>(cacheKey);
    if (cached?.length !== undefined) {
      setUserTrades(cached);
      setPlaysLoading(false);
    } else {
      setPlaysLoading(true);
    }

    let cancelled = false;
    async function fetchUserTrades() {
      try {
        const { items } = await getWalletTradesMultiChain(walletAddress!, evmAddress);
        if (cancelled) return;
        setUserTrades(items);
        apiCache.set(cacheKey, items, UI_CACHE_TTL_MS);
      } catch (err) {
        if (!cancelled) {
          console.error("Error fetching user trades:", err);
          setUserTrades([]);
        }
      } finally {
        if (!cancelled) setPlaysLoading(false);
      }
    }

    fetchUserTrades();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") fetchUserTrades();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [walletAddress, evmAddress, refreshPlaysTrigger]);

  // API params: sort_by (rank|volumeUSD|liquidity), interval (1h|4h|24h)
  // Birdeye only returns priceChange24 when interval=24h; 4h returns null
  const { sortBy: trendingSortBy, interval: trendingInterval } =
    activeFilter === "volume"
      ? { sortBy: "volumeUSD" as const, interval: "24h" as const }
      : activeFilter === "liquidity"
        ? { sortBy: "liquidity" as const, interval: "24h" as const }
        : activeFilter === "gainers"
          ? { sortBy: "rank" as const, interval: "24h" as const }
          : { sortBy: "rank" as const, interval: "24h" as const };

  // Fetch trending tokens (Birdeye, multi-chain). Cap at TRENDING_FETCH_CAP. Refetch every 30 mins.
  useEffect(() => {
    let cancelled = false;
    const base = getApiBase();
    const cacheKey = `trending_tokens_${trendingSortBy}_${trendingInterval}`;
    if (refreshTrendingTrigger > 0) apiCache.clearByPrefix("trending_tokens_");
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
          `${base}/api/trending-tokens?offset=0&limit=${TRENDING_FETCH_CAP}&sort_by=${trendingSortBy}&interval=${trendingInterval}`,
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
  }, [trendingSortBy, trendingInterval, refreshTrendingTrigger]);

  const formatTime = (timestamp: any) => {
    if (timestamp == null) return "Just now";
    const date = timestamp.toDate ? timestamp.toDate() : new Date(typeof timestamp === "number" && timestamp < 1e12 ? timestamp * 1000 : timestamp);
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

  const handleTradeClick = (e: React.MouseEvent, trade: UserTrade) => {
    e.stopPropagation();
    const mint = trade.toAddress ?? trade.fromAddress;
    if (!mint) {
      toast.error("No token address for this trade");
      return;
    }
    navigate("/app/trade", {
      state: {
        mint,
        chain: trade.chain ?? "solana",
        fromFeed: true,
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

  const renderPrice = (val: string) => {
    if (!val || val === "0") return "–";
    const n = parseFloat(val);
    if (Number.isNaN(n)) return val;
    const fmt = formatPriceCompact(val);
    if (fmt.compact) {
      return (
        <>
          {fmt.prefix}
          <span className="align-sub">{fmt.zeroSub}</span>
          {fmt.significant}
        </>
      );
    }
    return fmt.str;
  };

  const filterPills: { id: FilterId; icon: React.ReactNode; label: string }[] = [
    { id: "trending", icon: <Flame className="w-3.5 h-3.5" />, label: "Trending" },
    { id: "gainers", icon: <Star className="w-3.5 h-3.5" />, label: "Top gainers" },
    { id: "volume", icon: <TrendingUp className="w-3.5 h-3.5" />, label: "Volume" },
    { id: "liquidity", icon: <BadgeCheck className="w-3.5 h-3.5" />, label: "Liquidity" },
  ];

  const filteredTrending = useMemo(() => {
    const list = [...trending];
    if (activeFilter === "gainers") {
      return list.sort((a, b) => {
        const ah = a.priceChange24 ?? -Infinity;
        const bh = b.priceChange24 ?? -Infinity;
        return bh - ah;
      });
    }
    return list;
  }, [trending, activeFilter]);

  const handlePullRefresh = useCallback(async () => {
    window.dispatchEvent(new CustomEvent("cope-refresh-balance"));
    setRefreshTrendingTrigger((t) => t + 1);
    setRefreshPlaysTrigger((t) => t + 1);
    if (walletAddress) {
      apiCache.clear(`user_trades_${walletAddress}_${evmAddress ?? "sol"}`);
    }
  }, [walletAddress, evmAddress]);

  return (
    <PullToRefresh onRefresh={handlePullRefresh}>
      <>
        <DocumentHead
          title="Home"
          description="Trending tokens and your plays on COPE"
        />
        <div className="p-4 sm:p-6 max-w-[720px] mx-auto pb-8">
        {/* Wallet balance header – when connected */}
        {walletConnected && walletAddress && (
          <div className="mb-5 flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-2xl sm:text-3xl font-bold tracking-tight text-white truncate">
                {balanceLoading || totalBalance == null
                  ? "$0.00"
                  : `$${(totalBalance ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
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
              className="tap-press flex-shrink-0 min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl bg-[#12d585] hover:bg-[#08b16b] text-[#000000] font-medium text-sm transition-colors"
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

        {/* Filter pills – only when Trending tab active */}
        {activeTab === "trending" && (
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
        )}

        {/* Tabs: Trending | Your Plays */}
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
                          {token.symbol ?? "–"}
                        </span>
                        <span className="text-xs text-white/50 truncate hidden sm:inline">
                          {token.name}
                        </span>
                      </div>
                      <p className="text-xs text-white/50 truncate mt-0.5">
                      MCap: {formatCurrency(token.marketCap)}
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
                      <span className="font-medium text-white text-sm tabular-nums inline-flex items-baseline min-w-0 max-w-[120px] justify-end">
                        {renderPrice(token.priceUsd)}
                      </span>
                      <span
                        className={`text-sm font-semibold tabular-nums inline-flex items-center gap-0.5 ${
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
                            {token.priceChange24 >= 0 ? "+" : ""}
                            {token.priceChange24.toFixed(2)}%
                          </>
                        ) : (
                          <span className="text-white/40">—</span>
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

        {/* Your Plays feed – user's own transactions */}
        {activeTab === "plays" && (
          <>
            {!walletAddress ? (
              <Card glass className="overflow-hidden">
                <div className="h-0.5 bg-gradient-to-r from-accent-primary/30 to-transparent" />
                <div className="p-6 sm:p-8 text-center">
                  <div className="w-16 h-16 rounded-2xl bg-accent-primary/10 flex items-center justify-center mx-auto mb-4">
                    <TrendingUp className="w-8 h-8 text-accent-primary" />
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2">
                    Connect Your Wallet
                  </h3>
                  <p className="text-white/60 text-sm max-w-sm mx-auto mb-6">
                    Connect your wallet to see your trades and plays here
                  </p>
                  <Button
                    onClick={() => navigate("/app/profile")}
                    variant="primary"
                    size="sm"
                    className="min-h-[44px]"
                  >
                    Connect Wallet
                  </Button>
                </div>
              </Card>
            ) : playsLoading ? (
              <div className="flex flex-col items-center justify-center py-16">
                <Loader2 className="w-8 h-8 animate-spin text-accent-primary mb-4" />
                <p className="text-white/60 text-sm">Loading your plays...</p>
              </div>
            ) : userTrades.length === 0 ? (
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
                    Make your first trade to see your plays here
                  </p>
                  <Button
                    onClick={() => navigate("/app/trade")}
                    variant="primary"
                    size="sm"
                    className="min-h-[44px]"
                  >
                    Start Trading
                  </Button>
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
                {userTrades.map((trade) => {
                  const amountStr =
                    trade.toAmount != null && trade.toSymbol
                      ? `${formatTokenAmountCompact(trade.toAmount)} ${trade.toSymbol}`
                      : trade.volumeUsd > 0
                        ? formatCurrency(trade.volumeUsd)
                        : null;
                  const swapDesc =
                    trade.fromSymbol && trade.toSymbol
                      ? `${trade.fromSymbol} → ${trade.toSymbol}`
                      : trade.toSymbol ?? "Swap";
                  return (
                    <motion.div
                      key={trade.id}
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
                                {getTradeIcon(trade.type)}
                                <span className="text-xs font-medium text-white/70 uppercase">
                                  {getTradeTypeLabel(trade.type)}
                                </span>
                                {trade.chain && trade.chain !== "solana" && (
                                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-white/10 text-white/60 uppercase">
                                    {trade.chain}
                                  </span>
                                )}
                              </div>
                              <h3 className="font-semibold text-white truncate">
                                {swapDesc}
                              </h3>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/50 mt-2">
                                {amountStr && (
                                  <span className="font-medium text-white/70">
                                    {amountStr}
                                  </span>
                                )}
                                <span>{formatTime(trade.blockUnixTime)}</span>
                              </div>
                              {trade.txHash && (() => {
                                const explorerUrl =
                                  trade.chain === "base"
                                    ? `https://basescan.org/tx/${trade.txHash}`
                                    : trade.chain === "bnb"
                                      ? `https://bscscan.com/tx/${trade.txHash}`
                                      : `https://solscan.io/tx/${trade.txHash}`;
                                return (
                                  <a
                                    href={explorerUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-xs text-accent-primary hover:text-accent-hover mt-2"
                                  >
                                    View TX
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                );
                              })()}
                            </div>
                            {(trade.toAddress ?? trade.fromAddress) && (
                              <Button
                                onClick={(e) => handleTradeClick(e, trade)}
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
