import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Card } from '@/components/Card';
import { TrendingUp, TrendingDown, DollarSign, RefreshCw, Loader2 } from 'lucide-react';
import { formatCurrency, formatPercentage, shortenAddress } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { getWalletPnLSummary, getWalletPnL, TokenPnLData, getWalletPositions, TokenSearchResult, getSolPrice } from '@/lib/solanatracker';
import { getSolBalance } from '@/lib/rpc';
import { apiCache } from '@/lib/cache';
import { toast } from 'sonner';

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

  const walletAddress = userProfile?.walletAddress;

  const fetchPositions = async (forceRefresh: boolean = false) => {
    if (!walletAddress) {
      setLoading(false);
      return;
    }

    try {
      setRefreshing(true);
      
      // Get wallet positions with full token details (single API call - no rate limits!)
      // Also get PnL data in parallel
      // Use cache unless force refresh
      const [positionsResponse, pnlResponse] = await Promise.all([
        getWalletPositions(walletAddress, !forceRefresh),
        getWalletPnL(walletAddress, !forceRefresh).catch(() => ({ tokens: {} })), // Fallback if PnL fails
      ]);

      // Get summary (this internally uses getWalletPnL, but we already have it)
      // We can compute summary from pnlResponse to avoid duplicate call
      let summaryData: any = { data: { summary: null } };
      try {
        summaryData = await getWalletPnLSummary(walletAddress);
      } catch (error) {
        // If summary fails, we'll just not show it
        console.warn('Failed to fetch summary:', error);
      }
      setSummary(summaryData.data?.summary);

      // Get SOL balance and price
      try {
        const [balance, price] = await Promise.all([
          getSolBalance(walletAddress),
          getSolPrice(),
        ]);
        setSolBalance(balance);
        setSolPrice(price);
      } catch (error) {
        console.warn('Failed to fetch SOL balance/price:', error);
      }

      // Merge position data with PnL data
      const pnlTokens = pnlResponse.tokens || {};
      const positionsData: Position[] = [];
      
      for (const positionToken of positionsResponse.tokens) {
        // Only show positions with value > 0 (filter out zero value positions)
        if (positionToken.value > 0) {
          const mint = positionToken.token.mint;
          const tokenPnL = pnlTokens[mint];
          
          // Special handling for SOL token
          const isSOL = mint === 'So11111111111111111111111111111111111111112' || 
                       mint === 'So11111111111111111111111111111111111111111';
          
          positionsData.push({
            mint,
            symbol: positionToken.token.symbol || shortenAddress(mint),
            name: isSOL ? 'Solana' : (positionToken.token.name || 'Unknown Token'),
            image: positionToken.token.image,
            amount: positionToken.balance || 0,
            value: positionToken.value || 0,
            pnl: tokenPnL?.total || 0,
            pnlPercent: tokenPnL?.cost_basis && tokenPnL.cost_basis > 0
              ? ((tokenPnL.total || 0) / tokenPnL.cost_basis) * 100
              : 0,
            realized: tokenPnL?.realized || 0,
            unrealized: tokenPnL?.unrealized || 0,
            costBasis: tokenPnL?.cost_basis || 0,
            tokenData: tokenPnL,
            buys: positionToken.buys,
            sells: positionToken.sells,
            txns: positionToken.txns,
            holders: positionToken.holders,
          });
        }
      }

      // Sort by value (highest first)
      positionsData.sort((a, b) => b.value - a.value);
      setPositions(positionsData);
    } catch (error: any) {
      console.error('Error fetching positions:', error);
      toast.error('Failed to load positions');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchPositions();
  }, [walletAddress]);

  // Calculate total value: sum of all positions + SOL balance
  const tokensValue = positions.reduce((acc, pos) => acc + pos.value, 0);
  const solValue = solBalance * solPrice;
  const totalValue = tokensValue + solValue;
  
  // Calculate total PnL
  const totalPnl = summary?.pnl?.total_usd || positions.reduce((acc, pos) => acc + pos.pnl, 0);
  const totalPnlPercent = summary?.pnl?.realized_profit_percent || 
    (totalValue > 0 ? (totalPnl / (totalValue - totalPnl)) * 100 : 0);

  if (!walletAddress) {
    return (
      <div className="p-6 max-w-[720px] mx-auto">
        <div className="text-center py-16">
          <DollarSign className="w-12 h-12 mx-auto mb-4 text-white/30" />
          <p className="text-white/60 mb-2">No wallet connected</p>
          <p className="text-sm text-white/40">Connect a wallet to view your positions</p>
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
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Portfolio Summary */}
        <Card glass className="mb-6">
          <div className="text-center">
            <p className="text-sm text-white/60 mb-1">Total Value</p>
            <h2 className="text-3xl font-bold mb-1">{formatCurrency(totalValue)}</h2>
            <p
              className={`text-lg ${
                totalPnl >= 0 ? 'text-[#12d585]' : 'text-[#FF4757]'
              }`}
            >
              {formatCurrency(totalPnl)} ({formatPercentage(totalPnlPercent)})
            </p>
            {summary && (
              <div className="mt-4 pt-4 border-t border-white/10 grid grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="text-white/60">Realized</p>
                  <p className={`font-semibold ${summary.pnl.realized_profit_usd >= 0 ? 'text-[#12d585]' : 'text-[#FF4757]'}`}>
                    {formatCurrency(summary.pnl.realized_profit_usd)}
                  </p>
                </div>
                <div>
                  <p className="text-white/60">Unrealized</p>
                  <p className={`font-semibold ${summary.pnl.unrealized_usd >= 0 ? 'text-[#12d585]' : 'text-[#FF4757]'}`}>
                    {formatCurrency(summary.pnl.unrealized_usd)}
                  </p>
                </div>
                <div>
                  <p className="text-white/60">Total Invested</p>
                  <p className="font-semibold">{formatCurrency(summary.cashflow_usd.total_invested)}</p>
                </div>
                <div>
                  <p className="text-white/60">Win Rate</p>
                  <p className="font-semibold">{formatPercentage(summary.counts.win_rate * 100)}</p>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Positions List */}
      <div className="space-y-3">
        {positions.length > 0 ? (
          positions.map((position) => {
            const isSOL = position.mint === 'So11111111111111111111111111111111111111112' || 
                         position.mint === 'So11111111111111111111111111111111111111111';

            return (
              <Card 
                key={position.mint} 
                className="cursor-pointer hover:border-white/20 transition-colors"
                onClick={() => {
                  // Only pass the mint address - Trade screen will fetch full data
                  navigate('/app/trade', { 
                    state: { 
                      mint: position.mint 
                    } 
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
                          (e.target as HTMLImageElement).style.display = 'none';
                          (e.target as HTMLImageElement).nextElementSibling?.classList.remove('hidden');
                        }}
                      />
                    ) : null}
                    <div className={`w-10 h-10 rounded-full bg-gradient-to-br from-[#12d585] to-[#08b16b] ${position.image ? 'hidden' : ''}`} />
                    <div>
                      <h3 className="font-semibold">{position.name}</h3>
                      <p className="text-sm text-white/50">{position.symbol} • {position.amount.toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">{formatCurrency(position.value)}</p>
                    <p
                      className={`text-sm flex items-center gap-1 justify-end ${
                        position.pnl >= 0 ? 'text-[#12d585]' : 'text-[#FF4757]'
                      }`}
                    >
                      {position.pnl >= 0 ? (
                        <TrendingUp className="w-3 h-3" />
                      ) : (
                        <TrendingDown className="w-3 h-3" />
                      )}
                      {formatPercentage(position.pnlPercent)}
                    </p>
                  </div>
                </div>

                {/* Simplified display for SOL, full details for other tokens */}
                {!isSOL && (
                  <div className="pt-3 border-t border-white/6 space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-white/60">Total P&L</span>
                      <span
                        className={`font-medium ${
                          position.pnl >= 0 ? 'text-[#12d585]' : 'text-[#FF4757]'
                        }`}
                      >
                        {formatCurrency(position.pnl)} ({formatPercentage(position.pnlPercent)})
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-white/60">Realized: </span>
                        <span className={position.realized >= 0 ? 'text-[#12d585]' : 'text-[#FF4757]'}>
                          {formatCurrency(position.realized)}
                        </span>
                      </div>
                      <div>
                        <span className="text-white/60">Unrealized: </span>
                        <span className={position.unrealized >= 0 ? 'text-[#12d585]' : 'text-[#FF4757]'}>
                          {formatCurrency(position.unrealized)}
                        </span>
                      </div>
                      <div>
                        <span className="text-white/60">Cost Basis: </span>
                        <span>{formatCurrency(position.costBasis)}</span>
                      </div>
                      <div>
                        <span className="text-white/60">Trades: </span>
                        <span>{position.tokenData?.total_transactions || position.txns || 0}</span>
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
