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
import { formatCurrency, formatPercentage, shortenAddress } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import {
  getWalletPnLSummary,
  getWalletPnL,
  TokenPnLData,
  getWalletPositions,
  getSolPrice,
} from "@/lib/solanatracker";
import { getSolBalance, getTokenAccounts } from "@/lib/rpc";
import { apiCache } from "@/lib/cache";
import { toast } from "sonner";

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
}

export function Positions() {
  const { userProfile } = useAuth();
  const navigate = useNavigate();
  const [positions, setPositions] = useState<Position[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState<any>(null);
  const [solBalance, setSolBalance] = useState<number>(0);
  const [solPrice, setSolPrice] = useState<number>(150);
  const [usdcBalance, setUsdcBalance] = useState<number>(0);

  const walletAddress = userProfile?.walletAddress;

  // Mainnet USDC mint (Circle)
  const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

  const fetchPositions = async (forceRefresh: boolean = false) => {
    if (!walletAddress) {
      setLoading(false);
      return;
    }

    try {
      setRefreshing(true);

      // Phase 1: Load positions + SOL/USDC balance/price first so the list shows immediately
      const positionsResponse = await getWalletPositions(
        walletAddress,
        !forceRefresh,
      );

      let currentSolBalance = 0;
      let currentSolPrice = 150;
      let currentUsdcBalance = 0;
      try {
        const [balance, price, tokenAccounts] = await Promise.all([
          getSolBalance(walletAddress),
          getSolPrice(),
          getTokenAccounts(walletAddress),
        ]);
        currentSolBalance = balance;
        currentSolPrice = price;
        setSolBalance(balance);
        setSolPrice(price);
        const usdcAccount = tokenAccounts.find((a) => a.mint === USDC_MINT);
        currentUsdcBalance = usdcAccount?.uiAmount ?? 0;
        setUsdcBalance(currentUsdcBalance);
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
          mint === "So11111111111111111111111111111111111111112" ||
          mint === "So11111111111111111111111111111111111111111";
        const isUSDC = mint === USDC_MINT;

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
          });
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
    <div className="p-4 sm:p-6 max-w-[720px] mx-auto">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Positions</h1>
          <button
            onClick={() => {
              // Clear cache and force refresh
              if (walletAddress) {
                apiCache.clear(`wallet_positions_${walletAddress}`);
                apiCache.clear(`wallet_pnl_${walletAddress}`);
              }
              fetchPositions(true);
            }}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-sm transition-colors disabled:opacity-50"
          >
            <RefreshCw
              className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </button>
        </div>

        {/* Portfolio Summary */}
        <Card glass className="mb-6">
          <div className="text-center">
            <p className="text-sm text-white/60 mb-1">Total Value</p>
            <h2 className="text-3xl font-bold mb-1">
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
              <div className="mt-4 pt-4 border-t border-white/10 grid grid-cols-2 gap-4 text-xs">
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
      <div className="space-y-3">
        {positions.length > 0 ? (
          positions.map((position) => {
            const isSOL =
              position.mint === "So11111111111111111111111111111111111111112" ||
              position.mint === "So11111111111111111111111111111111111111111";
            const isUSDC = position.mint === USDC_MINT;

            return (
              <Card
                key={position.mint}
                className="cursor-pointer hover:border-white/20 transition-colors"
                onClick={() => {
                  // Only pass the mint address - Trade screen will fetch full data
                  navigate("/app/trade", {
                    state: {
                      mint: position.mint,
                    },
                  });
                }}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    {position.image ? (
                      <img
                        src={position.image}
                        alt={position.symbol}
                        className="w-10 h-10 rounded-full"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                          (
                            e.target as HTMLImageElement
                          ).nextElementSibling?.classList.remove("hidden");
                        }}
                      />
                    ) : null}
                    <div
                      className={`w-10 h-10 rounded-full bg-gradient-to-br from-[#12d585] to-[#08b16b] ${position.image ? "hidden" : ""}`}
                    />
                    <div>
                      <h3 className="font-semibold">{position.name}</h3>
                      <p className="text-sm text-white/50">
                        {position.symbol} • {position.amount.toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
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
              </Card>
            );
          })
        ) : (
          <div className="text-center py-16">
            <DollarSign className="w-12 h-12 mx-auto mb-4 text-white/30" />
            <p className="text-white/60">No positions yet</p>
          </div>
        )}
      </div>
    </div>
  );
}
