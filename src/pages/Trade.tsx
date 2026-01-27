import { useState, useEffect } from 'react';
import { useLocation } from 'react-router';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Card } from '@/components/Card';
import { TokenSearch } from '@/components/TokenSearch';
import { TokenSearchResult, searchTokens, getTokenInfo, convertTokenInfoToSearchResult } from '@/lib/solanatracker';
import { DollarSign, ExternalLink, Calendar, Users, TrendingUp, RefreshCw } from 'lucide-react';
import { shortenAddress } from '@/lib/utils';

export function Trade() {
  const location = useLocation();
  const [mint, setMint] = useState('');
  const [amount, setAmount] = useState('');
  const [token, setToken] = useState<TokenSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);
  const [refreshCooldown, setRefreshCooldown] = useState(0);

  const quickAmounts = [0.1, 0.5, 1];
  const REFRESH_COOLDOWN_MS = 15000; // 15 seconds

  // Check if mint address was passed from navigation (e.g., from Positions page)
  useEffect(() => {
    if (location.state?.mint) {
      const passedMint = location.state.mint as string;
      // Set mint and fetch immediately
      setMint(passedMint);
      fetchTokenDetails(passedMint);
      // Clear location state to prevent re-triggering on re-renders
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  // Fetch token details when mint is set via other means (e.g., TokenSearch component)
  useEffect(() => {
    if (mint && (!token || token.mint !== mint) && !location.state?.mint) {
      fetchTokenDetails(mint);
    }
  }, [mint, token]);

  // Refresh cooldown timer
  useEffect(() => {
    if (lastRefresh === null) return;

    const interval = setInterval(() => {
      const elapsed = Date.now() - lastRefresh;
      const remaining = Math.max(0, REFRESH_COOLDOWN_MS - elapsed);
      setRefreshCooldown(Math.ceil(remaining / 1000));

      if (remaining === 0) {
        clearInterval(interval);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [lastRefresh]);

  const fetchTokenDetails = async (mintAddress: string) => {
    setLoading(true);
    try {
      // Use getTokenInfo for complete token data (better than search)
      // This endpoint returns full token information with price, market cap, etc.
      const tokenInfo = await getTokenInfo(mintAddress);
      const tokenData = convertTokenInfoToSearchResult(tokenInfo);
      setToken(tokenData);
    } catch (error) {
      console.error('Error fetching token details:', error);
      // Fallback to search if getTokenInfo fails
      try {
        const response = await searchTokens(mintAddress, 1, 1);
        if (response.status === 'success' && response.data && response.data.length > 0) {
          setToken(response.data[0]);
        }
      } catch (searchError) {
        console.error('Error with search fallback:', searchError);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    if (refreshCooldown > 0 || !mint) return;
    
    setLastRefresh(Date.now());
    setRefreshCooldown(15);
    await fetchTokenDetails(mint);
  };

  const formatCurrency = (value: number | undefined) => {
    if (!value) return '$0';
    if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(2)}K`;
    return `$${value.toFixed(2)}`;
  };

  const formatPrice = (price: number | undefined) => {
    if (!price || price === 0) return '$0';
    if (price < 0.000001) return `$${price.toExponential(2)}`;
    return `$${price.toFixed(8)}`;
  };

  const getTokenAge = (createdAt?: number) => {
    if (!createdAt) return 'Unknown';
    const now = Date.now();
    const ageMs = now - createdAt;
    const days = Math.floor(ageMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((ageMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((ageMs % (1000 * 60 * 60)) / (1000 * 60));
    
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  return (
    <div className="p-6 max-w-[720px] mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-2">Trade Terminal</h1>
        <p className="text-white/60">Paste token CA to trade instantly</p>
      </div>

      <div className="space-y-6">
        {/* Token Input */}
        <div>
          <label className="block text-sm font-medium mb-2">Token</label>
          <TokenSearch
            onSelect={(selectedToken) => {
              setToken(selectedToken);
              setMint(selectedToken.mint);
            }}
            placeholder="Search by name, symbol, or paste mint address..."
          />
        </div>

        {loading && (
          <Card glass>
            <div className="p-6 text-center text-white/60">
              Loading token details...
            </div>
          </Card>
        )}

        {token && !loading && (
          <Card glass>
            {/* Token Header */}
            <div className="mb-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-start gap-4 flex-1">
                  {token.image && (
                    <img
                      src={token.image}
                      alt={token.symbol}
                      className="w-16 h-16 rounded-full flex-shrink-0 border-2 border-white/10"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-bold text-lg">{token.name}</h3>
                      <span className="text-white/60 text-sm">({token.symbol})</span>
                      {token.status && (
                        <span className={`px-2 py-0.5 rounded text-xs ${
                          token.status === 'graduated' ? 'bg-[#12d585]/20 text-[#12d585]' :
                          token.status === 'graduating' ? 'bg-yellow-500/20 text-yellow-500' :
                          'bg-white/10 text-white/60'
                        }`}>
                          {token.status}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-white/50 font-mono">
                      <span>{shortenAddress(token.mint)}</span>
                      {token.deployer && (
                        <>
                          <span>•</span>
                          <a
                            href={`https://solscan.io/account/${token.deployer}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-[#12d585] transition-colors flex items-center gap-1"
                          >
                            DEV <ExternalLink className="w-3 h-3" />
                          </a>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                {/* Refresh Button */}
                <button
                  onClick={handleRefresh}
                  disabled={refreshCooldown > 0 || loading}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    refreshCooldown > 0 || loading
                      ? 'bg-white/5 text-white/30 cursor-not-allowed'
                      : 'bg-white/10 hover:bg-white/15 text-white'
                  }`}
                  title={refreshCooldown > 0 ? `Refresh available in ${refreshCooldown}s` : 'Refresh token data'}
                >
                  <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                  {refreshCooldown > 0 ? `${refreshCooldown}s` : 'Refresh'}
                </button>
              </div>

              {/* Token Stats Grid */}
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-white/5 rounded-lg p-3">
                  <div className="text-xs text-white/60 mb-1">Price</div>
                  <div className="text-lg font-semibold">{formatPrice(token.priceUsd)}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <div className="text-xs text-white/60 mb-1">Market Cap</div>
                  <div className="text-lg font-semibold">{formatCurrency(token.marketCapUsd)}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <div className="text-xs text-white/60 mb-1">Liquidity</div>
                  <div className="text-lg font-semibold">{formatCurrency(token.liquidityUsd)}</div>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <div className="text-xs text-white/60 mb-1">Holders</div>
                  <div className="text-lg font-semibold flex items-center gap-1">
                    <Users className="w-4 h-4" />
                    {token.holders || 0}
                  </div>
                </div>
              </div>

              {/* Additional Info */}
              <div className="space-y-2 mb-4">
                <div className="flex flex-wrap gap-4 text-xs text-white/60">
                  {token.createdAt && (
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      <span>Age: {getTokenAge(token.createdAt)}</span>
                    </div>
                  )}
                  {token.launchpad?.curvePercentage !== undefined && (
                    <div className="flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" />
                      <span>Bonding Curve: {token.launchpad.curvePercentage.toFixed(2)}%</span>
                    </div>
                  )}
                  {token.market && (
                    <div className="flex items-center gap-1">
                      <span>Market: {token.market}</span>
                    </div>
                  )}
                  {token.volume_24h !== undefined && token.volume_24h > 0 && (
                    <div className="flex items-center gap-1">
                      <span>Vol 24h: {formatCurrency(token.volume_24h)}</span>
                    </div>
                  )}
                </div>
                
                {/* Trading Stats */}
                {(token.buys !== undefined || token.sells !== undefined || token.totalTransactions !== undefined) && (
                  <div className="flex flex-wrap gap-4 text-xs text-white/60 pt-2 border-t border-white/5">
                    {token.buys !== undefined && (
                      <span>🟢 Buys: {token.buys}</span>
                    )}
                    {token.sells !== undefined && (
                      <span>🔴 Sells: {token.sells}</span>
                    )}
                    {token.totalTransactions !== undefined && (
                      <span>📊 Total: {token.totalTransactions}</span>
                    )}
                  </div>
                )}

                {/* Risk & Distribution Info */}
                {(token.riskScore !== undefined || token.top10 !== undefined || token.dev !== undefined) && (
                  <div className="flex flex-wrap gap-4 text-xs text-white/60 pt-2 border-t border-white/5">
                    {token.riskScore !== undefined && (
                      <span>⚠️ Risk: {token.riskScore}/10</span>
                    )}
                    {token.top10 !== undefined && (
                      <span>👥 Top 10: {token.top10.toFixed(2)}%</span>
                    )}
                    {token.dev !== undefined && (
                      <span>👤 Dev: {token.dev.toFixed(2)}%</span>
                    )}
                    {token.bundlers?.percentage !== undefined && (
                      <span>📦 Bundlers: {token.bundlers.percentage.toFixed(2)}%</span>
                    )}
                  </div>
                )}
              </div>

              {/* Social Links */}
              <div className="flex flex-wrap gap-2 mb-4">
                <a
                  href={`https://solscan.io/token/${token.mint}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs flex items-center gap-1 transition-colors"
                >
                  <span>🔍</span> Solscan
                  <ExternalLink className="w-3 h-3" />
                </a>
                {token.socials?.twitter && (
                  <a
                    href={token.socials.twitter}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs flex items-center gap-1 transition-colors"
                  >
                    <span>🐦</span> Twitter
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {token.socials?.website && (
                  <a
                    href={token.socials.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs flex items-center gap-1 transition-colors"
                  >
                    <span>🌐</span> Website
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {token.market === 'pumpfun' && (
                  <a
                    href={`https://pump.fun/${token.mint}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs flex items-center gap-1 transition-colors"
                  >
                    <span>🏆</span> PumpFun
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </div>

            {/* Buy Section */}
            <div className="mb-6">
              <label className="block text-sm font-medium mb-2">Buy Amount (SOL)</label>
              <Input
                type="number"
                placeholder="0.0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <div className="flex gap-2 mt-2">
                {quickAmounts.map((amt) => (
                  <button
                    key={amt}
                    onClick={() => setAmount(amt.toString())}
                    className="flex-1 h-8 rounded-[10px] bg-white/5 hover:bg-white/10 text-sm transition-colors"
                  >
                    {amt} SOL
                  </button>
                ))}
              </div>
            </div>

            <Button className="w-full h-12 mb-3">
              <DollarSign className="w-5 h-5" />
              Buy
            </Button>

            {/* Sell Section */}
            <div className="pt-4 border-t border-white/6">
              <p className="text-sm text-white/60 mb-2">Your Position: 0 {token.symbol}</p>
              <div className="flex gap-2">
                {[25, 50, 75].map((pct) => (
                  <button
                    key={pct}
                    disabled
                    className="flex-1 h-8 rounded-[10px] bg-white/5 text-sm text-white/30"
                  >
                    {pct}%
                  </button>
                ))}
              </div>
              <Button variant="outline" className="w-full h-10 mt-2" disabled>
                Sell All
              </Button>
            </div>
          </Card>
        )}

        {!mint && (
          <div className="text-center py-16">
            <DollarSign className="w-12 h-12 mx-auto mb-4 text-white/30" />
            <p className="text-white/60">Paste a token address to start trading</p>
          </div>
        )}
      </div>
    </div>
  );
}
