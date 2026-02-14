import { useState, useEffect, useRef } from "react";
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
} from "@/lib/solanatracker";
import {
  fetchBirdeyeTokenOverview,
  birdeyeOverviewToTokenFields,
  getWalletTokenBalance,
} from "@/lib/birdeye-token";
import {
  isEvmAddress,
  fetchMoralisTokenOverview,
  moralisOverviewToTokenFields,
} from "@/lib/moralis-token";
import type { SwapQuote } from "@/lib/jupiter-swap";
import {
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
import { shortenAddress, getApiBase, toRawAmountString } from "@/lib/utils";
import { getChainId } from "@/lib/relay";
import { SOLANA_USDC_MINT, SOL_MINT } from "@/lib/constants";
import { toast } from "sonner";
import { DocumentHead } from "@/components/DocumentHead";

type TradeChain = "solana" | "base" | "bnb";

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
  const [relayQuote, setRelayQuote] = useState<unknown>(null);
  const [showQuoteModal, setShowQuoteModal] = useState(false);
  const [swapDirection, setSwapDirection] = useState<"buy" | "sell">("buy");
  const [slippage, setSlippage] = useState(100); // 1% in basis points
  const [showSlippageSettings, setShowSlippageSettings] = useState(false);
  const [tradeChain, setTradeChain] = useState<TradeChain>("solana");
  const [crossChainToken, setCrossChainToken] = useState<{
    symbol: string;
    address: string;
    name: string;
  } | null>(null);
  const [evmAddress, setEvmAddress] = useState<string | null>(null);

  // Sell state: user's token balance (UI units) and sell amount (UI units)
  const [tokenBalance, setTokenBalance] = useState<number>(0);
  const [sellAmount, setSellAmount] = useState("");
  const [loadingBalance, setLoadingBalance] = useState(false);
  // USDC balance (UI units) for Buy section display
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);

  const quickAmounts = [10, 50, 100];
  const slippagePresets = [50, 100, 200]; // 0.5%, 1%, 2%
  const REFRESH_COOLDOWN_MS = 15000; // 15 seconds
  const SOL_RESERVE = 0.005; // Always leave at least this much SOL for gas
  const BASE_ETH_RESERVE = 0.0005; // Reserve for Base gas
  const BNB_RESERVE = 0.001; // Reserve for BNB gas
  const sellableBalance =
    token?.mint === SOL_MINT
      ? Math.max(0, tokenBalance - SOL_RESERVE)
      : token?.mint === "base-eth"
        ? Math.max(0, tokenBalance - BASE_ETH_RESERVE)
        : token?.mint === "bnb-bnb"
          ? Math.max(0, tokenBalance - BNB_RESERVE)
          : tokenBalance;
  const fetchDetailsMintRef = useRef<string | null>(null);

  // Check if mint + chain were passed from navigation state (e.g., from Positions page)
  useEffect(() => {
    if (location.state?.mint) {
      const passedMint = (location.state.mint as string).trim();
      const passedChain = (location.state?.chain as string)?.toLowerCase();
      setMint(passedMint);
      if (passedChain === "base" || passedChain === "bnb") {
        setTradeChain(passedChain as TradeChain);
      }
      window.history.replaceState({}, document.title);
      const params: Record<string, string> = { mint: passedMint };
      if (passedChain) params.chain = passedChain;
      setSearchParams(params, { replace: true });
    }
  }, [location.state, setSearchParams]);

  // Read mint + chain from URL (e.g. /app/trade?mint=...&chain=base) so links are shareable
  useEffect(() => {
    if (location.state?.mint) return;
    const urlMint = searchParams.get("mint")?.trim();
    const urlChain = searchParams.get("chain")?.toLowerCase();
    if (urlMint) setMint(urlMint);
    if (urlChain === "base" || urlChain === "bnb") {
      setTradeChain(urlChain as TradeChain);
    }
  }, [searchParams, location.state?.mint]);

  // Resolve effective chain (prefer URL over state to avoid race when landing from Profile/Positions)
  const urlChain = searchParams.get("chain")?.toLowerCase();
  const evmChain =
    urlChain === "base" || urlChain === "bnb"
      ? urlChain
      : tradeChain === "base" || tradeChain === "bnb"
        ? tradeChain
        : null;
  const isEvmMint =
    /^0x[a-fA-F0-9]{40}$/.test(mint?.trim() ?? "") ||
    mint === "base-eth" ||
    mint === "bnb-bnb" ||
    mint === "base-usdc" ||
    mint === "bnb-usdc";
  const effectiveChain: TradeChain =
    mint && isEvmMint && evmChain
      ? (evmChain as TradeChain)
      : mint
        ? "solana"
        : tradeChain;

  // Auto-detect EVM chain when user pastes 0x address without chain (parallel probe via token-search)
  useEffect(() => {
    if (!mint?.trim() || !isEvmMint || (tradeChain === "base" || tradeChain === "bnb")) return;
    let cancelled = false;
    (async () => {
      try {
        const base = getApiBase();
        const res = await fetch(
          `${base}/api/token-search?term=${encodeURIComponent(mint.trim())}&limit=1`,
        );
        const json = await res.json().catch(() => ({}));
        const tokens = Array.isArray(json?.tokens) ? json.tokens : [];
        const first = tokens[0];
        const ch = first?.chain === "bsc" ? "bnb" : first?.chain;
        if (!cancelled && (ch === "base" || ch === "bnb")) {
          setTradeChain(ch as TradeChain);
          setSearchParams(
            (p) => {
              const next = new URLSearchParams(p);
              next.set("chain", ch);
              return next;
            },
            { replace: true },
          );
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mint, isEvmMint, tradeChain, setSearchParams]);

  // Fetch token details when we have a selected token (Solana: mint; Base/BNB: mint + chain or crossChainToken)
  // Skip when EVM mint but chain unknown (effectiveChain=solana) - wait for auto-detect to set chain
  useEffect(() => {
    if (mint) {
      if (isEvmMint && effectiveChain === "solana") return; // wait for chain resolution
      fetchTokenDetails(mint, effectiveChain, token);
    } else if (
      crossChainToken &&
      (tradeChain === "base" || tradeChain === "bnb")
    ) {
      fetchTokenDetails(crossChainToken.address, tradeChain, token);
    }
  }, [mint, effectiveChain, crossChainToken, tradeChain]);

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

  // EVM address for Base/BNB (from profile when backfilled, else from API)
  useEffect(() => {
    if (tradeChain === "solana" || !user) {
      setEvmAddress(null);
      return;
    }
    if (userProfile?.evmAddress) {
      setEvmAddress(userProfile.evmAddress);
      return;
    }
    let cancelled = false;
    user
      .getIdToken()
      .then((token) => {
        const base = getApiBase();
        return fetch(`${base}/api/relay/evm-address`, {
          headers: { Authorization: `Bearer ${token}` },
        });
      })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled && data.evmAddress) setEvmAddress(data.evmAddress);
        else if (!cancelled) setEvmAddress(null);
      })
      .catch(() => {
        if (!cancelled) setEvmAddress(null);
      });
    return () => {
      cancelled = true;
    };
  }, [tradeChain, user, userProfile?.evmAddress]);

  // Fetch user's token balance (Sell section) + USDC balance (Buy section)
  // Solana: Birdeye wallet token-balance. EVM: relay evm-balances.
  const isEvmToken = token?.chain === "base" || token?.chain === "bnb";
  useEffect(() => {
    if (!userProfile?.walletAddress) {
      setTokenBalance(0);
      setUsdcBalance(null);
      setSellAmount("");
      return;
    }
    let cancelled = false;
    const fetchBalances = async () => {
      setLoadingBalance(true);
      try {
        if (isEvmToken && user && token?.mint) {
          const tokenId = await user.getIdToken();
          const base = getApiBase();
          const res = await fetch(`${base}/api/relay/evm-balances`, {
            headers: { Authorization: `Bearer ${tokenId}` },
          });
          const data = await res.json();
          if (res.ok && data.tokens) {
            const match = (data.tokens as Array<{ mint: string; amount: number }>).find(
              (t) => t.mint === token.mint
            );
            setTokenBalance(match?.amount ?? 0);
          } else {
            setTokenBalance(0);
          }
          const usdcBalances = await getWalletTokenBalance(
            userProfile.walletAddress,
            [SOLANA_USDC_MINT],
          );
          if (!cancelled) setUsdcBalance(usdcBalances[SOLANA_USDC_MINT] ?? 0);
        } else {
          const mints =
            token?.mint && !isEvmToken
              ? [token.mint, SOLANA_USDC_MINT]
              : [SOLANA_USDC_MINT];
          const balances = await getWalletTokenBalance(
            userProfile.walletAddress,
            mints,
          );
          if (!cancelled) {
            if (token?.mint && !isEvmToken) {
              setTokenBalance(balances[token.mint] ?? 0);
            } else {
              setTokenBalance(0);
            }
            setUsdcBalance(balances[SOLANA_USDC_MINT] ?? 0);
          }
        }
        if (!cancelled) setSellAmount("");
      } catch (err) {
        if (!cancelled) {
          console.warn("Failed to fetch balances:", err);
          setTokenBalance(0);
          setUsdcBalance(null);
        }
      } finally {
        if (!cancelled) setLoadingBalance(false);
      }
    };
    fetchBalances();
    return () => {
      cancelled = true;
    };
  }, [token?.mint, token?.chain, userProfile?.walletAddress, user, isEvmToken]);

  const fetchTokenDetails = async (
    address: string,
    chain: TradeChain,
    currentToken: TokenSearchResult | null,
  ) => {
    fetchDetailsMintRef.current = address;
    setLoading(true);
    const chainId = getChainId(chain);
    const base: TokenSearchResult =
      currentToken?.mint === address
        ? currentToken
        : crossChainToken?.address === address
          ? {
              id: `${chainId}-${address}`,
              mint: address,
              name: crossChainToken.name || "",
              symbol: crossChainToken.symbol || "",
              decimals: 6,
              hasSocials: false,
              chain,
              chainId,
            }
          : {
              id: `${chainId}-${address}`,
              mint: address,
              name: "",
              symbol: "",
              decimals: 6,
              hasSocials: false,
              chain,
              chainId,
            };
    const isStale = () => fetchDetailsMintRef.current !== address;
    const useMoralis = isEvmAddress(address) && (chain === "base" || chain === "bnb");

    if (useMoralis) {
      try {
        const overview = await fetchMoralisTokenOverview(address, chain);
        if (isStale()) return;
        const fields = moralisOverviewToTokenFields(overview.data);
        if (Object.keys(fields).length > 0) {
          setToken({
            ...base,
            name: base.name || fields.name || "",
            symbol: base.symbol || fields.symbol || "",
            image: base.image || fields.image,
            decimals: fields.decimals ?? base.decimals,
            priceUsd: fields.priceUsd,
            marketCapUsd: fields.marketCapUsd,
            liquidityUsd: fields.liquidityUsd,
            holders: fields.holders,
            socials: fields.socials ?? base.socials,
          });
          setLoading(false);
          return;
        }
      } catch (e) {
        if (isStale()) return;
        console.warn("Moralis token details failed:", e);
      }
      if (!isStale()) setToken(base);
      setLoading(false);
      return;
    }

    try {
      const overview = await fetchBirdeyeTokenOverview(address, chain);
      if (isStale()) return;
      const fields = birdeyeOverviewToTokenFields(overview.data);
      if (Object.keys(fields).length > 0) {
        setToken({
          ...base,
          name: base.name || fields.name || "",
          symbol: base.symbol || fields.symbol || "",
          image: base.image || fields.image,
          decimals: fields.decimals ?? base.decimals,
          priceUsd: fields.priceUsd,
          marketCapUsd: fields.marketCapUsd,
          liquidityUsd: fields.liquidityUsd,
          volume_24h: fields.volume_24h,
          holders: fields.holders,
          buys: fields.buys,
          sells: fields.sells,
          totalTransactions: fields.totalTransactions,
          socials: fields.socials ?? base.socials,
        });
        setLoading(false);
        return;
      }
    } catch (e) {
      if (isStale()) return;
      console.warn("Birdeye token details failed:", e);
    }
    if (chain !== "solana") {
      if (!isStale()) setToken(base);
      setLoading(false);
      return;
    }
    try {
      const tokenInfo = await getTokenInfo(address);
      if (isStale()) return;
      const tokenData = convertTokenInfoToSearchResult(tokenInfo);
      setToken({ ...tokenData, chain: "solana", chainId: 792703809 });
    } catch (error) {
      if (isStale()) return;
      console.error("Error fetching token details:", error);
      try {
        const response = await searchTokens(address, 1, 1);
        if (
          response.status === "success" &&
          response.data &&
          response.data.length > 0
        ) {
          setToken({
            ...response.data[0],
            chain: "solana",
            chainId: 792703809,
          });
        } else {
          setToken(base);
        }
      } catch (searchError) {
        console.error("Error with search fallback:", searchError);
        setToken(base);
      }
    } finally {
      if (!isStale()) setLoading(false);
    }
  };

  const handleRefresh = async () => {
    const address = mint || crossChainToken?.address;
    if (refreshCooldown > 0 || !address) return;

    setLastRefresh(Date.now());
    setRefreshCooldown(15);
    const chain = mint ? effectiveChain : (tradeChain as TradeChain);
    await fetchTokenDetails(address, chain, token);
  };

  const handleCopyShareLink = async () => {
    if (!mint) return;
    const params = new URLSearchParams({ mint });
    if (effectiveChain === "base" || effectiveChain === "bnb") {
      params.set("chain", effectiveChain);
    }
    const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
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
    const isCrossChain = tradeChain !== "solana" && crossChainToken;
    if (!amount || !userProfile?.walletAddress || !user) {
      toast.error("Missing required information", {
        description: "Please connect your wallet and enter an amount",
      });
      return;
    }
    if (!isCrossChain && !token) {
      toast.error("Select a token", {
        description: "Search or paste a token address",
      });
      return;
    }
    if (isCrossChain && !crossChainToken) {
      toast.error("Select a token", {
        description: `Choose a token on ${tradeChain === "base" ? "Base" : "BNB"}`,
      });
      return;
    }
    if (isCrossChain && !evmAddress) {
      toast.error("Loading wallet", {
        description: "Wait for cross-chain address",
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
      const tokenId = await user.getIdToken();
      const base = getApiBase();
      const outputMint = isCrossChain ? crossChainToken!.address : token!.mint;
      const body: Record<string, unknown> = {
        inputMint: SOLANA_USDC_MINT,
        outputMint,
        amount: Math.floor(amountNum * 1e6).toString(),
        slippageBps: slippage,
        userWallet: userProfile.walletAddress,
        tradeType: "buy",
      };
      if (isCrossChain) {
        body.outputChainId = getChainId(tradeChain);
        body.recipient = evmAddress;
      }
      const res = await fetch(`${base}/api/relay/swap-quote`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenId}`,
        },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to get quote");

      setRelayQuote(data);
      const details = data?.details || {};
      const currencyIn = details.currencyIn || {};
      const currencyOut = details.currencyOut || {};
      const inputAmount =
        parseInt(currencyIn.amount || "0", 10) || Math.floor(amountNum * 1e6);
      const outputAmount = parseInt(currencyOut.amount || "0", 10);
      const inputAmountUi =
        parseFloat(currencyIn.amountFormatted || "0") || amountNum;
      const outputAmountUi = parseFloat(currencyOut.amountFormatted || "0");
      const inUsd =
        currencyIn.amountUsd != null
          ? parseFloat(currencyIn.amountUsd)
          : undefined;
      const outUsd =
        currencyOut.amountUsd != null
          ? parseFloat(currencyOut.amountUsd)
          : undefined;
      const impact =
        details.totalImpact?.percent != null
          ? parseFloat(details.totalImpact.percent)
          : 0;

      setSwapQuote({
        inputMint: SOLANA_USDC_MINT,
        outputMint: outputMint,
        inputAmount,
        outputAmount,
        inputAmountUi,
        outputAmountUi,
        inUsdValue: inUsd,
        outUsdValue: outUsd,
        priceImpact: impact,
        feeBps: 0,
        feeMint: SOLANA_USDC_MINT,
        requestId: data?.steps?.[0]?.requestId || "",
        transaction: "",
        slippage,
      } as SwapQuote);
      setSwapDirection("buy");
      setShowQuoteModal(true);
    } catch (error: unknown) {
      console.error("Error getting swap quote:", error);
      toast.error("Failed to get quote", {
        description:
          error instanceof Error ? error.message : "Please try again",
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

    const isEvmSell = token.chain === "base" || token.chain === "bnb";
    if (isEvmSell && !evmAddress) {
      toast.error("EVM wallet not ready", {
        description: "Please wait a moment and try again",
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
    if (amountNum > sellableBalance) {
      toast.error("Insufficient balance", {
        description:
          token.mint === SOL_MINT
            ? `Max sellable is ${sellableBalance.toFixed(4)} ${token.symbol} (${SOL_RESERVE} reserved for gas)`
            : `You have ${tokenBalance.toFixed(4)} ${token.symbol}`,
      });
      return;
    }

    setSwapping(true);
    try {
      const amountRaw = toRawAmountString(amountNum, token.decimals);
      const tokenId = await user.getIdToken();
      const base = getApiBase();
      const res = await fetch(`${base}/api/relay/swap-quote`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${tokenId}`,
        },
        body: JSON.stringify({
          inputMint: token.mint,
          outputMint: SOLANA_USDC_MINT,
          amount: amountRaw,
          slippageBps: slippage,
          // For EVM sell: user = EVM address (origin), recipient = Solana (destination)
          userWallet: isEvmSell ? evmAddress : userProfile.walletAddress,
          recipient: isEvmSell ? userProfile.walletAddress : undefined,
          tradeType: "sell",
          // Chain from token card (Birdeye/Relay); Relay uses it for sell origin. Default Solana for SPL.
          inputChainId: token.chainId ?? 792703809,
          inputChain: token.chain ?? "solana",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to get quote");

      setRelayQuote(data);
      const details = data?.details || {};
      const currencyIn = details.currencyIn || {};
      const currencyOut = details.currencyOut || {};
      const inputAmount =
        parseInt(currencyIn.amount || "0", 10) || parseInt(amountRaw, 10);
      const outputAmount = parseInt(currencyOut.amount || "0", 10);
      const inputAmountUi =
        parseFloat(currencyIn.amountFormatted || "0") || amountNum;
      const outputAmountUi = parseFloat(currencyOut.amountFormatted || "0");
      const inUsd =
        currencyIn.amountUsd != null
          ? parseFloat(currencyIn.amountUsd)
          : undefined;
      const outUsd =
        currencyOut.amountUsd != null
          ? parseFloat(currencyOut.amountUsd)
          : undefined;
      const impact =
        details.totalImpact?.percent != null
          ? parseFloat(details.totalImpact.percent)
          : 0;

      setSwapQuote({
        inputMint: token.mint,
        outputMint: SOLANA_USDC_MINT,
        inputAmount,
        outputAmount,
        inputAmountUi,
        outputAmountUi,
        inUsdValue: inUsd,
        outUsdValue: outUsd,
        priceImpact: impact,
        feeBps: 0,
        feeMint: token.mint,
        requestId: data?.steps?.[0]?.requestId || "",
        transaction: "",
        slippage,
      });
      setSwapDirection("sell");
      setShowQuoteModal(true);
    } catch (error: unknown) {
      console.error("Error getting sell quote:", error);
      toast.error("Failed to get quote", {
        description:
          error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setSwapping(false);
    }
  };

  const getExplorerTxUrl = (signature: string, chainId?: number) => {
    if (chainId === 8453) return `https://basescan.org/tx/${signature}`;
    if (chainId === 56) return `https://bscscan.com/tx/${signature}`;
    return `https://solscan.io/tx/${signature}`;
  };

  const handleConfirmSwap = async () => {
    if (!relayQuote || !user) return;

    setSwapping(true);
    setShowQuoteModal(false);

    try {
      const tokenId = await user.getIdToken();
      const base = getApiBase();
      const steps = Array.isArray((relayQuote as { steps?: unknown[] })?.steps)
        ? (relayQuote as { steps: unknown[] }).steps
        : [];
      let lastSignature: string | null = null;
      let lastChainId: number | undefined;

      for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
        const res = await fetch(`${base}/api/relay/execute-step`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${tokenId}`,
          },
          body: JSON.stringify({
            quoteResponse: relayQuote,
            stepIndex,
          }),
        });
        const result = await res.json();

        if (result.status === "Success" && result.signature) {
          lastSignature = result.signature;
          lastChainId = result.chainId;
        } else {
          throw new Error(result.error || "Swap failed");
        }
      }

      if (!lastSignature) {
        throw new Error("Swap failed");
      }

      toast.success("Swap successful!", {
        description: "Your transaction has been confirmed",
        action: {
          label: "View",
          onClick: () =>
            window.open(getExplorerTxUrl(lastSignature!, lastChainId), "_blank"),
        },
      });

      if (userProfile?.walletAddress) {
          const newBalance = await getSolBalance(userProfile.walletAddress);
          await updateBalance(newBalance);
          // Refetch positions so "your position" / sell balance and USDC balance update
          const wasEvmSell = swapDirection === "sell" && (token?.chain === "base" || token?.chain === "bnb");
          try {
            if (wasEvmSell && token?.mint && user) {
              const tokenId = await user.getIdToken();
              const base = getApiBase();
              const res = await fetch(`${base}/api/relay/evm-balances`, {
                headers: { Authorization: `Bearer ${tokenId}` },
              });
              const data = await res.json();
              if (res.ok && data.tokens) {
                const match = (data.tokens as Array<{ mint: string; amount: number }>).find(
                  (t) => t.mint === token.mint
                );
                setTokenBalance(match?.amount ?? 0);
              }
            } else {
              const boughtMint = token?.mint ?? crossChainToken?.address;
              const isBoughtEvm = boughtMint && isEvmAddress(boughtMint);
              if (swapDirection === "sell" && token?.mint) {
                const balances = await getWalletTokenBalance(
                  userProfile.walletAddress,
                  [token.mint],
                );
                setTokenBalance(balances[token.mint] ?? 0);
              } else if (swapDirection === "buy") {
                if (boughtMint && isBoughtEvm && user) {
                  const tokenId = await user.getIdToken();
                  const base = getApiBase();
                  const res = await fetch(`${base}/api/relay/evm-balances`, {
                    headers: { Authorization: `Bearer ${tokenId}` },
                  });
                  const data = await res.json();
                  if (res.ok && data.tokens) {
                    const match = (data.tokens as Array<{ mint: string; amount: number }>).find(
                      (t) => t.mint === boughtMint
                    );
                    setTokenBalance(match?.amount ?? 0);
                  }
                } else if (boughtMint) {
                  const balances = await getWalletTokenBalance(
                    userProfile.walletAddress,
                    [boughtMint],
                  );
                  setTokenBalance(balances[boughtMint] ?? 0);
                }
                const usdcBalances = await getWalletTokenBalance(
                  userProfile.walletAddress,
                  [SOLANA_USDC_MINT],
                );
                setUsdcBalance(usdcBalances[SOLANA_USDC_MINT] ?? 0);
              }
            }
          } catch {
            // ignore
          }
        }

      setAmount("");
      setSellAmount("");
      setSwapQuote(null);
      setRelayQuote(null);
    } catch (error: unknown) {
      console.error("Error executing swap:", error);
      toast.error("Swap failed", {
        description:
          error instanceof Error ? error.message : "Please try again",
      });
    } finally {
      setSwapping(false);
    }
  };

  return (
    <>
      <DocumentHead title="Trade" description="Swap and trade tokens on COPE" />
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

          {/* Token search only — chain comes from selected token (Relay metadata) */}
          <div className="min-w-0 space-y-3">
            <div>
              <label className="block text-sm font-medium mb-2">Token</label>
              <TokenSearch
                onSelect={(selectedToken) => {
                  const chain = selectedToken.chain ?? "solana";
                  setTradeChain(chain);
                  if (chain === "solana") {
                    setToken(selectedToken);
                    setMint(selectedToken.mint);
                    setCrossChainToken(null);
                    setSearchParams(
                      { mint: selectedToken.mint },
                      { replace: true },
                    );
                  } else {
                    setCrossChainToken({
                      symbol: selectedToken.symbol,
                      address: selectedToken.mint,
                      name: selectedToken.name,
                    });
                    setToken(selectedToken);
                    setMint("");
                    setSearchParams({}, { replace: true });
                  }
                }}
                placeholder="Search token by name, symbol, or address..."
              />
            </div>
          </div>

          {loading && (
            <Card glass>
              <div className="p-6 text-center text-white/60">
                Loading token details...
              </div>
            </Card>
          )}

          {(token || (tradeChain !== "solana" && crossChainToken)) &&
            !loading && (
              <Card glass>
                {/* Token Header (Solana + Base/BNB with Birdeye details) */}
                {token && (
                  <div className="mb-4 sm:mb-6">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
                      <div className="flex items-start gap-3 sm:gap-4 flex-1 min-w-0">
                        {token.image && (
                          <img
                            src={token.image}
                            alt={token.symbol}
                            className="w-12 h-12 sm:w-16 sm:h-16 rounded-full flex-shrink-0 border-2 border-white/10"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display =
                                "none";
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
                        {mint && (
                          <button
                            type="button"
                            onClick={handleCopyShareLink}
                            data-tap-haptic
                            className="flex items-center justify-center gap-2 px-3 py-2 sm:px-4 rounded-lg text-sm font-medium bg-white/10 hover:bg-white/15 text-white transition-all touch-manipulation min-h-[44px] sm:min-h-0"
                            title="Copy share link"
                          >
                            <Copy className="w-4 h-4" />
                            <span className="hidden sm:inline">Copy link</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleRefresh}
                          disabled={refreshCooldown > 0 || loading}
                          data-tap-haptic
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
                          {refreshCooldown > 0
                            ? `${refreshCooldown}s`
                            : "Refresh"}
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
                        <div className="text-xs text-white/60 mb-1">
                          Market Cap
                        </div>
                        <div className="text-sm sm:text-lg font-semibold truncate">
                          {formatCurrency(token.marketCapUsd)}
                        </div>
                      </div>
                      <div className="bg-white/5 rounded-lg p-2 sm:p-3">
                        <div className="text-xs text-white/60 mb-1">
                          Liquidity
                        </div>
                        <div className="text-sm sm:text-lg font-semibold truncate">
                          {formatCurrency(token.liquidityUsd)}
                        </div>
                      </div>
                      <div className="bg-white/5 rounded-lg p-2 sm:p-3">
                        <div className="text-xs text-white/60 mb-1">
                          Holders
                        </div>
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
                        {token.volume_24h !== undefined &&
                          token.volume_24h > 0 && (
                            <div className="flex items-center gap-1">
                              <span>
                                Vol 24h: {formatCurrency(token.volume_24h)}
                              </span>
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
                              📦 Bundlers:{" "}
                              {token.bundlers.percentage.toFixed(2)}%
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Social Links */}
                    <div className="flex flex-wrap gap-2 mb-4">
                      {(() => {
                        const explorerUrl =
                          token.chain === "base"
                            ? `https://basescan.org/token/${token.mint}`
                            : token.chain === "bnb"
                              ? `https://bscscan.com/token/${token.mint}`
                              : `https://solscan.io/token/${token.mint}`;
                        const explorerLabel =
                          token.chain === "base"
                            ? "Basescan"
                            : token.chain === "bnb"
                              ? "BscScan"
                              : "Solscan";
                        return (
                          <a
                            href={explorerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs flex items-center gap-1 transition-colors"
                          >
                            <span>🔍</span> {explorerLabel}
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        );
                      })()}
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
                      {token.socials?.telegram && (
                        <a
                          href={token.socials.telegram}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs flex items-center gap-1 transition-colors"
                        >
                          <span>✈️</span> Telegram
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      {token.socials?.discord && (
                        <a
                          href={token.socials.discord}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-xs flex items-center gap-1 transition-colors"
                        >
                          <span>💬</span> Discord
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
                )}

                {/* Buy Section */}
                <div className="mb-4 sm:mb-6">
                  <div className="flex justify-between items-center mb-2">
                    <label className="text-sm font-medium">
                      Buy Amount (USDC)
                    </label>
                    <span className="text-sm text-white/70 min-w-0 truncate max-w-[50%]">
                      {usdcBalance != null
                        ? `${usdcBalance.toFixed(2)} USDC`
                        : "—"}
                    </span>
                  </div>
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
                        {amt} USDC
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2 mb-3">
                  <Button
                    className="flex-1 h-11 sm:h-12 min-w-0"
                    onClick={handleBuy}
                    disabled={
                      swapping || !amount || !userProfile?.walletAddress
                    }
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
                    onClick={() =>
                      setShowSlippageSettings(!showSlippageSettings)
                    }
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

                {/* Sell Section (Solana only) */}
                {token && (
                  <div className="pt-4 border-t border-white/6">
                    <p className="text-sm text-white/60 mb-2 truncate">
                      Your Position:{" "}
                      {loadingBalance
                        ? "..."
                        : `${tokenBalance.toLocaleString(undefined, {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 6,
                          })} ${token.symbol}`}
                      {sellableBalance < tokenBalance && (
                        <span className="block mt-0.5 text-white/40">
                          Max sellable: {sellableBalance.toFixed(6)}{" "}
                          {token?.mint === "base-eth"
                            ? "(0.0005 reserved for gas)"
                            : token?.mint === "bnb-bnb"
                              ? "(0.001 reserved for gas)"
                              : "(0.005 reserved for gas)"}
                        </span>
                      )}
                    </p>
                    <label className="block text-sm font-medium mb-2">
                      Sell Amount ({token.symbol})
                    </label>
                    <Input
                      type="number"
                      placeholder="0.0"
                      value={sellAmount}
                      onChange={(e) => {
                        const raw = e.target.value;
                        if (raw === "" || raw === ".") {
                          setSellAmount(raw);
                          return;
                        }
                        const num = parseFloat(raw);
                        if (isNaN(num)) return;
                        const capped = Math.min(num, sellableBalance);
                        setSellAmount(capped === num ? raw : capped.toFixed(6));
                      }}
                      disabled={sellableBalance <= 0}
                      className="min-w-0"
                    />
                    <div className="flex gap-2 mt-2 flex-wrap">
                      {[25, 50, 75].map((pct) => (
                        <button
                          key={pct}
                          type="button"
                          onClick={() =>
                            setSellAmount(
                              ((sellableBalance * pct) / 100).toString(),
                            )
                          }
                          disabled={sellableBalance <= 0}
                          className="flex-1 min-w-[3rem] h-9 sm:h-8 rounded-[10px] bg-white/5 hover:bg-white/10 text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {pct}%
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={() =>
                          setSellAmount(sellableBalance.toString())
                        }
                        disabled={sellableBalance <= 0}
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
                        sellableBalance <= 0 ||
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
                )}
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
        {showQuoteModal &&
          swapQuote &&
          (token || crossChainToken) &&
          (() => {
            const displaySymbol =
              token?.symbol ?? crossChainToken?.symbol ?? "";
            const displayDecimals =
              token?.decimals ?? (crossChainToken?.symbol === "USDC" ? 6 : 18);
            return (
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
                            ? `${swapQuote.inputAmountUi.toFixed(2)} USDC`
                            : `${formatTokenAmount(swapQuote.inputAmount, displayDecimals)} ${displaySymbol}`}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs sm:text-sm text-white/60">
                          {swapQuote.inUsdValue != null
                            ? `~$${swapQuote.inUsdValue.toFixed(2)}`
                            : swapDirection === "buy"
                              ? `~$${swapQuote.inputAmountUi.toFixed(2)}`
                              : `~$${((swapQuote.inputAmount / Math.pow(10, displayDecimals)) * (token?.priceUsd || 0)).toFixed(2)}`}
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
                            ? `${formatTokenAmount(swapQuote.outputAmount, displayDecimals)} ${displaySymbol}`
                            : `${swapQuote.outputAmountUi.toFixed(2)} USDC`}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs sm:text-sm text-white/60">
                          {swapQuote.outUsdValue != null
                            ? `~$${swapQuote.outUsdValue.toFixed(2)}`
                            : swapDirection === "buy"
                              ? `~$${((swapQuote.outputAmount / Math.pow(10, displayDecimals)) * (token?.priceUsd || 0)).toFixed(2)}`
                              : `~$${swapQuote.outputAmountUi.toFixed(2)}`}
                        </div>
                      </div>
                    </div>

                    {/* Transaction Details */}
                    <div className="p-2 sm:p-3 bg-white/5 rounded-[10px] space-y-2 text-xs sm:text-sm">
                      <div className="flex justify-between">
                        <span className="text-white/60">Price Impact</span>
                        <span
                          className={getPriceImpactColor(swapQuote.priceImpact)}
                        >
                          {formatPriceImpact(swapQuote.priceImpact)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/60">
                          Slippage Tolerance
                        </span>
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
                        setRelayQuote(null);
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
            );
          })()}
      </div>
    </>
  );
}
