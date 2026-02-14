import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { Card } from "@/components/Card";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { formatCurrency, formatPercentage, shortenAddress, getApiBase } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import {
  getWalletPnLSummary,
  getWalletPnL,
  TokenPnLData,
  getWalletPositions,
  getSolPrice,
} from "@/lib/solanatracker";
import { getSolBalance, getUsdcBalance } from "@/lib/rpc";
import { fetchNativePrices } from "@/lib/coingecko";
import { apiCache, UI_CACHE_TTL_MS } from "@/lib/cache";
import { SOLANA_USDC_MINT, SOL_MINT } from "@/lib/constants";
import { toast } from "sonner";

type ChainTag = "solana" | "base" | "bnb";

interface Position {
  mint: string;
  symbol: string;
  name: string;
  image?: string;
  amount: number;
  value: number;
  pnl: number;
  pnlPercent: number;
  realized: number;
  unrealized: number;
  costBasis: number;
  tokenData?: TokenPnLData;
  buys?: number;
  sells?: number;
  txns?: number;
  holders?: number;
  chain?: ChainTag;
}

export function Positions() {
  const { user, userProfile } = useAuth();
  const navigate = useNavigate();
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const [solBalance, setSolBalance] = useState<number>(0);
  const [solPrice, setSolPrice] = useState<number>(150);
  const [usdcBalance, setUsdcBalance] = useState<number>(0);

  const walletAddress = userProfile?.walletAddress;

  const fetchPositions = async (forceRefresh: boolean = false) => {
    if (!walletAddress) {
      setLoading(false);
      return;
    }

    try {
      setRefreshing(true);
      const cacheKey = `positions_${walletAddress}`;
      if (!forceRefresh) {
        const cached = apiCache.get<{
          positions: Position[];
          summary: any;
          solBalance: number;
          solPrice: number;
          usdcBalance: number;
        }>(cacheKey);
        if (cached) {
          setPositions(cached.positions);
          setSummary(cached.summary);
          setSolBalance(cached.solBalance);
          setSolPrice(cached.solPrice);
          setUsdcBalance(cached.usdcBalance);
          setLoading(false);
          setRefreshing(false);
          fetchPositions(true); // refetch in background
          return;
        }
      }

      // Phase 1: Load positions + SOL/USDC balance/price first so the list shows immediately
      const positionsResponse = await getWalletPositions(
        walletAddress,
        !forceRefresh,
      );

      let currentSolBalance = 0;
      let currentSolPrice = 150;
      let currentUsdcBalance = 0;
      let nativePrices = { eth: 3000, bnb: 600 };
      try {
        const [balance, price, usdcBal, prices] = await Promise.all([
          getSolBalance(walletAddress),
          getSolPrice(),
          getUsdcBalance(walletAddress),
          fetchNativePrices(),
        ]);
        currentSolBalance = balance;
        currentSolPrice = price;
        currentUsdcBalance = usdcBal;
        nativePrices = prices;
        setSolBalance(balance);
        setSolPrice(price);
        setUsdcBalance(usdcBal);
      } catch (error) {
        console.warn("Failed to fetch SOL/USDC balance or price:", error);
        currentSolBalance = solBalance;
        currentSolPrice = solPrice;
        currentUsdcBalance = usdcBalance;
      }

      const positionsData: Position[] = [];
      for (const positionToken of positionsResponse.tokens) {
        const mint = positionToken.token.mint;
        const isSOL =
          mint === SOL_MINT ||
          mint === "So11111111111111111111111111111111111111111";
        const isUSDC = mint === SOLANA_USDC_MINT;

        let tokenValue = positionToken.value || 0;
        let tokenAmount = positionToken.balance || 0;

        if (isSOL) {
          tokenValue = currentSolBalance * currentSolPrice;
          tokenAmount = currentSolBalance;
        } else if (isUSDC) {
          tokenAmount = currentUsdcBalance;
          tokenValue = currentUsdcBalance * 1;
        }

        if (tokenValue > 0) {
          positionsData.push({
            mint,
            symbol: isSOL
              ? "SOL"
              : isUSDC
                ? "USDC"
                : positionToken.token.symbol || shortenAddress(mint),
            name: isSOL
              ? "Solana"
              : isUSDC
                ? "USD Coin"
                : positionToken.token.name || "Unknown Token",
            image: positionToken.token.image,
            amount: tokenAmount,
            value: tokenValue,
            pnl: 0,
            pnlPercent: 0,
            realized: 0,
            unrealized: 0,
            costBasis: 0,
            tokenData: undefined,
            buys: positionToken.buys,
            sells: positionToken.sells,
            txns: positionToken.txns,
            holders: positionToken.holders,
            chain: "solana",
          });
        }
      }

      if (user) {
        try {
          const token = await user.getIdToken();
          const base = getApiBase();
          const res = await fetch(`${base}/api/relay/evm-balances`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = await res.json();
          if (res.ok && data.evmAddress) {
            if (Array.isArray(data.tokens) && data.tokens.length > 0) {
              for (const t of data.tokens) {
                if (t.value > 0) {
                  positionsData.push({
                    mint: t.mint,
                    symbol: t.symbol ?? "???",
                    name: t.name ?? "Unknown Token",
                    image: t.image,
                    amount: t.amount ?? 0,
                    value: t.value ?? 0,
                    pnl: 0,
                    pnlPercent: 0,
                    realized: 0,
                    unrealized: 0,
                    costBasis: 0,
                    chain: t.chain ?? "base",
                  });
                }
              }
            } else {
              // Fallback to legacy base/bnb structure when Moralis tokens not available
              if (data.base?.usdc > 0) {
                positionsData.push({
                  mint: "base-usdc",
                  symbol: "USDC",
                  name: "USD Coin (Base)",
                  amount: data.base.usdc,
                  value: data.base.usdc,
                  pnl: 0,
                  pnlPercent: 0,
                  realized: 0,
                  unrealized: 0,
                  costBasis: 0,
                  chain: "base",
                });
              }
              if (data.base?.native > 0) {
                positionsData.push({
                  mint: "base-eth",
                  symbol: "ETH",
                  name: "Ethereum (Base)",
                  amount: data.base.native,
                  value: data.base.native * nativePrices.eth,
                  pnl: 0,
                  pnlPercent: 0,
                  realized: 0,
                  unrealized: 0,
                  costBasis: 0,
                  chain: "base",
                });
              }
              if (data.bnb?.usdc > 0) {
                positionsData.push({
                  mint: "bnb-usdc",
                  symbol: "USDC",
                  name: "USD Coin (BNB)",
                  amount: data.bnb.usdc,
                  value: data.bnb.usdc,
                  pnl: 0,
                  pnlPercent: 0,
                  realized: 0,
                  unrealized: 0,
                  costBasis: 0,
                  chain: "bnb",
                });
              }
              if (data.bnb?.native > 0) {
                positionsData.push({
                  mint: "bnb-bnb",
                  symbol: "BNB",
                  name: "BNB",
                  amount: data.bnb.native,
                  value: data.bnb.native * nativePrices.bnb,
                  pnl: 0,
                  pnlPercent: 0,
                  realized: 0,
                  unrealized: 0,
                  costBasis: 0,
                  chain: "bnb",
                });
              }
            }
          }
        } catch (err) {
          console.warn("EVM balances fetch failed:", err);
        }
      }

      positionsData.sort((a, b) => b.value - a.value);
      setPositions(positionsData);
      setLoading(false);
      setRefreshing(false);

      // Yield so the UI actually paints the positions-first state (avoids batching with phase 2)
      await new Promise((r) => setTimeout(r, 0));
      // Brief delay before loading PnL so positions are visible first
      await new Promise((r) => setTimeout(r, 1000));

      // Phase 2: Load PnL and merge into positions (may be cached)
      const pnlResponse = await getWalletPnL(
        walletAddress,
        !forceRefresh,
      ).catch(() => ({ tokens: {} }));
      let summaryData: any = { data: { summary: null } };
      try {
        summaryData = await getWalletPnLSummary(walletAddress);
      } catch {
        // ignore
      }
      setSummary(summaryData.data?.summary ?? null);

      const pnlTokens: Record<string, TokenPnLData> = pnlResponse.tokens || {};
      const merged = positionsData.map((pos) => {
        const tokenPnL = pnlTokens[pos.mint];
        const total = tokenPnL?.total ?? 0;
        const totalInvested = tokenPnL?.total_invested ?? 0;
        const costBasis = tokenPnL?.cost_basis ?? 0;
        let pnlPercent = 0;
        if (totalInvested > 0) pnlPercent = (total / totalInvested) * 100;
        else if (costBasis > 0) pnlPercent = (total / costBasis) * 100;
        return {
          ...pos,
          pnl: total,
          pnlPercent,
          realized: tokenPnL?.realized ?? 0,
          unrealized: tokenPnL?.unrealized ?? 0,
          costBasis,
          tokenData: tokenPnL,
        };
      });
      setPositions(merged);
      apiCache.set(
        `positions_${walletAddress}`,
        {
          positions: merged,
          summary: summaryData.data?.summary ?? null,
          solBalance: currentSolBalance,
          solPrice: currentSolPrice,
          usdcBalance: currentUsdcBalance,
        },
        UI_CACHE_TTL_MS,
      );
    } catch (error: any) {
      console.error("Error fetching positions:", error);
      toast.error("Failed to load positions");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchPositions();
  }, [walletAddress, user]);

  useEffect(() => {
    const onRefresh = () => {
      if (walletAddress) fetchPositions(true);
    };
    window.addEventListener("cope-refresh-balance", onRefresh);
    return () => window.removeEventListener("cope-refresh-balance", onRefresh);
  }, [walletAddress]);

  // Calculate total value
  // Since SOL is included in the positions list, tokensValue already includes SOL
  // All token values from API are already in USD, SOL value is calculated as solBalance * solPrice
  const tokensValue = positions.reduce((acc, pos) => acc + pos.value, 0);

  // Total value is the sum of all positions (which includes SOL)
  const totalValue = tokensValue;

  // Calculate total PnL
  const totalPnl =
    summary?.pnl?.total_usd || positions.reduce((acc, pos) => acc + pos.pnl, 0);
  const totalPnlPercent =
    summary?.pnl?.realized_profit_percent ||
    (totalValue > 0 ? (totalPnl / (totalValue - totalPnl)) * 100 : 0);

  if (!walletAddress) {
    return (
      <div className="p-6 max-w-[720px] mx-auto">
        <div className="text-center py-16">
          <DollarSign className="w-12 h-12 mx-auto mb-4 text-white/30" />
          <p className="text-white/60 mb-2">No wallet connected</p>
          <p className="text-sm text-white/40">
            Connect a wallet to view your positions
          </p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6 max-w-[720px] mx-auto">
        <div className="text-center py-16">
          <Loader2 className="w-12 h-12 mx-auto mb-4 text-white/30 animate-spin" />
          <p className="text-white/60">Loading positions...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-[720px] mx-auto pb-8">
      <div className="mb-6 sm:mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold">Positions</h1>
          <button
            onClick={() => {
              if (walletAddress) {
                apiCache.clear(`wallet_positions_${walletAddress}`);
                apiCache.clear(`wallet_pnl_${walletAddress}`);
              }
              fetchPositions(true);
            }}
            disabled={refreshing}
            className="flex items-center justify-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl bg-white/10 hover:bg-white/15 text-sm transition-colors disabled:opacity-50 active:scale-[0.98] w-full sm:w-auto"
          >
            <RefreshCw
              className={`w-4 h-4 flex-shrink-0 ${refreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </div>

        {/* Portfolio Summary */}
        <Card glass className="mb-6 overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-[#12d585]/40 via-[#08b16b]/30 to-transparent" />
          <div className="p-4 sm:p-6 text-center">
            <p className="text-sm text-white/60 mb-1">Total Value</p>
            <h2 className="text-2xl sm:text-3xl font-bold mb-1">
              {formatCurrency(totalValue)}
            </h2>
            <p
              className={`text-lg ${
                totalPnl >= 0 ? "text-[#12d585]" : "text-[#FF4757]"
              }`}
            >
              {formatCurrency(totalPnl)} ({formatPercentage(totalPnlPercent)})
            </p>
            {summary && (
              <div className="mt-4 pt-4 border-t border-white/10 grid grid-cols-2 gap-3 sm:gap-4 text-xs">
                <div>
                  <p className="text-white/60">Realized</p>
                  <p
                    className={`font-semibold ${summary.pnl.realized_profit_usd >= 0 ? "text-[#12d585]" : "text-[#FF4757]"}`}
                  >
                    {formatCurrency(summary.pnl.realized_profit_usd)}
                  </p>
                </div>
                <div>
                  <p className="text-white/60">Unrealized</p>
                  <p
                    className={`font-semibold ${summary.pnl.unrealized_usd >= 0 ? "text-[#12d585]" : "text-[#FF4757]"}`}
                  >
                    {formatCurrency(summary.pnl.unrealized_usd)}
                  </p>
                </div>
                <div>
                  <p className="text-white/60">Total Invested</p>
                  <p className="font-semibold">
                    {formatCurrency(summary.cashflow_usd.total_invested)}
                  </p>
                </div>
                <div>
                  <p className="text-white/60">Win Rate</p>
                  <p className="font-semibold">
                    {formatPercentage(summary.counts.win_rate * 100)}
                  </p>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Positions List */}
      {/* Note: Token values from API are already in USD - displayed directly */}
      {/* SOL is shown but without detailed P&L info (to avoid double-counting with summary) */}
      <div className="space-y-2 sm:space-y-3">
        {positions.length > 0 ? (
          positions.map((position) => {
            const isSOL =
              position.mint === SOL_MINT ||
              position.mint === "So11111111111111111111111111111111111111111";
            const isUSDC = position.mint === SOLANA_USDC_MINT;
            const chainLabel = position.chain === "base" ? "Base" : position.chain === "bnb" ? "BNB" : "Solana";

            return (
              <Card
                key={`${position.chain ?? "solana"}-${position.mint}`}
                glass
                className="cursor-pointer hover:border-white/20 transition-colors overflow-hidden active:scale-[0.99]"
                onClick={() => {
                  navigate("/app/trade", {
                    state: { mint: position.mint, chain: position.chain },
                  });
                }}
              >
                <div className="h-0.5 bg-gradient-to-r from-[#12d585]/20 via-transparent to-transparent" />
                <div className="p-4 sm:p-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {position.image ? (
                        <img
                          src={position.image}
                          alt={position.symbol}
                          className="w-9 h-9 sm:w-10 sm:h-10 rounded-full flex-shrink-0"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display =
                              "none";
                            (
                              e.target as HTMLImageElement
                            ).nextElementSibling?.classList.remove("hidden");
                          }}
                        />
                      ) : null}
                      <div
                        className={`w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-gradient-to-br from-[#12d585] to-[#08b16b] flex-shrink-0 ${position.image ? "hidden" : ""}`}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-sm sm:text-base truncate">
                            {position.name}
                          </h3>
                          {position.chain && (
                            <span
                              className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                                position.chain === "base"
                                  ? "bg-blue-500/20 text-blue-300"
                                  : position.chain === "bnb"
                                    ? "bg-amber-500/20 text-amber-300"
                                    : "bg-[#12d585]/20 text-[#12d585]"
                              }`}
                            >
                              {chainLabel}
                            </span>
                          )}
                        </div>
                        <p className="text-xs sm:text-sm text-white/50 truncate">
                          {position.symbol} • {position.amount.toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      {/* Token value is already in USD from API - display directly */}
                      {/* SOL value is calculated separately */}
                      <p className="font-semibold">
                        {formatCurrency(position.value)}
                      </p>
                      {!isSOL && !isUSDC && (
                        <p
                          className={`text-sm flex items-center gap-1 justify-end ${
                            position.pnl >= 0
                              ? "text-[#12d585]"
                              : "text-[#FF4757]"
                          }`}
                        >
                          {position.pnl >= 0 ? (
                            <TrendingUp className="w-3 h-3" />
                          ) : (
                            <TrendingDown className="w-3 h-3" />
                          )}
                          {formatPercentage(position.pnlPercent)}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Token details - hide for SOL and USDC (native/stablecoin) */}
                  {!isSOL && !isUSDC && (
                    <div className="pt-3 border-t border-white/6 space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-white/60">Total P&L</span>
                        <span
                          className={`font-medium ${
                            position.pnl >= 0
                              ? "text-[#12d585]"
                              : "text-[#FF4757]"
                          }`}
                        >
                          {formatCurrency(position.pnl)} (
                          {formatPercentage(position.pnlPercent)})
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-white/60">Realized: </span>
                          <span
                            className={
                              position.realized >= 0
                                ? "text-[#12d585]"
                                : "text-[#FF4757]"
                            }
                          >
                            {formatCurrency(position.realized)}
                          </span>
                        </div>
                        <div>
                          <span className="text-white/60">Unrealized: </span>
                          <span
                            className={
                              position.unrealized >= 0
                                ? "text-[#12d585]"
                                : "text-[#FF4757]"
                            }
                          >
                            {formatCurrency(position.unrealized)}
                          </span>
                        </div>
                        <div>
                          <span className="text-white/60">Cost Basis: </span>
                          <span>{formatCurrency(position.costBasis)}</span>
                        </div>
                        <div>
                          <span className="text-white/60">Trades: </span>
                          <span>
                            {position.tokenData?.total_transactions ||
                              position.txns ||
                              0}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            );
          })
        ) : (
          <Card glass className="overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-[#12d585]/20 via-transparent to-transparent" />
            <div className="py-12 sm:py-16 text-center px-4">
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-4">
                <DollarSign className="w-8 h-8 sm:w-10 sm:h-10 text-white/30" />
              </div>
              <p className="text-white/60 text-sm sm:text-base">
                No positions yet
              </p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
