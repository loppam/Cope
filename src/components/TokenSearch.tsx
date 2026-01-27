import { useState, useEffect, useRef } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { searchTokens, TokenSearchResult } from '@/lib/solanatracker';
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

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    // Allow searching by name, symbol, or address (SolanaTracker supports all)
    if (query.trim().length < 1) {
      setResults([]);
      setShowResults(false);
      return;
    }

    setLoading(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const response = await searchTokens(query.trim(), 1, 20);
        if (response.status === 'success' && response.data) {
          setResults(response.data);
          setShowResults(true);
        } else {
          setResults([]);
        }
      } catch (error) {
        console.error('Error searching tokens:', error);
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300); // 300ms debounce

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
    <div ref={containerRef} className={`relative ${className}`}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-white/40" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => query.length >= 1 && results.length > 0 && setShowResults(true)}
          placeholder={placeholder}
          className="w-full h-12 pl-10 pr-10 rounded-[12px] bg-white/5 border border-white/10 text-white placeholder:text-white/40 focus:outline-none focus:border-[#12d585] transition-colors font-mono text-sm"
        />
        {query && (
          <button
            onClick={() => {
              setQuery('');
              setResults([]);
              setShowResults(false);
            }}
            className="absolute right-3 top-1/2 transform -translate-y-1/2 text-white/40 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        {loading && (
          <div className="absolute right-10 top-1/2 transform -translate-y-1/2">
            <Loader2 className="w-4 h-4 text-white/40 animate-spin" />
          </div>
        )}
      </div>

      {/* Search Results Dropdown */}
      {showResults && results.length > 0 && (
        <div className="absolute z-50 w-full mt-2 max-h-[500px] overflow-y-auto bg-[#0a0a0a] border border-white/10 rounded-[12px] shadow-xl">
          <div className="p-2">
            {results.map((token) => (
              <button
                key={token.id}
                onClick={() => handleSelect(token)}
                className="w-full p-3 rounded-lg hover:bg-white/5 transition-colors text-left group"
              >
                <div className="flex items-center gap-3">
                  {/* Token Image */}
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
                  
                  {/* Token Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-white group-hover:text-[#12d585] transition-colors">
                        {token.name}
                      </span>
                      <span className="text-white/60 text-sm">{token.symbol}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-white/50">
                      <span className="font-mono">{shortenAddress(token.mint)}</span>
                      {token.priceUsd && (
                        <span>{formatPrice(token.priceUsd)}</span>
                      )}
                      {token.marketCapUsd && (
                        <span>MCap: {formatCurrency(token.marketCapUsd)}</span>
                      )}
                    </div>
                  </div>

                  {/* Market Info */}
                  <div className="flex flex-col items-end gap-1 text-xs text-white/60">
                    {token.liquidityUsd && (
                      <span>Liq: {formatCurrency(token.liquidityUsd)}</span>
                    )}
                    {token.volume_24h !== undefined && token.volume_24h > 0 && (
                      <span>Vol 24h: {formatCurrency(token.volume_24h)}</span>
                    )}
                    {token.status && (
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
        <div className="absolute z-50 w-full mt-2 p-4 bg-[#0a0a0a] border border-white/10 rounded-[12px] shadow-xl text-center text-white/60 text-sm">
          No tokens found
        </div>
      )}
    </div>
  );
}
