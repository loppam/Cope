import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ArrowLeft, Filter, ExternalLink, Star } from 'lucide-react';
import { shortenAddress } from '@/lib/utils';
import { ScannerWallet } from '@/lib/birdeye';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface LocationState {
  mints?: string[];
  lookback?: string;
  minMatches?: number;
  minTrades?: number;
  wallets?: ScannerWallet[];
}

export function ScannerResults() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState | null;
  const { addToWatchlist, watchlist, isAuthenticated } = useAuth();
  const [copingWallets, setCopingWallets] = useState<Set<string>>(new Set());

  // Use real wallets from Birdeye or fallback to empty
  const wallets = state?.wallets || [];
  const matchedCount = wallets.length;

  const isWatched = (address: string) => {
    return watchlist.some(w => w.address === address);
  };

  const handleCopeWallet = async (e: React.MouseEvent, wallet: ScannerWallet) => {
    e.stopPropagation(); // Prevent row click navigation
    
    if (!isAuthenticated) {
      toast.error('Please sign in to COPE wallets');
      return;
    }

    if (isWatched(wallet.address)) {
      toast.info('Wallet is already in your watchlist');
      return;
    }

    try {
      setCopingWallets(prev => new Set(prev).add(wallet.address));
      
      // Calculate profit margin
      const totalInvested = wallet.totalInvested ?? 0;
      const totalRemoved = wallet.totalRemoved ?? 0;
      const profitMargin = totalInvested > 0 
        ? ((totalRemoved - totalInvested) / totalInvested) * 100 
        : 0;

      await addToWatchlist(wallet.address, {
        matched: wallet.matched,
        totalInvested,
        totalRemoved,
        profitMargin,
      });
    } catch (error) {
      // Error already handled in addToWatchlist
    } finally {
      setCopingWallets(prev => {
        const newSet = new Set(prev);
        newSet.delete(wallet.address);
        return newSet;
      });
    }
  };

  const formatCurrency = (value: number | undefined | null) => {
    const numValue = value ?? 0;
    if (numValue >= 1000000) {
      return `$${(numValue / 1000000).toFixed(2)}M`;
    }
    if (numValue >= 1000) {
      return `$${(numValue / 1000).toFixed(2)}K`;
    }
    return `$${numValue.toFixed(2)}`;
  };

  const getGmgnLink = (address: string) => {
    return `https://gmgn.ai/sol/address/${address}`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#000000] to-[#0B3D2E]">
      <div className="p-4 flex items-center justify-between">
        <Button variant="icon" onClick={() => navigate('/scanner')}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <Button variant="icon">
          <Filter className="w-5 h-5" />
        </Button>
      </div>

      <div className="p-6 max-w-[1200px] mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-2">Scanner Results</h1>
          <div className="flex gap-2">
            <span className="px-3 py-1 rounded-full bg-white/10 text-sm">
              {state?.lookback || '30D'}
            </span>
            <span className="px-3 py-1 rounded-full bg-white/10 text-sm">
              {matchedCount} wallets
            </span>
          </div>
        </div>

        {matchedCount === 0 ? (
          <Card className="text-center py-12">
            <p className="text-white/60 mb-4">No wallets found matching your criteria</p>
            <Button variant="outline" onClick={() => navigate('/scanner')}>
              Try Different Tokens
            </Button>
          </Card>
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-3 px-4 text-sm font-medium text-white/70">Wallet Address</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-white/70">Matched Tokens</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-white/70">Total Invested</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-white/70">Total Removed</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-white/70">Profit Margin</th>
                  <th className="text-center py-3 px-4 text-sm font-medium text-white/70">Action</th>
                </tr>
              </thead>
              <tbody>
                {wallets.map((wallet) => {
                  const totalInvested = wallet.totalInvested ?? 0;
                  const totalRemoved = wallet.totalRemoved ?? 0;
                  // Calculate profit margin: ((removed - invested) / invested) × 100
                  // Shows actual profit/loss percentage (e.g., 50% profit, -30% loss)
                  // Example: Invested $100, Removed $150 → (150-100)/100 × 100 = 50% profit
                  const profitMargin = totalInvested > 0 
                    ? ((totalRemoved - totalInvested) / totalInvested) * 100 
                    : 0;
                  const profitMarginColor = profitMargin > 0 
                    ? 'text-[#12d585]' 
                    : profitMargin === 0 
                    ? 'text-yellow-400' 
                    : 'text-[#FF4757]';

                  return (
                    <tr
                      key={wallet.address}
                      className="border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors"
                      onClick={() => navigate(`/scanner/wallet/${wallet.address}`, { state: wallet })}
                    >
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-2">
                          <code className="text-sm font-mono text-white">
                            {shortenAddress(wallet.address)}
                          </code>
                          <a
                            href={getGmgnLink(wallet.address)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-[#12d585] hover:text-[#08b16b] transition-colors"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <span className="text-white font-medium">
                          {wallet.matched}/{wallet.total}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-right">
                        <span className="text-white font-semibold">
                          {formatCurrency(totalInvested)}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-right">
                        <span className="text-white font-semibold">
                          {formatCurrency(totalRemoved)}
                        </span>
                      </td>
                      <td className="py-4 px-4 text-right">
                        <span className={`font-semibold ${profitMarginColor}`}>
                          {profitMargin > 0 ? '+' : ''}{profitMargin.toFixed(2)}%
                        </span>
                      </td>
                      <td className="py-4 px-4 text-center">
                        <Button
                          variant={isWatched(wallet.address) ? "outline" : "ghost"}
                          size="sm"
                          onClick={(e) => handleCopeWallet(e, wallet)}
                          disabled={copingWallets.has(wallet.address) || isWatched(wallet.address)}
                          className="min-w-[80px]"
                        >
                          {copingWallets.has(wallet.address) ? (
                            <>Adding...</>
                          ) : isWatched(wallet.address) ? (
                            <>
                              <Star className="w-4 h-4 fill-[#12d585] text-[#12d585]" />
                              COPE'd
                            </>
                          ) : (
                            <>
                              <Star className="w-4 h-4" />
                              COPE
                            </>
                          )}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}
