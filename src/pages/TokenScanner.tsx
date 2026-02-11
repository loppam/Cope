/**
 * Token Scanner – minified token analysis based on Premium Web App Interface.
 * Uses /api/analyze-token with BIRDEYE_API_KEY (same as platform).
 * No artificial delays – full scan completes in one request.
 */
import { useState, useCallback } from "react";
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
import { getApiBase } from "@/lib/utils";

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

type StatusKind = "safe" | "warning" | "danger" | "info";

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

function AnalysisRow({
  data,
  icon: Icon,
  label,
}: {
  data: AnalysisItem;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  const status = data?.status || "info";
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
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-white/10 bg-white/5 p-4"
    >
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-[#12d585]" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-white/80">{label}</div>
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
        </div>
      </div>
    </motion.div>
  );
}

export function TokenScanner() {
  const [tokenAddress, setTokenAddress] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [copied, setCopied] = useState(false);

  const analyzeToken = useCallback(async () => {
    const addr = tokenAddress.trim();
    if (!addr || addr.length < 32) return;

    setLoading(true);
    setError(null);
    setTokenData(null);
    setAnalysis(null);

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

  return (
    <div className="min-h-[50vh] p-4 sm:p-6 max-w-[720px] mx-auto">
      <h1 className="mb-4 text-xl font-bold text-white">Token Scanner</h1>

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
          {/* Token overview */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 sm:p-6">
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
          </div>

          {/* Analysis rows */}
          <div>
            <h2 className="mb-3 text-base font-semibold text-white">
              Analysis
            </h2>
            <div className="space-y-3">
              {ANALYSIS_STEPS.map(({ key, icon, label }) => {
                const data = analysis[key as keyof AnalysisResult] as
                  | AnalysisItem
                  | undefined;
                if (!data) return null;
                return (
                  <AnalysisRow
                    key={key}
                    data={data}
                    icon={icon}
                    label={label}
                  />
                );
              })}
            </div>
          </div>

          {/* Predictions */}
          {predictions && (
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
              ).map(([key, p, badge, color]) => (
                  <motion.div
                    key={key}
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="rounded-xl border border-white/10 bg-white/5 p-4"
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

          {/* Verdict */}
          {(analysis.overallProbability != null || analysis.recommendation) && (
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
    </div>
  );
}
