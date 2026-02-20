/**
 * Token Scanner – token analysis based on Premium Web App Interface.
 * Uses /api/analyze-token: real bundle detection, stepped reveal, predictions.
 * Tabs: Token (scan) | Discover (top traders + search)
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate, useLocation } from "react-router";
import { motion } from "motion/react";
import {
  Search,
  Loader2,
  Copy,
  Check,
  Target,
  UserCircle,
  Users,
  TrendingUp,
  Sparkles,
  Activity,
  BookOpen,
  Globe,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Shield,
  AlertCircle,
  ArrowRight,
  ArrowDownRight,
  ArrowUpRight,
  Twitter,
  MessageCircle,
  Plus,
} from "lucide-react";
import { getApiBase, shortenAddress } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  searchUsersByHandle,
  findUserByWalletAddress,
  findUserByXHandle,
  type UserSearchResult,
} from "@/lib/auth";
import { useAuth } from "@/contexts/AuthContext";
import { DocumentHead } from "@/components/DocumentHead";
import { formatCurrency } from "@/lib/utils";

const ANALYSIS_STEPS_SOLANA = [
  { key: "bundles", icon: Target, label: "Bundle Detection" },
  { key: "devHistory", icon: UserCircle, label: "Developer History" },
  { key: "topHolders", icon: Users, label: "Top Holders" },
  { key: "chart", icon: TrendingUp, label: "Chart Pattern" },
  { key: "freshWallets", icon: Sparkles, label: "Fresh Wallets" },
  { key: "devSold", icon: Activity, label: "Dev Activity" },
  { key: "lore", icon: BookOpen, label: "Lore & Narrative" },
  { key: "socials", icon: Globe, label: "Socials" },
] as const;

const ANALYSIS_STEPS_EVM = [
  { key: "contractCheck", icon: Shield, label: "Contract Verification" },
  { key: "bundles", icon: Target, label: "Bundle Detection" },
  { key: "topHolders", icon: Users, label: "Top Holders" },
  { key: "chart", icon: TrendingUp, label: "Chart Pattern" },
  { key: "lore", icon: BookOpen, label: "Lore & Narrative" },
  { key: "socials", icon: Globe, label: "Socials" },
] as const;

type StatusKind = "safe" | "warning" | "danger" | "info" | "neutral";

interface TokenData {
  name: string;
  symbol: string;
  marketCap: number;
  volume24h: number;
  liquidityUSD: number;
  priceChange24h: number;
  contractAddress: string;
  chain?: string;
  hasVerifiedSocials: boolean;
  twitter?: string | null;
  telegram?: string | null;
}

interface AnalysisItem {
  value?: string;
  status?: StatusKind;
  reason?: string;
}

interface MarketCapPrediction {
  mcap: number;
  multiplier: string;
  probability: number;
  timeframe: string;
}

interface AnalysisResult {
  contractCheck?: AnalysisItem;
  bundles?: AnalysisItem;
  devHistory?: AnalysisItem;
  topHolders?: AnalysisItem;
  chart?: AnalysisItem;
  freshWallets?: AnalysisItem;
  devSold?: AnalysisItem;
  lore?: AnalysisItem;
  socials?: AnalysisItem;
  currentMarketCap?: number;
  marketCapPredictions?: {
    conservative: MarketCapPrediction;
    moderate: MarketCapPrediction;
    aggressive: MarketCapPrediction;
  };
  overallProbability?: number;
  riskLevel?: string;
  recommendation?: string;
}

type ScannerTab = "token" | "discover";

interface TopTrader {
  uid: string;
  xHandle: string | null;
  avatar: string | null;
  walletAddress: string;
  winRate: number;
  totalTrades: number;
  realizedPnL?: number;
}

function AnalysisRow({
  data,
  icon: Icon,
  label,
  isAnalyzing = false,
}: {
  data: AnalysisItem;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  isAnalyzing?: boolean;
}) {
  const status = (data?.status || "info") as StatusKind;
  const StatusIcon =
    status === "safe"
      ? CheckCircle2
      : status === "warning"
        ? AlertTriangle
        : status === "danger"
          ? XCircle
          : null;
  const statusColors: Record<StatusKind, string> = {
    safe: "text-emerald-500 border-emerald-500/40 bg-emerald-500/10",
    warning: "text-amber-500 border-amber-500/40 bg-amber-500/10",
    danger: "text-red-500 border-red-500/40 bg-red-500/10",
    info: "text-white/60 border-white/20 bg-white/5",
    neutral: "text-white/50 border-white/15 bg-white/5",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
      className={`rounded-xl border p-4 shadow-[0_4px_12px_rgba(0,0,0,0.2)] min-h-[44px] ${
        isAnalyzing
          ? "border-[#12d585]/60 bg-white/10 animate-pulse"
          : "border-white/10 bg-white/5"
      }`}
    >
      <div className="flex items-start gap-3">
        {isAnalyzing ? (
          <Loader2 className="mt-0.5 h-5 w-5 shrink-0 text-[#12d585] animate-spin" />
        ) : (
          <Icon className="mt-0.5 h-5 w-5 shrink-0 text-[#12d585]" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-white/80">{label}</span>
            {isAnalyzing && (
              <span className="text-xs text-white/40 italic">Analyzing…</span>
            )}
          </div>
          {!isAnalyzing && (
            <>
              <p className="mt-1 text-xs leading-relaxed text-white/60">
                {data?.reason || data?.value || "–"}
              </p>
              {data?.value && (
                <div
                  className={`mt-2 inline-flex min-h-[44px] min-w-[44px] items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium ${statusColors[status]}`}
                >
                  {StatusIcon && <StatusIcon className="h-3.5 w-3.5" />}
                  {data.value}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function DiscoverTabContent() {
  const navigate = useNavigate();
  const { user, watchlist, addToWatchlist, removeFromWatchlist } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [topTraders, setTopTraders] = useState<TopTrader[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [discoverLoading, setDiscoverLoading] = useState(true);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);

  const detectSearchType = (input: string): "wallet" | "xhandle" => {
    const trimmed = input.trim();
    if (
      trimmed.startsWith("@") ||
      (!trimmed.includes(" ") &&
        trimmed.length < 20 &&
        !trimmed.match(/^[A-Za-z0-9]{32,44}$/))
    ) {
      return "xhandle";
    }
    return "wallet";
  };

  const isUsernameMode = detectSearchType(searchQuery) === "xhandle";

  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    if (!searchQuery.trim() || !isUsernameMode || searchQuery.trim().length < 2) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }
    setSearchLoading(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await searchUsersByHandle(searchQuery.trim(), 20);
        setSearchResults(results);
        setShowDropdown(results.length > 0 || searchQuery.trim().length >= 1);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery, isUsernameMode]);

  const watchedAddresses = new Set(watchlist.map((w) => w.address));

  const goToProfile = (
    item: { xHandle?: string | null; walletAddress: string }
  ) => {
    const handle = item.xHandle?.trim().replace(/^@/, "");
    if (handle) navigate(`/${handle}`);
    else navigate(`/scanner/wallet/${item.walletAddress}`);
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const fetchDiscoverPage = useCallback(
    async (cursor: string | null) => {
      const base = getApiBase() || window.location.origin;
      const params = new URLSearchParams({ limit: "20" });
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(`${base}/api/discover?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message =
          (typeof data?.error === "string" && data.error) ||
          `Failed to load (${res.status})`;
        return {
          traders: [] as TopTrader[],
          nextCursor: null as string | null,
          error: message,
        };
      }
      return {
        traders: (data.topTraders ?? []) as TopTrader[],
        nextCursor: (data.nextCursor ?? null) as string | null,
        error: null,
      };
    },
    [],
  );

  const loadDiscover = useCallback(() => {
    setDiscoverError(null);
    setDiscoverLoading(true);
    fetchDiscoverPage(null).then(({ traders, nextCursor: nc, error }) => {
      setTopTraders(traders);
      setNextCursor(nc);
      setDiscoverError(error ?? null);
      setDiscoverLoading(false);
    });
  }, [fetchDiscoverPage]);

  useEffect(() => {
    loadDiscover();
  }, [loadDiscover]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMoreRef.current || discoverLoading) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    fetchDiscoverPage(nextCursor)
      .then(({ traders, nextCursor: nc }) => {
        setTopTraders((prev) => [...prev, ...traders]);
        setNextCursor(nc);
      })
      .finally(() => {
        setLoadingMore(false);
        loadingMoreRef.current = false;
      });
  }, [nextCursor, discoverLoading, fetchDiscoverPage]);

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el || !nextCursor || loadingMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { rootMargin: "100px", threshold: 0 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [nextCursor, loadingMore, loadMore]);

  const handleSelectUser = (user: UserSearchResult) => {
    setSearchQuery(user.xHandle || user.displayName || "");
    setSearchResults([]);
    setShowDropdown(false);
    goToProfile(user);
  };

  const handleSearchSubmit = async () => {
    const q = searchQuery.trim();
    if (!q) return;
    try {
      const type = detectSearchType(q);
      if (type === "xhandle") {
        const user = await findUserByXHandle(q);
        if (user?.walletAddress) {
          goToProfile(user);
          return;
        }
      } else {
        const user = await findUserByWalletAddress(q, true);
        if (user?.walletAddress) {
          goToProfile(user);
          return;
        }
      }
      navigate("/scanner/wallet/" + q);
    } catch {
      navigate("/scanner/wallet/" + q);
    }
  };

  return (
    <div className="space-y-4">
      <div ref={containerRef} className="relative">
        <label className="block text-sm font-medium text-white/80 mb-2">
          Search by X handle or wallet
        </label>
        <div className="relative">
          {isUsernameMode && (
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40 pointer-events-none z-10" />
          )}
          <input
            type="text"
            placeholder="Enter @username or wallet address"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => isUsernameMode && searchResults.length > 0 && setShowDropdown(true)}
            onKeyDown={(e) => e.key === "Enter" && handleSearchSubmit()}
            className={`min-h-[44px] w-full rounded-lg bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-[#12d585] ${isUsernameMode ? "pl-10" : ""}`}
          />
          {isUsernameMode && searchLoading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <Loader2 className="w-4 h-4 text-white/40 animate-spin" />
            </div>
          )}
        </div>
        {showDropdown && searchResults.length > 0 && (
          <div className="absolute z-50 w-full mt-2 max-h-[320px] overflow-y-auto rounded-xl border border-white/10 bg-[#0a0a0a] shadow-xl">
            <div className="p-2">
              {searchResults.map((user) => (
                <button
                  key={user.uid}
                  type="button"
                  onClick={() => handleSelectUser(user)}
                  data-tap-haptic
                  className="tap-press w-full p-3 rounded-lg hover:bg-white/5 transition-colors text-left flex items-center gap-3 min-h-[44px]"
                >
                  {user.avatar ? (
                    <img
                      src={user.avatar}
                      alt=""
                      className="w-10 h-10 rounded-full flex-shrink-0 object-cover"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full flex-shrink-0 bg-white/10 flex items-center justify-center text-white/60 text-sm">
                      {(user.xHandle || user.displayName || "?")[1]?.toUpperCase() ?? "?"}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-white truncate">
                      {user.displayName || user.xHandle || "–"}
                    </div>
                    <div className="text-xs text-white/50 font-mono truncate">
                      {user.xHandle}
                    </div>
                  </div>
                  <div className="text-xs text-white/40 font-mono flex-shrink-0">
                    {shortenAddress(user.walletAddress)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
        {isUsernameMode && !searchLoading && searchQuery.trim().length >= 1 && searchResults.length === 0 && showDropdown && (
          <div className="absolute z-50 w-full mt-2 p-4 rounded-xl border border-white/10 bg-[#0a0a0a] text-center text-white/60 text-sm">
            No users found
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={handleSearchSubmit}
        disabled={!searchQuery.trim()}
        data-tap-haptic
        className="tap-press w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl bg-[#12d585] font-semibold text-black px-4 py-3 disabled:opacity-50"
      >
        <Search className="w-4 h-4" />
        Search
      </button>

      {discoverLoading ? (
        <div className="flex items-center justify-center gap-3 py-12 text-[#12d585]">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span>Loading discover…</span>
        </div>
      ) : discoverError ? (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-6 text-center">
          <p className="text-sm text-amber-200 mb-4">{discoverError}</p>
          <button
            type="button"
            onClick={loadDiscover}
            data-tap-haptic
            className="tap-press min-h-[44px] min-w-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#12d585] px-5 py-2.5 font-semibold text-black"
          >
            <span>Retry</span>
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {topTraders.length > 0 ? (
            <div>
              <h3 className="text-sm font-semibold text-white/80 mb-3">Top traders</h3>
              <div className="space-y-2">
                {topTraders.map((t) => {
                  const isFollowed = watchedAddresses.has(t.walletAddress);
                  const percentage = `${Number(t.winRate).toFixed(2)}%`;
                  return (
                    <div
                      key={t.walletAddress}
                      className={`w-full flex items-center gap-3 p-3 rounded-xl border transition-colors min-h-[56px] ${
                        isFollowed
                          ? "border-[#12d585]/30 bg-[#12d585]/5"
                          : "border-white/10 bg-white/5"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => goToProfile(t)}
                        data-tap-haptic
                        className="tap-press flex-1 min-w-0 flex items-center gap-3 text-left hover:opacity-90"
                      >
                        <span className="font-medium text-white truncate">
                          {t.xHandle || shortenAddress(t.walletAddress)}
                        </span>
                      </button>
                      <span className="text-sm font-semibold text-[#12d585] flex-shrink-0 tabular-nums">
                        {percentage}
                      </span>
                      {user && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isFollowed) {
                              removeFromWatchlist(t.walletAddress, { uid: t.uid });
                            } else {
                              addToWatchlist(t.walletAddress, { uid: t.uid, onPlatform: true });
                            }
                          }}
                          data-tap-haptic
                          className="tap-press relative flex-shrink-0 w-10 h-10 rounded-full ring-2 ring-white/20 flex items-center justify-center min-w-[44px] min-h-[44px] touch-manipulation"
                          aria-label={isFollowed ? "Unfollow" : "Follow"}
                        >
                          {t.avatar ? (
                            <img
                              src={t.avatar}
                              alt=""
                              className="w-10 h-10 rounded-full object-cover absolute inset-0"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-[#12d585]/20 flex items-center justify-center absolute inset-0">
                              <Users className="w-5 h-5 text-[#12d585]" />
                            </div>
                          )}
                          {isFollowed ? (
                            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#12d585] flex items-center justify-center">
                              <Check className="w-2.5 h-2.5 text-black" strokeWidth={3} />
                            </span>
                          ) : (
                            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-[#12d585] flex items-center justify-center">
                              <Plus className="w-2.5 h-2.5 text-black" strokeWidth={3} />
                            </span>
                          )}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              {/* Load more: visible button + sentinel for infinite scroll */}
              {nextCursor && (
                <div
                  ref={loadMoreRef}
                  className="flex flex-col items-center gap-3 py-4 sm:py-6"
                >
                  {loadingMore ? (
                    <Loader2 className="h-6 w-6 text-[#12d585] animate-spin" />
                  ) : (
                    <button
                      type="button"
                      onClick={loadMore}
                      data-tap-haptic
                      className="tap-press min-h-[44px] min-w-[44px] inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/5 px-5 py-3 text-sm font-medium text-white hover:bg-white/10 transition-colors"
                    >
                      Load more
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center">
              <div className="w-12 h-12 rounded-full bg-white/10 flex items-center justify-center mx-auto mb-3">
                <Users className="w-6 h-6 text-white/40" />
              </div>
              <h3 className="text-sm font-semibold text-white/80 mb-1">
                Leaderboard empty
              </h3>
              <p className="text-xs text-white/50 max-w-[260px] mx-auto">
                Top traders will appear here once wallet stats are available. Use search above to find people by handle or wallet.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function looksLikeContractAddress(text: string): boolean {
  const t = text.trim();
  return t.length >= 32 && /^[A-Za-z0-9_-]+$/.test(t);
}

export function TokenScanner() {
  const location = useLocation();
  const navigate = useNavigate();
  const initialState = (location.state as { tab?: ScannerTab })?.tab;
  const searchParams = new URLSearchParams(location.search);
  const tabParam = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<ScannerTab>(
    tabParam === "token" || initialState === "token" ? "token" : "discover",
  );
  const [tokenAddress, setTokenAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [chainType, setChainType] = useState<"evm" | "solana">("solana");
  const [copied, setCopied] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [showPredictions, setShowPredictions] = useState(false);
  const [showVerdict, setShowVerdict] = useState(false);

  const analysisSteps =
    chainType === "evm" ? ANALYSIS_STEPS_EVM : ANALYSIS_STEPS_SOLANA;

  const analyzeToken = useCallback(async (addressOverride?: string) => {
    const addr = (addressOverride ?? tokenAddress).trim();
    if (!addr || addr.length < 32) return;

    setLoading(true);
    setError(null);
    setTokenData(null);
    setAnalysis(null);
    setChainType("solana");
    setCurrentStep(0);
    setShowPredictions(false);
    setShowVerdict(false);

    try {
      const base = getApiBase() || window.location.origin;
      const res = await fetch(`${base}/api/analyze-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenAddress: addr }),
      });

      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.message || json.error || "Analysis failed");
      }

      const { metadata, metrics, analysis: a, chainType: ct } = json;

      setChainType(ct === "evm" ? "evm" : "solana");

      const ext = (metrics?.extensions || {}) as Record<string, string>;
      const twitter = ext.twitter || metadata?.twitter || null;
      const telegram = ext.telegram || metadata?.telegram || null;

      setTokenData({
        name: metadata?.name || "Unknown",
        symbol: metadata?.symbol || "N/A",
        marketCap: metrics?.marketCap ?? a?.currentMarketCap ?? 0,
        volume24h: metrics?.volume24h ?? 0,
        liquidityUSD: metrics?.liquidityUSD ?? 0,
        priceChange24h: metrics?.priceChange24h ?? 0,
        contractAddress: addr,
        chain: metadata?.chain,
        hasVerifiedSocials: !!(twitter || telegram),
        twitter,
        telegram,
      });

      setAnalysis(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }, [tokenAddress]);

  const handleTokenAddressPaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      const pasted = e.clipboardData.getData("text").trim();
      if (!pasted || !looksLikeContractAddress(pasted)) return;
      e.preventDefault();
      setTokenAddress(pasted);
      setError(null);
      setTimeout(() => analyzeToken(pasted), 0);
    },
    [analyzeToken],
  );

  useEffect(() => {
    if (!analysis || loading) return;
    setCurrentStep(0);
    const steps = chainType === "evm" ? ANALYSIS_STEPS_EVM : ANALYSIS_STEPS_SOLANA;
    const id = setInterval(() => {
      setCurrentStep((prev) => {
        const next = prev + 1;
        if (next >= steps.length) {
          clearInterval(id);
          setShowPredictions(true);
          setTimeout(() => setShowVerdict(true), 1800);
          return steps.length;
        }
        return next;
      });
    }, 650);
    return () => clearInterval(id);
  }, [analysis, loading, chainType]);

  const handleCopy = () => {
    if (!tokenData?.contractAddress) return;
    navigator.clipboard.writeText(tokenData.contractAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const predictions = analysis?.marketCapPredictions;
  const currentMcap =
    tokenData?.marketCap ?? analysis?.currentMarketCap ?? 0;
  const riskLevel = (analysis?.riskLevel || "Medium").toLowerCase();
  const isLowRisk = riskLevel === "low";

  const getAnalysisItem = (key: string): AnalysisItem => {
    const item = analysis?.[key as keyof AnalysisResult] as AnalysisItem | undefined;
    return item ?? { value: "–", status: "info", reason: "Analysis pending" };
  };

  const isRevealing = analysis && !loading && currentStep > 0;

  return (
    <>
      <DocumentHead
        title="Token Scanner"
        description="Scan and analyze Solana, Base, and BNB tokens on COPE"
      />
      <div className="min-h-screen p-4 sm:p-6 pb-16 max-w-[720px] mx-auto overflow-visible">
      <h1 className="mb-4 text-xl font-bold text-white">Token Scanner</h1>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ScannerTab)} className="w-full">
        {/* Segmented control: Discover first, then Token */}
        <div className="relative w-full grid grid-cols-2 mb-6 rounded-2xl bg-white/[0.04] border border-white/10 p-1.5 min-h-[56px] overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
          <motion.div
            className="absolute inset-y-[6px] rounded-xl bg-gradient-to-b from-[#12d585]/30 to-[#12d585]/15 border border-[#12d585]/40 shadow-[0_0_24px_-2px_rgba(18,213,133,0.35),inset_0_1px_0_rgba(255,255,255,0.1)]"
            style={{ width: "calc(50% - 3px)" }}
            initial={false}
            animate={{ left: activeTab === "discover" ? "6px" : "calc(50% + 3px)" }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
          />
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "discover"}
            onClick={() => setActiveTab("discover")}
            data-tap-haptic
            className={`tap-press relative z-10 flex items-center justify-center gap-2.5 py-3.5 px-4 min-h-[44px] rounded-xl text-sm font-semibold transition-all duration-200 ${activeTab === "discover" ? "" : "text-white/60 hover:text-white/75"}`}
          >
            <Users className={`w-4 h-4 flex-shrink-0 transition-colors ${activeTab === "discover" ? "text-[#12d585] drop-shadow-[0_0_8px_rgba(18,213,133,0.5)]" : "text-white/50"}`} />
            <span className={activeTab === "discover" ? "text-[#12d585] font-bold tracking-tight" : "text-white/60"}>Discover</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "token"}
            onClick={() => setActiveTab("token")}
            data-tap-haptic
            className={`tap-press relative z-10 flex items-center justify-center gap-2.5 py-3.5 px-4 min-h-[44px] rounded-xl text-sm font-semibold transition-all duration-200 ${activeTab === "token" ? "" : "text-white/60 hover:text-white/75"}`}
          >
            <Target className={`w-4 h-4 flex-shrink-0 transition-colors ${activeTab === "token" ? "text-[#12d585] drop-shadow-[0_0_8px_rgba(18,213,133,0.5)]" : "text-white/50"}`} />
            <span className={activeTab === "token" ? "text-[#12d585] font-bold tracking-tight" : "text-white/60"}>Token</span>
          </button>
        </div>

        <TabsContent value="discover" className="mt-0">
          <DiscoverTabContent />
        </TabsContent>

        <TabsContent value="token" className="mt-0">
      <div className="mb-6 rounded-xl border border-white/10 bg-white/5 p-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={tokenAddress}
            onChange={(e) => setTokenAddress(e.target.value)}
            onPaste={handleTokenAddressPaste}
            onKeyDown={(e) => e.key === "Enter" && analyzeToken()}
            placeholder="Paste token address or enter (Solana, Base, BNB)"
            className="min-h-[44px] flex-1 rounded-lg bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-[#12d585]"
          />
          <button
            type="button"
            onClick={analyzeToken}
            disabled={!tokenAddress.trim() || loading}
            data-tap-haptic
            className="tap-press flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-lg bg-[#12d585] px-6 py-3 font-semibold text-black transition-opacity disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="sm:inline">Scanning...</span>
              </>
            ) : (
              <>
                <Search className="h-4 w-4" />
                Scan
              </>
            )}
          </button>
        </div>
      </div>

      {loading && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex items-center justify-center gap-3 py-12 text-[#12d585]"
        >
          <Loader2 className="h-6 w-6 animate-spin" />
          <span>Analyzing token…</span>
        </motion.div>
      )}

      {error && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 rounded-xl border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-400"
        >
          {error}
        </motion.div>
      )}

      {tokenData && analysis && !loading && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          {/* Token overview – Premium-style card */}
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
            className="rounded-xl border border-white/10 bg-white/5 p-4 sm:p-6 shadow-[0_8px_16px_rgba(0,0,0,0.2)]"
          >
            <div className="mb-4 flex flex-wrap items-center gap-4 gap-y-3">
              <div>
                <div className="text-xs uppercase tracking-wider text-white/50">
                  Token{tokenData.chain ? ` · ${tokenData.chain}` : ""}
                </div>
                <div className="text-lg font-bold text-white">
                  {tokenData.name}
                </div>
                <div className="text-sm text-white/60">{tokenData.symbol}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-white/50">
                  Market Cap
                </div>
                <div className="text-lg font-bold text-[#12d585]">
                  {formatCurrency(tokenData.marketCap)}
                </div>
                <div
                  className={`text-xs ${tokenData.priceChange24h >= 0 ? "text-emerald-400" : "text-red-400"}`}
                >
                  {tokenData.priceChange24h >= 0 ? "↑" : "↓"}{" "}
                  {Math.abs(tokenData.priceChange24h).toFixed(2)}%
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-white/50">
                  24h Vol
                </div>
                <div className="text-sm font-semibold text-white/90">
                  {formatCurrency(tokenData.volume24h)}
                </div>
                <div className="text-xs text-white/50">
                  Liq: {formatCurrency(tokenData.liquidityUSD)}
                </div>
              </div>
            </div>

            {tokenData.hasVerifiedSocials && (
              <div className="mb-3 flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/20 px-2 py-1 text-xs font-medium text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Verified Socials
                </span>
                {tokenData.twitter && (
                  <a
                    href={tokenData.twitter}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[44px] min-w-[44px] items-center gap-2 rounded-lg border border-white/20 px-3 py-2 text-xs text-white/80 hover:border-[#12d585]/50 hover:text-white"
                  >
                    <Twitter className="h-4 w-4" />
                    Twitter
                  </a>
                )}
                {tokenData.telegram && (
                  <a
                    href={tokenData.telegram}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[44px] min-w-[44px] items-center gap-2 rounded-lg border border-white/20 px-3 py-2 text-xs text-white/80 hover:border-[#12d585]/50 hover:text-white"
                  >
                    <MessageCircle className="h-4 w-4" />
                    Telegram
                  </a>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 rounded-lg bg-black/20 p-3">
              <code className="min-w-0 flex-1 truncate text-xs text-white/50">
                {tokenData.contractAddress}
              </code>
              <button
                type="button"
                onClick={handleCopy}
                data-tap-haptic
                className="tap-press min-h-[44px] min-w-[44px] shrink-0 rounded p-2 hover:bg-white/10"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-emerald-400" />
                ) : (
                  <Copy className="h-4 w-4 text-white/50" />
                )}
              </button>
            </div>

            <div className="flex gap-3 mt-4">
              <button
                type="button"
                onClick={() =>
                  navigate("/app/trade", {
                    state: {
                      mint: tokenData.contractAddress,
                      chain: tokenData.chain === "bsc" ? "bnb" : (tokenData.chain || "solana"),
                      fromFeed: true,
                    },
                  })
                }
                data-tap-haptic
                className="tap-press flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#12d585] font-semibold text-black px-4 py-3"
              >
                <ArrowDownRight className="w-4 h-4" />
                Buy
              </button>
              <button
                type="button"
                onClick={() =>
                  navigate("/app/trade", {
                    state: {
                      mint: tokenData.contractAddress,
                      chain: tokenData.chain === "bsc" ? "bnb" : (tokenData.chain || "solana"),
                      fromFeed: true,
                      mode: "sell",
                    },
                  })
                }
                data-tap-haptic
                className="tap-press flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/10 font-semibold text-white px-4 py-3 hover:bg-white/15 transition-colors"
              >
                <ArrowUpRight className="w-4 h-4" />
                Sell
              </button>
            </div>
          </motion.div>

          {/* Analysis rows – stepped reveal with progress */}
          {isRevealing && (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-semibold text-white">
                  {currentStep >= analysisSteps.length
                    ? "Analysis Complete"
                    : "AI Analysis in Progress…"}
                </h2>
                {currentStep < analysisSteps.length && (
                  <span className="text-xs text-white/50">
                    {currentStep}/{analysisSteps.length}
                  </span>
                )}
              </div>
              <div className="mb-6 rounded-full h-1.5 overflow-hidden bg-white/10">
                <motion.div
                  className="h-full bg-[#12d585]"
                  initial={{ width: "0%" }}
                  animate={{
                    width: `${Math.min((currentStep / analysisSteps.length) * 100, 100)}%`,
                  }}
                  transition={{ duration: 0.4 }}
                />
              </div>
              <div className="space-y-3">
                {analysisSteps.map(({ key, icon, label }, index) => {
                  if (index >= currentStep) return null;
                  const data = getAnalysisItem(key);
                  return (
                    <AnalysisRow
                      key={key}
                      data={data}
                      icon={icon}
                      label={label}
                      isAnalyzing={index === currentStep - 1 && currentStep < analysisSteps.length}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Predictions – shown after analysis steps complete */}
          {showPredictions && predictions && (
            <div>
              <h2 className="mb-3 text-base font-semibold text-[#12d585]">
                Market Cap Predictions
              </h2>
              <div className="grid gap-3 sm:grid-cols-3">
                {(
                [
                  ["conservative", predictions.conservative, "SAFE BET", "text-emerald-400"],
                  ["moderate", predictions.moderate, "BALANCED", "text-amber-400"],
                  ["aggressive", predictions.aggressive, "HIGH RISK", "text-red-400"],
                ] as const
              ).map(([key, p, badge, color], idx) => (
                  <motion.div
                    key={key}
                    initial={{ opacity: 0, y: 24, scale: 0.94 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ delay: idx * 0.12, duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
                    whileHover={{ y: -4 }}
                    className="rounded-xl border border-white/10 bg-white/5 p-4 shadow-[0_4px_12px_rgba(0,0,0,0.2)] transition-shadow hover:shadow-[0_8px_20px_rgba(0,0,0,0.3)]"
                  >
                    <div
                      className={`mb-2 text-xs font-bold uppercase ${color}`}
                    >
                      {badge}
                    </div>
                    <div className="text-lg font-bold text-white">
                      {formatCurrency(p.mcap)}
                    </div>
                    <div className="text-xs text-white/50 line-through">
                      {formatCurrency(currentMcap)}
                    </div>
                    <div className={`mt-2 text-sm font-semibold ${color}`}>
                      {p.multiplier}
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-xs text-white/60">
                      <Clock className="h-3.5 w-3.5" />
                      {p.timeframe} · {p.probability}% prob
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          )}

          {/* Verdict – shown after predictions */}
          {showVerdict && (analysis.overallProbability != null || analysis.recommendation) && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className={`rounded-xl border-2 p-6 text-center ${
                isLowRisk
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : "border-amber-500/40 bg-amber-500/5"
              }`}
            >
              <div className="text-xs uppercase tracking-wider text-white/50">
                Overall Assessment
              </div>
              <div className="mt-2 text-4xl font-bold text-[#12d585] sm:text-5xl">
                {analysis.overallProbability ?? 0}%
              </div>
              <div className="text-sm text-white/60">Win Probability</div>
              <div
                className={`mt-3 inline-flex items-center gap-2 rounded-full border-2 px-4 py-2 text-sm font-bold ${
                  isLowRisk
                    ? "border-emerald-500/60 text-emerald-400"
                    : "border-amber-500/60 text-amber-400"
                }`}
              >
                {isLowRisk ? (
                  <Shield className="h-4 w-4" />
                ) : (
                  <AlertCircle className="h-4 w-4" />
                )}
                {analysis.riskLevel || "Medium"} Risk
              </div>
              {analysis.recommendation && (
                <p className="mt-4 border-l-2 border-[#12d585]/50 pl-4 text-left text-sm italic text-white/70">
                  {analysis.recommendation}
                </p>
              )}
              <button
                type="button"
                data-tap-haptic
                className={`tap-press mt-6 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl font-bold text-white ${
                  isLowRisk
                    ? "bg-emerald-500 hover:bg-emerald-400"
                    : "bg-amber-500 hover:bg-amber-400"
                }`}
              >
                {isLowRisk ? "Proceed with Trade" : "Proceed with Caution"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </motion.div>
          )}
        </motion.div>
      )}

      {!tokenData && !loading && !error && (
        <div className="py-12 text-center text-sm text-white/50">
          Enter a token address (Solana, Base, or BNB) and tap Scan.
        </div>
      )}
        </TabsContent>
      </Tabs>
    </div>
    </>
  );
}
