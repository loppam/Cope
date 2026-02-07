import { useState, useEffect } from "react";
import { useLocation, useSearchParams } from "react-router";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Card } from "@/components/Card";
import { TokenSearch } from "@/components/TokenSearch";
import {
  TokenSearchResult,
  searchTokens,
  getTokenInfo,
  convertTokenInfoToSearchResult,
  getWalletPositions,
} from "@/lib/solanatracker";
import {
  getSwapQuote,
  executeSwap,
  type SwapQuote,
  formatTokenAmount,
  getPriceImpactColor,
  formatPriceImpact,
} from "@/lib/jupiter-swap";
import { getSolBalance } from "@/lib/rpc";
import { useAuth } from "@/contexts/AuthContext";
import {
  DollarSign,
  ExternalLink,
  Calendar,
  Users,
  TrendingUp,
  RefreshCw,
  Copy,
  ArrowDownUp,
  Loader2,
  Settings,
} from "lucide-react";
import { shortenAddress } from "@/lib/utils";
import { toast } from "sonner";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";

const SOL_MINT = "So11111111111111111111111111111111111111112";

export function Trade() {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, userProfile, updateBalance } = useAuth();
  const [mint, setMint] = useState("");
  const [amount, setAmount] = useState("");
  const [token, setToken] = useState<TokenSearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<number | null>(null);
  const [refreshCooldown, setRefreshCooldown] = useState(0);

  // Swap state
  const [swapping, setSwapping] = useState(false);
  const [swapQuote, setSwapQuote] = useState<SwapQuote | null>(null);
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [swapDirection, setSwapDirection] = useState<"buy" | "sell">("buy");
  const [slippage, setSlippage] = useState(100); // 1% in basis points
  const [showSlippageSettings, setShowSlippageSettings] = useState(false);

  // Sell state: user's token balance (UI units) and sell amount (UI units)
  const [tokenBalance, setTokenBalance] = useState<number>(0);
  const [sellAmount, setSellAmount] = useState("");
  const [loadingBalance, setLoadingBalance] = useState(false);

  const quickAmounts = [0.1, 0.5, 1];
  const slippagePresets = [50, 100, 200]; // 0.5%, 1%, 2%
  const REFRESH_COOLDOWN_MS = 15000; // 15 seconds

  // Check if mint was passed from navigation state (e.g., from Positions page or feed)
  useEffect(() => {
    if (location.state?.mint) {
      const passedMint = (location.state.mint as string).trim();
      setMint(passedMint);
      window.history.replaceState({}, document.title);
      setSearchParams({ mint: passedMint }, { replace: true });
    }
  }, [location.state, setSearchParams]);

  // Read mint from URL (e.g. /app/trade?mint=...) so links are shareable
  useEffect(() => {
    if (location.state?.mint) return;
    const urlMint = searchParams.get("mint")?.trim();
    if (urlMint) setMint(urlMint);
  }, [searchParams, location.state?.mint]);

  // Fetch token details when mint is set (from URL, TokenSearch, or state)
  useEffect(() => {
    if (mint && (!token || token.mint !== mint)) {
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

  // Fetch user's token balance for the selected token (for Sell section)
  useEffect(() => {
    if (!token?.mint || !userProfile?.walletAddress) {
      setTokenBalance(0);
      setSellAmount("");
      return;
    }
    const fetchBalance = async () => {
      setLoadingBalance(true);
      try {
        const positions = await getWalletPositions(
          userProfile.walletAddress,
          true,
        );
        const position = positions.tokens.find(
          (t) => t.token.mint === token.mint,
        );
        const balance = position?.balance ?? 0;
        setTokenBalance(balance);
        setSellAmount("");
      } catch (err) {
        console.warn("Failed to fetch token balance:", err);
        setTokenBalance(0);
      } finally {
        setLoadingBalance(false);
      }
    };
    fetchBalance();
  }, [token?.mint, userProfile?.walletAddress]);

  const fetchTokenDetails = async (mintAddress: string) => {
    setLoading(true);
    try {
      // Use getTokenInfo for complete token data (better than search)
      // This endpoint returns full token information with price, market cap, etc.
      const tokenInfo = await getTokenInfo(mintAddress);
      const tokenData = convertTokenInfoToSearchResult(tokenInfo);
      setToken(tokenData);
    } catch (error) {
      console.error("Error fetching token details:", error);
      // Fallback to search if getTokenInfo fails
      try {
        const response = await searchTokens(mintAddress, 1, 1);
        if (
          response.status === "success" &&
          response.data &&
          response.data.length > 0
        ) {
          setToken(response.data[0]);
        }
      } catch (searchError) {
        console.error("Error with search fallback:", searchError);
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

  const handleCopyShareLink = async () => {
    if (!mint) return;
    const url = `${window.location.origin}${window.location.pathname}?mint=${encodeURIComponent(mint)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied", {
        description: "Share this link to open this token in Trade",
      });
    } catch {
      toast.error("Could not copy link");
    }
  };

  const formatCurrency = (value: number | undefined) => {
    if (!value) return "$0";
    if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(2)}K`;
    return `$${value.toFixed(2)}`;
  };

  const formatPrice = (price: number | undefined) => {
    if (!price || price === 0) return "$0";
    if (price < 0.000001) return `$${price.toExponential(2)}`;
    return `$${price.toFixed(8)}`;
  };

  const getTokenAge = (createdAt?: number) => {
    if (!createdAt) return "Unknown";
    const now = Date.now();
    const ageMs = now - createdAt;
    const days = Math.floor(ageMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor(
      (ageMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
    );
    const minutes = Math.floor((ageMs % (1000 * 60 * 60)) / (1000 * 60));

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  const handleBuy = async () => {
    if (!amount || !token || !userProfile?.walletAddress || !user) {
      toast.error("Missing required information", {
        description: "Please connect your wallet and enter an amount",
      });
      return;
    }

    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error("Invalid amount", {
        description: "Please enter a valid amount",
      });
      return;
    }

    setSwapping(true);
    try {
      // Get quote
      const quote = await getSwapQuote(
        SOL_MINT,
        token.mint,
        Math.floor(amountNum * LAMPORTS_PER_SOL),
        userProfile.walletAddress,
        slippage,
        9, // SOL decimals
        token.decimals,
      );

      setSwapQuote(quote);
      setSwapDirection("buy");
      setShowQuoteModal(true);
    } catch (error: any) {
      console.error("Error getting swap quote:", error);
      toast.error("Failed to get quote", {
        description: error.message || "Please try again",
      });
    } finally {
      setSwapping(false);
    }
  };

  const handleSell = async () => {
    if (!sellAmount || !token || !userProfile?.walletAddress || !user) {
      toast.error("Missing required information", {
        description: "Please enter an amount to sell",
      });
      return;
    }

    const amountNum = parseFloat(sellAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      toast.error("Invalid amount", {
        description: "Please enter a valid amount",
      });
      return;
    }
    if (amountNum > tokenBalance) {
      toast.error("Insufficient balance", {
        description: `You have ${tokenBalance.toFixed(4)} ${token.symbol}`,
      });
      return;
    }

    setSwapping(true);
    try {
      const amountRaw = Math.floor(amountNum * Math.pow(10, token.decimals));
      const quote = await getSwapQuote(
        token.mint,
        SOL_MINT,
        amountRaw,
        userProfile.walletAddress,
        slippage,
        token.decimals, // token decimals
        9, // SOL decimals
      );

      setSwapQuote(quote);
      setSwapDirection("sell");
      setShowQuoteModal(true);
    } catch (error: any) {
      console.error("Error getting sell quote:", error);
      toast.error("Failed to get quote", {
        description: error.message || "Please try again",
      });
    } finally {
      setSwapping(false);
    }
  };

  const handleConfirmSwap = async () => {
    if (!swapQuote || !user) return;

    setSwapping(true);
    setShowQuoteModal(false);

    try {
      const result = await executeSwap(swapQuote, user.uid);

      if (result.status === "Success") {
        toast.success("Swap successful!", {
          description: "Your transaction has been confirmed",
          action: {
            label: "View",
            onClick: () =>
              window.open(
                `https://solscan.io/tx/${result.signature}`,
                "_blank",
              ),
          },
        });

        // Refresh balance
        if (userProfile?.walletAddress) {
          const newBalance = await getSolBalance(userProfile.walletAddress);
          await updateBalance(newBalance);
          // If sell, refresh token balance for this token
          if (swapDirection === "sell" && token?.mint) {
            try {
              const positions = await getWalletPositions(
                userProfile.walletAddress,
                false,
              );
              const position = positions.tokens.find(
                (t) => t.token.mint === token.mint,
              );
              setTokenBalance(position?.balance ?? 0);
            } catch {
              // ignore
            }
          }
        }

        // Clear amounts and quote
        setAmount("");
        setSellAmount("");
        setSwapQuote(null);
      } else {
        throw new Error(result.error || "Swap failed");
      }
    } catch (error: any) {
      console.error("Error executing swap:", error);
      toast.error("Swap failed", {
        description: error.message || "Please try again",
      });
    } finally {
      setSwapping(false);
    }
  };

  return (
    <div className="p-3 sm:p-6 max-w-[720px] mx-auto min-w-0">
      <div className="mb-6 sm:mb-8">
        <h1 className="text-xl sm:text-2xl font-bold mb-2">Trade Terminal</h1>
        <p className="text-sm text-white/60">
          Paste token CA to trade instantly
        </p>
      </div>

      <div className="space-y-6">
        {/* Copy Trade Banner */}
        {location.state?.fromFeed && location.state?.walletNickname && (
          <Card className="bg-accent-primary/10 border-accent-primary/20">
            <div className="flex items-center gap-3">
              <Copy className="w-5 h-5 text-accent-primary" />
              <div className="flex-1">
                <p className="text-sm font-medium text-white">
                  Copying trade from {location.state.walletNickname}
                </p>
                <p className="text-xs text-white/70 mt-0.5">
                  Token pre-filled from feed
                </p>
              </div>
            </div>
          </Card>
        )}

        {/* Token Input - no overflow-hidden so dropdown can show below */}
        <div className="min-w-0">
          <label className="block text-sm font-medium mb-2">Token</label>
          <TokenSearch
            onSelect={(selectedToken) => {
              setToken(selectedToken);
              setMint(selectedToken.mint);
              setSearchParams({ mint: selectedToken.mint }, { replace: true });
            }}
            placeholder="Search or paste token address..."
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
            <div className="mb-4 sm:mb-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
                <div className="flex items-start gap-3 sm:gap-4 flex-1 min-w-0">
                  {token.image && (
                    <img
                      src={token.image}
                      alt={token.symbol}
                      className="w-12 h-12 sm:w-16 sm:h-16 rounded-full flex-shrink-0 border-2 border-white/10"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  )}
                  <div className="flex-1 min-w-0 overflow-hidden">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h3 className="font-bold text-base sm:text-lg truncate">
                        {token.name}
                      </h3>
                      <span className="text-white/60 text-sm shrink-0">
                        ({token.symbol})
                      </span>
                      {token.status && (
                        <span
                          className={`px-2 py-0.5 rounded text-xs shrink-0 ${
                            token.status === "graduated"
                              ? "bg-[#12d585]/20 text-[#12d585]"
                              : token.status === "graduating"
                                ? "bg-yellow-500/20 text-yellow-500"
                                : "bg-white/10 text-white/60"
                          }`}
                        >
                          {token.status}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-white/50 font-mono truncate">
                      <span>{shortenAddress(token.mint)}</span>
                      {token.deployer && (
                        <>
                          <span>•</span>
                          <a
                            href={`https://solscan.io/account/${token.deployer}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-[#12d585] transition-colors flex items-center gap-1 shrink-0"
                          >
                            DEV <ExternalLink className="w-3 h-3" />
                          </a>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleCopyShareLink}
                    className="flex items-center justify-center gap-2 px-3 py-2 sm:px-4 rounded-lg text-sm font-medium bg-white/10 hover:bg-white/15 text-white transition-all touch-manipulation min-h-[44px] sm:min-h-0"
                    title="Copy share link"
                  >
                    <Copy className="w-4 h-4" />
                    <span className="hidden sm:inline">Copy link</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleRefresh}
                    disabled={refreshCooldown > 0 || loading}
                    className={`flex items-center justify-center gap-2 px-3 py-2 sm:px-4 rounded-lg text-sm font-medium transition-all shrink-0 min-h-[44px] sm:min-h-0 ${
                      refreshCooldown > 0 || loading
                        ? "bg-white/5 text-white/30 cursor-not-allowed"
                        : "bg-white/10 hover:bg-white/15 text-white"
                    }`}
                    title={
                      refreshCooldown > 0
                        ? `Refresh available in ${refreshCooldown}s`
                        : "Refresh token data"
                    }
                  >
                    <RefreshCw
                      className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
                    />
                    {refreshCooldown > 0 ? `${refreshCooldown}s` : "Refresh"}
                  </button>
                </div>
              </div>

              {/* Token Stats Grid */}
              <div className="grid grid-cols-2 gap-2 sm:gap-3 mb-4">
                <div className="bg-white/5 rounded-lg p-2 sm:p-3">
                  <div className="text-xs text-white/60 mb-1">Price</div>
                  <div className="text-sm sm:text-lg font-semibold truncate">
                    {formatPrice(token.priceUsd)}
                  </div>
                </div>
                <div className="bg-white/5 rounded-lg p-2 sm:p-3">
                  <div className="text-xs text-white/60 mb-1">Market Cap</div>
                  <div className="text-sm sm:text-lg font-semibold truncate">
                    {formatCurrency(token.marketCapUsd)}
                  </div>
                </div>
                <div className="bg-white/5 rounded-lg p-2 sm:p-3">
                  <div className="text-xs text-white/60 mb-1">Liquidity</div>
                  <div className="text-sm sm:text-lg font-semibold truncate">
                    {formatCurrency(token.liquidityUsd)}
                  </div>
                </div>
                <div className="bg-white/5 rounded-lg p-2 sm:p-3">
                  <div className="text-xs text-white/60 mb-1">Holders</div>
                  <div className="text-sm sm:text-lg font-semibold flex items-center gap-1 truncate">
                    <Users className="w-4 h-4 shrink-0" />
                    {token.holders ?? 0}
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
                      <span>
                        Bonding Curve:{" "}
                        {token.launchpad.curvePercentage.toFixed(2)}%
                      </span>
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
                {(token.buys !== undefined ||
                  token.sells !== undefined ||
                  token.totalTransactions !== undefined) && (
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
                {(token.riskScore !== undefined ||
                  token.top10 !== undefined ||
                  token.dev !== undefined) && (
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
                      <span>
                        📦 Bundlers: {token.bundlers.percentage.toFixed(2)}%
                      </span>
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
                {token.market === "pumpfun" && (
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
            <div className="mb-4 sm:mb-6">
              <label className="block text-sm font-medium mb-2">
                Buy Amount (SOL)
              </label>
              <Input
                type="number"
                placeholder="0.0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="min-w-0"
              />
              <div className="flex gap-2 mt-2 flex-wrap">
                {quickAmounts.map((amt) => (
                  <button
                    key={amt}
                    onClick={() => setAmount(amt.toString())}
                    className="flex-1 min-w-[4rem] h-9 sm:h-8 rounded-[10px] bg-white/5 hover:bg-white/10 text-sm transition-colors"
                  >
                    {amt} SOL
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2 mb-3">
              <Button
                className="flex-1 h-11 sm:h-12 min-w-0"
                onClick={handleBuy}
                disabled={swapping || !amount || !userProfile?.walletAddress}
              >
                {swapping ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Getting Quote...
                  </>
                ) : (
                  <>
                    <DollarSign className="w-5 h-5" />
                    Buy
                  </>
                )}
              </Button>
              <button
                onClick={() => setShowSlippageSettings(!showSlippageSettings)}
                className="h-11 sm:h-12 px-3 sm:px-4 rounded-[10px] bg-white/5 hover:bg-white/10 transition-colors shrink-0"
                title="Slippage settings"
              >
                <Settings className="w-5 h-5" />
              </button>
            </div>

            {/* Slippage Settings */}
            {showSlippageSettings && (
              <div className="mb-3 p-3 bg-white/5 rounded-[10px]">
                <div className="text-sm font-medium mb-2">
                  Slippage Tolerance
                </div>
                <div className="flex gap-2 mb-2">
                  {slippagePresets.map((preset) => (
                    <button
                      key={preset}
                      onClick={() => setSlippage(preset)}
                      className={`flex-1 h-8 rounded-[10px] text-sm transition-colors ${
                        slippage === preset
                          ? "bg-accent-primary text-white"
                          : "bg-white/5 hover:bg-white/10"
                      }`}
                    >
                      {preset / 100}%
                    </button>
                  ))}
                </div>
                <Input
                  type="number"
                  placeholder="Custom %"
                  value={slippage / 100}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (!isNaN(val) && val > 0) {
                      setSlippage(Math.floor(val * 100));
                    }
                  }}
                  className="h-8 text-sm"
                />
              </div>
            )}

            {/* Sell Section */}
            <div className="pt-4 border-t border-white/6">
              <p className="text-sm text-white/60 mb-2 truncate">
                Your Position:{" "}
                {loadingBalance
                  ? "..."
                  : `${tokenBalance.toLocaleString(undefined, {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 6,
                    })} ${token.symbol}`}
              </p>
              <label className="block text-sm font-medium mb-2">
                Sell Amount ({token.symbol})
              </label>
              <Input
                type="number"
                placeholder="0.0"
                value={sellAmount}
                onChange={(e) => setSellAmount(e.target.value)}
                disabled={tokenBalance <= 0}
                className="min-w-0"
              />
              <div className="flex gap-2 mt-2 flex-wrap">
                {[25, 50, 75].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() =>
                      setSellAmount(((tokenBalance * pct) / 100).toString())
                    }
                    disabled={tokenBalance <= 0}
                    className="flex-1 min-w-[3rem] h-9 sm:h-8 rounded-[10px] bg-white/5 hover:bg-white/10 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {pct}%
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setSellAmount(tokenBalance.toString())}
                  disabled={tokenBalance <= 0}
                  className="flex-1 min-w-[3rem] h-9 sm:h-8 rounded-[10px] bg-white/5 hover:bg-white/10 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  100%
                </button>
              </div>
              <Button
                variant="outline"
                className="w-full h-10 mt-3 min-w-0"
                onClick={handleSell}
                disabled={
                  swapping ||
                  !sellAmount ||
                  tokenBalance <= 0 ||
                  !userProfile?.walletAddress
                }
              >
                {swapping ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Getting Quote...
                  </>
                ) : (
                  "Sell"
                )}
              </Button>
            </div>
          </Card>
        )}

        {!mint && (
          <div className="text-center py-16">
            <DollarSign className="w-12 h-12 mx-auto mb-4 text-white/30" />
            <p className="text-white/60">
              Paste a token address to start trading
            </p>
          </div>
        )}
      </div>

      {/* Quote Preview Modal */}
      {showQuoteModal && swapQuote && token && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-3 sm:p-4 z-50 overflow-y-auto">
          <Card className="max-w-md w-full my-4 max-h-[90vh] overflow-y-auto">
            <div className="mb-3 sm:mb-4">
              <h3 className="text-lg sm:text-xl font-bold mb-2">
                Confirm Swap
              </h3>
              <p className="text-xs sm:text-sm text-white/60">
                Review your transaction details
              </p>
            </div>

            {/* Swap Details */}
            <div className="space-y-3 mb-4 sm:mb-6">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between p-2 sm:p-3 bg-white/5 rounded-[10px] min-w-0">
                <div className="min-w-0">
                  <div className="text-xs sm:text-sm text-white/60">
                    You Pay
                  </div>
                  <div className="font-bold text-sm sm:text-base truncate">
                    {swapDirection === "buy"
                      ? `${swapQuote.inputAmountUi.toFixed(4)} SOL`
                      : `${formatTokenAmount(swapQuote.inputAmount, token.decimals)} ${token.symbol}`}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs sm:text-sm text-white/60">
                    {swapQuote.inUsdValue != null
                      ? `~$${swapQuote.inUsdValue.toFixed(2)}`
                      : swapDirection === "buy"
                        ? `~$${(swapQuote.inputAmountUi * 150).toFixed(2)}`
                        : `~$${((swapQuote.inputAmount / Math.pow(10, token.decimals)) * (token.priceUsd || 0)).toFixed(2)}`}
                  </div>
                </div>
              </div>

              <div className="flex justify-center">
                <ArrowDownUp className="w-5 h-5 text-white/40 shrink-0" />
              </div>

              <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between p-2 sm:p-3 bg-white/5 rounded-[10px] min-w-0">
                <div className="min-w-0">
                  <div className="text-xs sm:text-sm text-white/60">
                    You Receive
                  </div>
                  <div className="font-bold text-sm sm:text-base truncate">
                    {swapDirection === "buy"
                      ? `${formatTokenAmount(swapQuote.outputAmount, token.decimals)} ${token.symbol}`
                      : `${swapQuote.outputAmountUi.toFixed(4)} SOL`}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs sm:text-sm text-white/60">
                    {swapQuote.outUsdValue != null
                      ? `~$${swapQuote.outUsdValue.toFixed(2)}`
                      : swapDirection === "buy"
                        ? `~$${((swapQuote.outputAmount / Math.pow(10, token.decimals)) * (token.priceUsd || 0)).toFixed(2)}`
                        : `~$${(swapQuote.outputAmountUi * 150).toFixed(2)}`}
                  </div>
                </div>
              </div>

              {/* Transaction Details */}
              <div className="p-2 sm:p-3 bg-white/5 rounded-[10px] space-y-2 text-xs sm:text-sm">
                <div className="flex justify-between">
                  <span className="text-white/60">Price Impact</span>
                  <span className={getPriceImpactColor(swapQuote.priceImpact)}>
                    {formatPriceImpact(swapQuote.priceImpact)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60">Slippage Tolerance</span>
                  <span>{slippage / 100}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60">Network Fee</span>
                  <span>~0.000005 SOL</span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2 sm:gap-3">
              <Button
                variant="outline"
                className="flex-1 min-w-0 h-10 sm:h-11"
                onClick={() => {
                  setShowQuoteModal(false);
                  setSwapQuote(null);
                }}
                disabled={swapping}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 min-w-0 h-10 sm:h-11"
                onClick={handleConfirmSwap}
                disabled={swapping}
              >
                {swapping ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Swapping...
                  </>
                ) : (
                  `Confirm ${swapDirection === "buy" ? "Buy" : "Sell"}`
                )}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
