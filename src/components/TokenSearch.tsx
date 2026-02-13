import { useState, useEffect, useRef } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { TokenSearchResult } from '@/lib/solanatracker';
import { searchTokensUnified } from '@/lib/birdeye-token';
import { shortenAddress } from '@/lib/utils';

interface TokenSearchProps {
  onSelect: (token: TokenSearchResult) => void;
  placeholder?: string;
  className?: string;
}

export function TokenSearch({ onSelect, placeholder = "Search token by name or symbol...", className = "" }: TokenSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TokenSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const searchTimeoutRef = useRef<NodeJS.Timeout>();
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced search via Birdeye (Solana, Base, BNB merged and sorted)
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (query.trim().length < 1) {
      setResults([]);
      setShowResults(false);
      return;
    }

    setLoading(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const list = await searchTokensUnified(query.trim(), 20);
        setResults(list);
        setShowResults(true);
      } catch (error) {
        console.error('Error searching tokens:', error);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query]);

  const handleSelect = (token: TokenSearchResult) => {
    onSelect(token);
    setQuery(''); // Clear the input
    setResults([]); // Clear results
    setShowResults(false); // Close dropdown
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

  return (
    <div ref={containerRef} className={`relative w-full min-w-0 ${className}`}>
      <div className="relative w-full min-w-0">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40 shrink-0 pointer-events-none" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.length >= 1 && results.length > 0 && setShowResults(true)}
          placeholder={placeholder}
          className="w-full min-w-0 h-12 pl-10 pr-11 rounded-[12px] bg-white/5 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:border-[#12d585] transition-colors font-mono text-sm truncate"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 shrink-0">
          {loading && <Loader2 className="w-5 h-5 text-white/40 animate-spin" />}
          {query && !loading && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setResults([]);
                setShowResults(false);
              }}
              className="p-1.5 -m-1.5 text-white/40 hover:text-white transition-colors touch-manipulation"
              aria-label="Clear search"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Search Results Dropdown */}
      {showResults && results.length > 0 && (
        <div className="absolute z-50 left-0 right-0 w-full mt-2 max-h-[min(70vh,500px)] overflow-y-auto bg-[#0a0a0a] border border-white/10 rounded-[12px] shadow-xl">
          <div className="p-2">
            {results.map((token) => (
              <button
                key={token.id}
                type="button"
                onClick={() => handleSelect(token)}
                className="w-full p-3 rounded-lg hover:bg-white/5 active:bg-white/5 transition-colors text-left group touch-manipulation"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3 min-w-0">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {token.image && (
                      <img
                        src={token.image}
                        alt={token.symbol}
                        className="w-10 h-10 rounded-full flex-shrink-0"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    )}
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mb-0.5">
                        <span className="font-semibold text-white group-hover:text-[#12d585] transition-colors truncate block">
                          {token.name}
                        </span>
                        <span className="text-white/60 text-sm shrink-0">{token.symbol}</span>
                        {token.chain && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/70 shrink-0 capitalize">
                            {token.chain}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0 text-xs text-white/50 overflow-hidden">
                        <span className="font-mono truncate">{shortenAddress(token.mint)}</span>
                        {token.priceUsd != null && token.priceUsd > 0 && (
                          <span className="truncate">{formatPrice(token.priceUsd)}</span>
                        )}
                        {token.marketCapUsd != null && token.marketCapUsd > 0 && (
                          <span className="truncate">MCap: {formatCurrency(token.marketCapUsd)}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/60 sm:shrink-0 sm:flex-col sm:items-end">
                    {token.liquidityUsd != null && token.liquidityUsd > 0 && (
                      <span>Liq: {formatCurrency(token.liquidityUsd)}</span>
                    )}
                    {token.volume_24h != null && token.volume_24h > 0 && (
                      <span>Vol 24h: {formatCurrency(token.volume_24h)}</span>
                    )}
                    {token.status != null && token.status !== '' && (
                      <span className={`px-2 py-0.5 rounded text-[10px] ${
                        token.status === 'graduated' ? 'bg-[#12d585]/20 text-[#12d585]' :
                        token.status === 'graduating' ? 'bg-yellow-500/20 text-yellow-500' :
                        'bg-white/10 text-white/60'
                      }`}>
                        {token.status}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* No Results */}
      {showResults && !loading && query.length >= 1 && results.length === 0 && (
        <div className="absolute z-50 left-0 right-0 w-full mt-2 p-4 bg-[#0a0a0a] border border-white/10 rounded-[12px] shadow-xl text-center text-white/60 text-sm">
          No tokens found
        </div>
      )}
    </div>
  );
}
