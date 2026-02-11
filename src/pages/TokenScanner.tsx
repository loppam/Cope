/**
 * Token Scanner – token analysis based on Premium Web App Interface.
 * Uses /api/analyze-token: real bundle detection, stepped reveal, predictions.
 * Tabs: Token (scan) | Discover (accounts + top traders)
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
  Twitter,
  MessageCircle,
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

function formatMarketCap(value: number): string {
  if (!value || isNaN(value)) return "$0";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

const ANALYSIS_STEPS = [
  { key: "bundles", icon: Target, label: "Bundle Detection" },
  { key: "devHistory", icon: UserCircle, label: "Developer History" },
  { key: "topHolders", icon: Users, label: "Top Holders" },
  { key: "chart", icon: TrendingUp, label: "Chart Pattern" },
  { key: "freshWallets", icon: Sparkles, label: "Fresh Wallets" },
  { key: "devSold", icon: Activity, label: "Dev Activity" },
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

interface DiscoverAccount {
  uid: string;
  xHandle?: string | null;
  displayName?: string | null;
  avatar?: string | null;
  walletAddress: string;
  winRate?: number;
  totalTrades?: number;
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
                {data?.reason || data?.value || "—"}
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
  const { watchlist } = useAuth();
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<UserSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [topTraders, setTopTraders] = useState<TopTrader[]>([]);
  const [accounts, setAccounts] = useState<DiscoverAccount[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(true);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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
  const followedTraders = topTraders.filter((t) => watchedAddresses.has(t.walletAddress));
  const followedAccounts = accounts.filter((a) => watchedAddresses.has(a.walletAddress));
  const hasFollowed = followedTraders.length > 0 || followedAccounts.length > 0;
  const followedList = [
    ...followedTraders.map((t) => ({ ...t, type: "trader" as const })),
    ...followedAccounts
      .filter((a) => !followedTraders.some((t) => t.walletAddress === a.walletAddress))
      .map((a) => ({ ...a, type: "account" as const })),
  ];

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetchDiscover() {
      try {
        const base = getApiBase() || window.location.origin;
        const res = await fetch(`${base}/api/discover`);
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        setTopTraders(data.topTraders ?? []);
        setAccounts(
          (data.accounts ?? []).map((a: DiscoverAccount) => ({
            uid: a.uid,
            xHandle: a.xHandle ?? null,
            displayName: a.displayName ?? null,
            avatar: a.avatar ?? null,
            walletAddress: a.walletAddress,
            winRate: a.winRate ?? 0,
            totalTrades: a.totalTrades ?? 0,
            realizedPnL: a.realizedPnL,
          })),
        );
      } catch {
        if (!cancelled) {
          setTopTraders([]);
          setAccounts([]);
        }
      } finally {
        if (!cancelled) setDiscoverLoading(false);
      }
    }
    fetchDiscover();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelectUser = (user: UserSearchResult) => {
    setSearchQuery(user.xHandle || user.displayName || "");
    setSearchResults([]);
    setShowDropdown(false);
    navigate("/scanner/wallet/" + user.walletAddress);
  };

  const handleSearchSubmit = async () => {
    const q = searchQuery.trim();
    if (!q) return;
    try {
      const type = detectSearchType(q);
      if (type === "xhandle") {
        const user = await findUserByXHandle(q);
        if (user?.walletAddress) {
          navigate("/scanner/wallet/" + user.walletAddress);
        }
      } else {
        const user = await findUserByWalletAddress(q, true);
        if (user?.walletAddress) {
          navigate("/scanner/wallet/" + user.walletAddress);
        } else {
          navigate("/scanner/wallet/" + q);
        }
      }
    } catch {
      navigate("/scanner/wallet/" + q);
    }
  };

  const goToWallet = (address: string) => {
    navigate("/scanner/wallet/" + address);
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
                  className="w-full p-3 rounded-lg hover:bg-white/5 transition-colors text-left flex items-center gap-3 min-h-[44px]"
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
                      {user.displayName || user.xHandle || "—"}
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
        className="w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl bg-[#12d585] font-semibold text-black px-4 py-3 disabled:opacity-50"
      >
        <Search className="w-4 h-4" />
        Search
      </button>

      {discoverLoading ? (
        <div className="flex items-center justify-center gap-3 py-12 text-[#12d585]">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span>Loading discover…</span>
        </div>
      ) : (
        <div className="space-y-6">
          {hasFollowed && (
            <div>
              <h3 className="text-sm font-semibold text-white/80 mb-3">Followed</h3>
              <div className="space-y-2">
                {followedList.map((item) => (
                  <button
                    key={item.uid}
                    type="button"
                    onClick={() => goToWallet(item.walletAddress)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl border border-[#12d585]/30 bg-[#12d585]/5 hover:bg-[#12d585]/10 transition-colors text-left min-h-[56px]"
                  >
                    {item.avatar ? (
                      <img
                        src={item.avatar}
                        alt=""
                        className="w-10 h-10 rounded-xl object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-xl bg-[#12d585]/20 flex items-center justify-center flex-shrink-0">
                        <Users className="w-5 h-5 text-[#12d585]" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-white truncate">
                        {item.xHandle ||
                          ("displayName" in item ? item.displayName : null) ||
                          shortenAddress(item.walletAddress)}
                      </div>
                      <div className="text-xs text-white/50 font-mono truncate">
                        {shortenAddress(item.walletAddress)}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-semibold text-[#12d585]">
                        {Number(item.winRate ?? 0).toFixed(0)}% win
                      </div>
                      <div className="text-xs text-white/50">
                        {item.totalTrades ?? 0} trades
                      </div>
                      {item.realizedPnL != null && (
                        <div className={`text-xs ${item.realizedPnL >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {item.realizedPnL >= 0 ? "+" : ""}{item.realizedPnL.toFixed(0)}%
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
          {topTraders.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-white/80 mb-3">Top traders</h3>
              <div className="space-y-2">
                {topTraders.map((t) => (
                  <button
                    key={t.uid}
                    type="button"
                    onClick={() => goToWallet(t.walletAddress)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-left min-h-[56px]"
                  >
                    {t.avatar ? (
                      <img
                        src={t.avatar}
                        alt=""
                        className="w-10 h-10 rounded-xl object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-xl bg-[#12d585]/20 flex items-center justify-center flex-shrink-0">
                        <Users className="w-5 h-5 text-[#12d585]" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-white truncate">
                        {t.xHandle || shortenAddress(t.walletAddress)}
                      </div>
                      <div className="text-xs text-white/50">
                        {t.totalTrades} trades
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-semibold text-[#12d585]">
                        {Number(t.winRate).toFixed(0)}% win
                      </div>
                      {t.realizedPnL != null && (
                        <div className={`text-xs ${t.realizedPnL >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {t.realizedPnL >= 0 ? "+" : ""}{t.realizedPnL.toFixed(0)}%
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <h3 className="text-sm font-semibold text-white/80 mb-3">All accounts</h3>
            <div className="space-y-2">
              {accounts.length === 0 ? (
                <div className="py-8 text-center text-white/50 text-sm">
                  No public accounts yet
                </div>
              ) : (
                accounts.map((a) => (
                  <button
                    key={a.uid}
                    type="button"
                    onClick={() => goToWallet(a.walletAddress)}
                    className="w-full flex items-center gap-3 p-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors text-left min-h-[56px]"
                  >
                    {a.avatar ? (
                      <img
                        src={a.avatar}
                        alt=""
                        className="w-10 h-10 rounded-xl object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
                        <Users className="w-5 h-5 text-white/50" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-white truncate">
                        {a.xHandle || a.displayName || shortenAddress(a.walletAddress)}
                      </div>
                      <div className="text-xs text-white/50 font-mono truncate">
                        {shortenAddress(a.walletAddress)}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-semibold text-[#12d585]">
                        {Number(a.winRate ?? 0).toFixed(0)}% win
                      </div>
                      <div className="text-xs text-white/50">
                        {a.totalTrades ?? 0} trades
                      </div>
                      {a.realizedPnL != null && (
                        <div className={`text-xs ${a.realizedPnL >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {a.realizedPnL >= 0 ? "+" : ""}{a.realizedPnL.toFixed(0)}%
                        </div>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function TokenScanner() {
  const location = useLocation();
  const initialState = (location.state as { tab?: ScannerTab })?.tab;
  const searchParams = new URLSearchParams(location.search);
  const tabParam = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<ScannerTab>(
    tabParam === "discover" || initialState === "discover" ? "discover" : "token",
  );
  const [tokenAddress, setTokenAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [showPredictions, setShowPredictions] = useState(false);
  const [showVerdict, setShowVerdict] = useState(false);

  const analyzeToken = useCallback(async () => {
    const addr = tokenAddress.trim();
    if (!addr || addr.length < 32) return;

    setLoading(true);
    setError(null);
    setTokenData(null);
    setAnalysis(null);
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

      const { metadata, metrics, analysis: a } = json;

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

  useEffect(() => {
    if (!analysis || loading) return;
    setCurrentStep(0);
    const id = setInterval(() => {
      setCurrentStep((prev) => {
        const next = prev + 1;
        if (next >= ANALYSIS_STEPS.length) {
          clearInterval(id);
          setShowPredictions(true);
          setTimeout(() => setShowVerdict(true), 1800);
          return ANALYSIS_STEPS.length;
        }
        return next;
      });
    }, 650);
    return () => clearInterval(id);
  }, [analysis, loading]);

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
    return item ?? { value: "—", status: "info", reason: "Analysis pending" };
  };

  const isRevealing = analysis && !loading && currentStep > 0;

  return (
    <>
      <DocumentHead
        title="Token Scanner"
        description="Scan and analyze Solana tokens on COPE"
      />
      <div className="min-h-screen p-4 sm:p-6 pb-16 max-w-[720px] mx-auto overflow-visible">
      <h1 className="mb-4 text-xl font-bold text-white">Token Scanner</h1>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ScannerTab)} className="w-full">
        <TabsList className="w-full grid grid-cols-2 mb-4 bg-white/5 border border-white/10 p-1 rounded-xl min-w-0 overflow-hidden">
          <TabsTrigger
            value="token"
            className="data-[state=active]:bg-accent-primary/20 data-[state=active]:text-accent-primary data-[state=active]:border-accent-primary/30 rounded-lg py-2.5 px-2 min-w-0 max-w-full text-xs sm:text-sm overflow-hidden justify-center gap-1 sm:gap-2 min-h-[44px]"
          >
            <Target className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
            <span className="truncate">Token</span>
          </TabsTrigger>
          <TabsTrigger
            value="discover"
            className="data-[state=active]:bg-accent-primary/20 data-[state=active]:text-accent-primary data-[state=active]:border-accent-primary/30 rounded-lg py-2.5 px-2 min-w-0 max-w-full text-xs sm:text-sm overflow-hidden justify-center gap-1 sm:gap-2 min-h-[44px]"
          >
            <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
            <span className="truncate">Discover</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="token" className="mt-0">
      <div className="mb-6 rounded-xl border border-white/10 bg-white/5 p-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            value={tokenAddress}
            onChange={(e) => setTokenAddress(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && analyzeToken()}
            placeholder="Token address (Solana, Base, or BNB)"
            className="min-h-[44px] flex-1 rounded-lg bg-white/5 px-4 py-3 text-sm text-white placeholder:text-white/40 focus:outline-none focus:ring-2 focus:ring-[#12d585]"
          />
          <button
            type="button"
            onClick={analyzeToken}
            disabled={!tokenAddress.trim() || loading}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-2 rounded-lg bg-[#12d585] px-6 py-3 font-semibold text-black transition-opacity disabled:opacity-50"
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
                  {formatMarketCap(tokenData.marketCap)}
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
                  {formatMarketCap(tokenData.volume24h)}
                </div>
                <div className="text-xs text-white/50">
                  Liq: {formatMarketCap(tokenData.liquidityUSD)}
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
                className="min-h-[44px] min-w-[44px] shrink-0 rounded p-2 hover:bg-white/10"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-emerald-400" />
                ) : (
                  <Copy className="h-4 w-4 text-white/50" />
                )}
              </button>
            </div>
          </motion.div>

          {/* Analysis rows – stepped reveal with progress */}
          {isRevealing && (
            <div>
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-semibold text-white">
                  {currentStep >= ANALYSIS_STEPS.length
                    ? "Analysis Complete"
                    : "AI Analysis in Progress…"}
                </h2>
                {currentStep < ANALYSIS_STEPS.length && (
                  <span className="text-xs text-white/50">
                    {currentStep}/{ANALYSIS_STEPS.length}
                  </span>
                )}
              </div>
              <div className="mb-6 rounded-full h-1.5 overflow-hidden bg-white/10">
                <motion.div
                  className="h-full bg-[#12d585]"
                  initial={{ width: "0%" }}
                  animate={{
                    width: `${Math.min((currentStep / ANALYSIS_STEPS.length) * 100, 100)}%`,
                  }}
                  transition={{ duration: 0.4 }}
                />
              </div>
              <div className="space-y-3">
                {ANALYSIS_STEPS.map(({ key, icon, label }, index) => {
                  if (index >= currentStep) return null;
                  const data = getAnalysisItem(key);
                  return (
                    <AnalysisRow
                      key={key}
                      data={data}
                      icon={icon}
                      label={label}
                      isAnalyzing={index === currentStep - 1 && currentStep < ANALYSIS_STEPS.length}
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
                      {formatMarketCap(p.mcap)}
                    </div>
                    <div className="text-xs text-white/50 line-through">
                      {formatMarketCap(currentMcap)}
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
                className={`mt-6 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl font-bold text-white ${
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

        <TabsContent value="discover" className="mt-0">
          <DiscoverTabContent />
        </TabsContent>
      </Tabs>
    </div>
    </>
  );
}
