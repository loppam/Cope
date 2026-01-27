import { useEffect, useState } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ArrowLeft, ExternalLink, Star, TrendingUp, Activity, Loader2 } from 'lucide-react';
import { shortenAddress } from '@/lib/utils';
import { getWalletAnalytics, WalletAnalytics } from '@/lib/solanatracker';
import { ScannerWallet } from '@/lib/solanatracker';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

interface WalletState extends ScannerWallet {
  address?: string;
}

export function ScannerWalletDetail() {
  const navigate = useNavigate();
  const { address } = useParams();
  const location = useLocation();
  const walletState = location.state as WalletState | null;
  const { addToWatchlist, watchlist, isAuthenticated } = useAuth();
  const [analytics, setAnalytics] = useState<WalletAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [isCoping, setIsCoping] = useState(false);

  const walletAddress = address || walletState?.address || '';
  
  const isWatched = watchlist.some(w => w.address === walletAddress);
  
  const handleCope = async () => {
    if (!isAuthenticated) {
      toast.error('Please sign in to COPE wallets');
      return;
    }

    if (isWatched) {
      toast.info('Wallet is already in your watchlist');
      return;
    }

    try {
      setIsCoping(true);
      await addToWatchlist(walletAddress, {
        matched: walletState?.matched,
        totalInvested: walletState?.totalInvested,
        totalRemoved: walletState?.totalRemoved,
        profitMargin: walletState?.totalInvested && walletState?.totalRemoved
          ? ((walletState.totalRemoved - walletState.totalInvested) / walletState.totalInvested) * 100
          : undefined,
      });
      toast.success('Wallet added to watchlist!');
    } catch (error) {
      // Error already handled in addToWatchlist
    } finally {
      setIsCoping(false);
    }
  };

  useEffect(() => {
    if (!walletAddress) {
      navigate('/scanner');
      return;
    }

    const fetchAnalytics = async () => {
      try {
        setLoading(true);
        const data = await getWalletAnalytics(walletAddress);
        setAnalytics(data);
      } catch (error: any) {
        console.error('Error fetching wallet analytics:', error);
        toast.error('Failed to load wallet analytics');
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, [walletAddress, navigate]);

  // Use analytics data or fallback to state
  const wallet = analytics
    ? {
        address: walletAddress,
        winRate: analytics.winRate,
        wins: analytics.wins,
        losses: analytics.losses,
        trades: analytics.totalTrades,
        tokens: analytics.tokens,
      }
    : walletState;

  const matchedTokens = wallet?.tokens?.slice(0, 10).map((mint) => ({
    symbol: mint.slice(0, 4).toUpperCase(),
    mint: shortenAddress(mint),
  })) || [];

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#000000] to-[#0B3D2E]">
      <div className="p-4">
        <Button variant="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
      </div>

      <div className="p-6 max-w-[720px] mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-bold mb-2">Wallet Details</h1>
          <code className="text-sm font-mono text-white/70">
            {address && shortenAddress(address)}
          </code>
        </div>

        {loading ? (
          <Card glass className="mb-6 text-center py-8">
            <Loader2 className="w-8 h-8 mx-auto mb-4 animate-spin text-[#12d585]" />
            <p className="text-white/60">Loading wallet analytics...</p>
          </Card>
        ) : (
          <>
            {/* Stats */}
            <Card glass className="mb-6">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="flex items-center gap-2 mb-2 text-white/60">
                    <TrendingUp className="w-4 h-4" />
                    <span className="text-sm">Win Rate</span>
                  </div>
                  <p className="text-2xl font-bold text-[#12d585]">{wallet?.winRate || 0}%</p>
                  <p className="text-xs text-white/50 mt-1">
                    {wallet?.wins || 0}W / {wallet?.losses || 0}L
                  </p>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-2 text-white/60">
                    <Activity className="w-4 h-4" />
                    <span className="text-sm">Total Trades</span>
                  </div>
                  <p className="text-2xl font-bold">{wallet?.trades || 0}</p>
                  <p className="text-xs text-white/50 mt-1">Last 30 days</p>
                </div>
              </div>
            </Card>
          </>
        )}

        {/* Matched Tokens */}
        <div className="mb-6">
          <h3 className="font-semibold mb-3">Matched Tokens</h3>
          <div className="flex flex-wrap gap-2">
            {matchedTokens.map((token) => (
              <span
                key={token.mint}
                className="px-3 py-1.5 rounded-full bg-[#12d585]/10 text-[#12d585] text-sm font-medium"
              >
                {token.symbol}
              </span>
            ))}
          </div>
        </div>

        {analytics && (
          <Card className="mb-6">
            <h4 className="font-semibold mb-3">Trade Performance</h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-white/60">Total PnL</span>
                <span className={analytics.totalPnL && analytics.totalPnL >= 0 ? 'text-[#12d585]' : 'text-[#FF4757]'}>
                  {analytics.totalPnL !== undefined 
                    ? `${analytics.totalPnL >= 0 ? '+' : ''}${analytics.totalPnL.toFixed(2)} USD`
                    : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/60">Realized PnL</span>
                <span className={analytics.realizedPnL && analytics.realizedPnL >= 0 ? 'text-[#12d585]' : 'text-[#FF4757]'}>
                  {analytics.realizedPnL !== undefined 
                    ? `${analytics.realizedPnL >= 0 ? '+' : ''}${analytics.realizedPnL.toFixed(2)} USD`
                    : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/60">Unrealized PnL</span>
                <span className={analytics.unrealizedPnL && analytics.unrealizedPnL >= 0 ? 'text-[#12d585]' : 'text-[#FF4757]'}>
                  {analytics.unrealizedPnL !== undefined 
                    ? `${analytics.unrealizedPnL >= 0 ? '+' : ''}${analytics.unrealizedPnL.toFixed(2)} USD`
                    : 'N/A'}
                </span>
              </div>
              {analytics.totalPnLPercent !== undefined && (
                <div className="flex justify-between">
                  <span className="text-white/60">PnL %</span>
                  <span className={analytics.totalPnLPercent >= 0 ? 'text-[#12d585]' : 'text-[#FF4757]'}>
                    {analytics.totalPnLPercent >= 0 ? '+' : ''}{analytics.totalPnLPercent.toFixed(2)}%
                  </span>
                </div>
              )}
            </div>
          </Card>
        )}

        {/* Actions */}
        <div className="space-y-3">
          <Button 
            className="w-full h-12" 
            onClick={handleCope}
            disabled={isCoping || isWatched}
          >
            {isCoping ? (
              <>Adding to Watchlist...</>
            ) : isWatched ? (
              <>
                <Star className="w-5 h-5 fill-[#12d585] text-[#12d585]" />
                Already COPE'd
              </>
            ) : (
              <>
                <Star className="w-5 h-5" />
                COPE This Wallet
              </>
            )}
          </Button>
          <Button 
            variant="outline" 
            className="w-full h-10"
            onClick={() => window.open(`https://solscan.io/account/${walletAddress}`, '_blank')}
          >
            <ExternalLink className="w-4 h-4" />
            View on Explorer
          </Button>
        </div>
      </div>
    </div>
  );
}
