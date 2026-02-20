import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ArrowLeft, Filter, ExternalLink, Star, ChevronDown, ChevronUp } from 'lucide-react';
import { shortenAddress, formatCurrency } from '@/lib/utils';
import { ScannerWallet, ScannerTokenStat } from '@/lib/birdeye';
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
  const [expandedAddress, setExpandedAddress] = useState<string | null>(null);

  // Use real wallets from Birdeye scan or fallback to empty
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
      
      const totalInvested = wallet.totalInvested ?? 0;
      const totalRemoved = wallet.totalRemoved ?? 0;
      const avgRoi = wallet.averageRoiPct ?? (totalInvested > 0 ? ((totalRemoved - totalInvested) / totalInvested) * 100 : 0);

      await addToWatchlist(wallet.address, {
        matched: wallet.matched,
        totalInvested,
        totalRemoved,
        profitMargin: avgRoi,
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

      <div className="p-4 pb-[max(2rem,env(safe-area-inset-bottom))] max-w-[1200px] mx-auto">
        <div className="mb-4">
          <h1 className="text-xl font-bold mb-2">Scanner Results</h1>
          <div className="flex flex-wrap gap-2">
            <span className="px-3 py-1.5 rounded-full bg-white/10 text-sm">
              {state?.lookback || '30D'}
            </span>
            <span className="px-3 py-1.5 rounded-full bg-white/10 text-sm">
              {matchedCount} wallets
            </span>
          </div>
        </div>

        {matchedCount === 0 ? (
          <Card className="text-center py-12 px-4">
            <p className="text-white/60 mb-4 text-sm">No wallets found matching your criteria</p>
            <Button variant="outline" onClick={() => navigate('/scanner')} className="min-h-[44px]">
              Try Different Tokens
            </Button>
          </Card>
        ) : (
          <ul className="space-y-3">
            {wallets.map((wallet) => {
              const totalInvested = wallet.totalInvested ?? 0;
              const totalRemoved = wallet.totalRemoved ?? 0;
              const pnlUsd = totalRemoved - totalInvested;
              const avgRoiPct = wallet.averageRoiPct ?? (totalInvested > 0 ? (pnlUsd / totalInvested) * 100 : null);
              const tokenStats = wallet.tokenStats ?? [];
              const pnlColor = pnlUsd >= 0 ? 'text-[#12d585]' : 'text-[#FF4757]';
              const roiColor = avgRoiPct === null ? 'text-white/50' : avgRoiPct > 0 ? 'text-[#12d585]' : avgRoiPct === 0 ? 'text-yellow-400' : 'text-[#FF4757]';
              const isExpanded = expandedAddress === wallet.address;

              return (
                <li key={wallet.address}>
                  <Card className="block w-full text-left overflow-hidden p-0">
                    {/* Accordion header: tap to expand/collapse */}
                    <button
                      type="button"
                      className="w-full text-left p-4 min-h-[44px] active:bg-white/5 touch-manipulation"
                      onClick={() => setExpandedAddress(isExpanded ? null : wallet.address)}
                      aria-expanded={isExpanded}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <code className="text-sm font-mono text-white truncate">
                            {shortenAddress(wallet.address)}
                          </code>
                          <a
                            href={getGmgnLink(wallet.address)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="flex-shrink-0 p-2 -m-2 touch-manipulation text-[#12d585]"
                            aria-label="Open on GMGN"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        </div>
                        <span className="flex-shrink-0 text-sm font-medium text-white/80">
                          {wallet.matched}/{wallet.total} tokens
                        </span>
                        <span className="flex-shrink-0 text-white/60">
                          {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center mt-3">
                        <div>
                          <p className="text-xs text-white/50 mb-0.5">Invested ($)</p>
                          <p className="text-sm font-semibold text-white truncate" title={formatCurrency(totalInvested)}>
                            {formatCurrency(totalInvested)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-white/50 mb-0.5">PnL ($)</p>
                          <p className={`text-sm font-semibold truncate ${pnlColor}`} title={formatCurrency(pnlUsd)}>
                            {formatCurrency(pnlUsd)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-white/50 mb-0.5">Avg ROI (%)</p>
                          <p className={`text-sm font-semibold ${roiColor}`}>
                            {avgRoiPct === null ? '–' : `${avgRoiPct >= 0 ? '+' : ''}${avgRoiPct.toFixed(1)}%`}
                          </p>
                        </div>
                      </div>
                    </button>

                    {/* Accordion body: per-token breakdown */}
                    {isExpanded && tokenStats.length > 0 && (
                      <div className="border-t border-white/10 px-4 py-3 space-y-2 bg-white/[0.02]">
                        <p className="text-xs font-medium text-white/60 mb-2">Per token</p>
                        <div className="grid grid-cols-4 gap-2 px-3 text-xs text-white/50">
                          <span>Token</span>
                          <span className="text-right">Invested</span>
                          <span className="text-right">PnL</span>
                          <span className="text-right">ROI</span>
                        </div>
                        {tokenStats.map((stat: ScannerTokenStat) => (
                          <div
                            key={stat.mint}
                            className="grid grid-cols-4 gap-2 items-center py-2 px-3 rounded-lg bg-white/5 text-sm"
                          >
                            <span className="text-white/80 font-mono truncate text-xs" title={stat.mint}>
                              {shortenAddress(stat.mint)}
                            </span>
                            <span className="text-white text-right truncate">{formatCurrency(stat.totalInvested)}</span>
                            <span className={`text-right truncate ${stat.totalPnl >= 0 ? 'text-[#12d585]' : 'text-[#FF4757]'}`}>
                              {formatCurrency(stat.totalPnl)}
                            </span>
                            <span className={`text-right ${stat.roiPct === null ? 'text-white/50' : stat.roiPct >= 0 ? 'text-[#12d585]' : 'text-[#FF4757]'}`}>
                              {stat.roiPct === null ? '–' : `${stat.roiPct >= 0 ? '+' : ''}${stat.roiPct.toFixed(1)}%`}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="p-4 pt-0 space-y-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full min-h-[44px] touch-manipulation"
                        onClick={() => navigate(`/scanner/wallet/${wallet.address}`, { state: wallet })}
                      >
                        View wallet
                      </Button>
                      <Button
                        variant={isWatched(wallet.address) ? 'outline' : 'ghost'}
                        size="sm"
                        onClick={(e) => handleCopeWallet(e, wallet)}
                        disabled={copingWallets.has(wallet.address) || isWatched(wallet.address)}
                        className="w-full min-h-[44px] touch-manipulation"
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
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
