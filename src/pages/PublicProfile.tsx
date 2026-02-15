import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router";
import { motion } from "motion/react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import {
  Twitter,
  ExternalLink,
  DollarSign,
  ArrowUpDown,
  ArrowLeft,
  TrendingUp,
  Activity,
  UserPlus,
  Check,
} from "lucide-react";
import { getApiBase } from "@/lib/utils";
import { shortenAddress } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import {
  getPublicProfileByHandle,
  type PublicProfileByHandle,
} from "@/lib/profile";
import { getUsdcBalance } from "@/lib/rpc";
import { getWalletPortfolioWithPnL } from "@/lib/birdeye";
import { fetchNativePrices } from "@/lib/coingecko";
import { getWalletProfitability } from "@/lib/moralis";
import { SOLANA_USDC_MINT, SOL_MINT } from "@/lib/constants";
import { DocumentHead } from "@/components/DocumentHead";

interface TokenPosition {
  mint: string;
  symbol: string;
  name: string;
  image?: string;
  amount: number;
  value: number;
  pnl?: number;
  pnlPercent?: number;
  chain?: "solana" | "base" | "bnb";
}

const SOL_RESERVE = 0.005;
const BASE_ETH_RESERVE = 0.0005;
const BNB_RESERVE = 0.001;

function sellableAmount(pos: { mint: string; amount: number }): number {
  if (
    pos.mint === SOL_MINT ||
    pos.mint === "So11111111111111111111111111111111111111111"
  )
    return Math.max(0, pos.amount - SOL_RESERVE);
  if (pos.mint === "base-eth")
    return Math.max(0, pos.amount - BASE_ETH_RESERVE);
  if (pos.mint === "bnb-bnb") return Math.max(0, pos.amount - BNB_RESERVE);
  return pos.amount;
}

export function PublicProfile() {
  const { handle } = useParams<{ handle: string }>();
  const navigate = useNavigate();
  const { user, watchlist, addToWatchlist, removeFromWatchlist } = useAuth();
  const [profile, setProfile] = useState<PublicProfileByHandle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [usdcBalance, setUsdcBalance] = useState<number>(0);
  const [usdcBalanceLoading, setUsdcBalanceLoading] = useState(true);
  const [openPositions, setOpenPositions] = useState<TokenPosition[]>([]);
  const [closedPositions] = useState<TokenPosition[]>([]);
  const [followLoading, setFollowLoading] = useState(false);

  const isFollowed =
    !!profile &&
    watchlist.some(
      (w) =>
        w.address === profile.walletAddress ||
        (w.onPlatform && w.uid === profile.uid),
    );

  useEffect(() => {
    if (!handle?.trim()) {
      setError("Invalid handle");
      setLoading(false);
      return;
    }
    let cancelled = false;
    getPublicProfileByHandle(handle)
      .then((data) => {
        if (!cancelled) {
          setProfile(data);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setProfile(null);
          setError(
            e instanceof Error ? e.message : "Profile not found or private",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [handle]);

  useEffect(() => {
    if (!profile?.walletAddress) {
      setUsdcBalance(0);
      setUsdcBalanceLoading(false);
      return;
    }
    setUsdcBalanceLoading(true);
    getUsdcBalance(profile.walletAddress)
      .then(setUsdcBalance)
      .catch(() => setUsdcBalance(0))
      .finally(() => setUsdcBalanceLoading(false));
  }, [profile?.walletAddress]);

  useEffect(() => {
    if (!profile?.walletAddress) {
      setOpenPositions([]);
      return;
    }
    let cancelled = false;
    const base = getApiBase();

    (async () => {
      try {
        const [portfolio, nativePrices, evmData] = await Promise.all([
          getWalletPortfolioWithPnL(profile!.walletAddress),
          fetchNativePrices(),
          profile!.evmAddress
            ? fetch(
                `${base}/api/relay/evm-balances-public?address=${encodeURIComponent(profile!.evmAddress)}`,
              )
                .then((r) => r.json())
                .catch(() => null)
            : Promise.resolve(null),
        ]);

        if (cancelled) return;

        const evmAddress = profile!.evmAddress;
        const [evmPnlBase, evmPnlBnb] = await Promise.all([
          evmAddress
            ? getWalletProfitability(evmAddress, "base")
            : Promise.resolve([]),
          evmAddress
            ? getWalletProfitability(evmAddress, "bsc")
            : Promise.resolve([]),
        ]);

        if (cancelled) return;

        const evmPnlByMint = new Map<
          string,
          { pnl: number; pnlPercent?: number }
        >();
        for (const item of [...evmPnlBase, ...evmPnlBnb]) {
          evmPnlByMint.set(item.mint, {
            pnl: item.pnl,
            pnlPercent: item.pnlPercent,
          });
        }

        const combined: TokenPosition[] = [];
        const solanaUsdc = portfolio.usdcBalance;
        const baseBal = evmData?.base ?? { usdc: 0, native: 0 };
        const bnbBal = evmData?.bnb ?? { usdc: 0, native: 0 };

        // 1) USDC first: Solana + Base + BNB combined (one row)
        const totalUsdc =
          (Number.isFinite(solanaUsdc) ? solanaUsdc : 0) +
          (baseBal.usdc ?? 0) +
          (bnbBal.usdc ?? 0);
        if (totalUsdc > 0) {
          combined.push({
            mint: SOLANA_USDC_MINT,
            symbol: "USDC",
            name: "USDC",
            amount: totalUsdc,
            value: totalUsdc,
          });
        }
        if (!cancelled) setUsdcBalance(totalUsdc);

        // 2) SOL is in portfolio.positions (handled in step 4)

        // 3) EVM (ETH, BNB, other tokens) — always add native when > 0; add Moralis tokens with dedupe
        if (evmAddress && evmData) {
          const addedMints = new Set<string>();
          if (baseBal.native > 0) {
            addedMints.add("base-eth");
            const pos = {
              mint: "base-eth",
              amount: baseBal.native,
              value: baseBal.native * nativePrices.eth,
              pnl: evmPnlByMint.get("base-eth")?.pnl,
              pnlPercent: evmPnlByMint.get("base-eth")?.pnlPercent,
              chain: "base" as const,
            };
            if (sellableAmount(pos) > 0) {
              combined.push({
                mint: pos.mint,
                symbol: "ETH",
                name: "Ethereum (Base)",
                amount: pos.amount,
                value: pos.value,
                pnl: pos.pnl,
                pnlPercent: pos.pnlPercent,
                chain: pos.chain,
              });
            }
          }
          if (bnbBal.native > 0) {
            addedMints.add("bnb-bnb");
            const pos = {
              mint: "bnb-bnb",
              amount: bnbBal.native,
              value: bnbBal.native * nativePrices.bnb,
              pnl: evmPnlByMint.get("bnb-bnb")?.pnl,
              pnlPercent: evmPnlByMint.get("bnb-bnb")?.pnlPercent,
              chain: "bnb" as const,
            };
            if (sellableAmount(pos) > 0) {
              combined.push({
                mint: pos.mint,
                symbol: "BNB",
                name: "BNB",
                amount: pos.amount,
                value: pos.value,
                pnl: pos.pnl,
                pnlPercent: pos.pnlPercent,
                chain: pos.chain,
              });
            }
          }
          const BASE_USDC_ADDR = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
          const BNB_USDC_ADDR = "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d";
          if (Array.isArray(evmData.tokens) && evmData.tokens.length > 0) {
            for (const t of evmData.tokens) {
              const amount = t.amount ?? 0;
              const value = t.value ?? 0;
              if (amount <= 0 || value <= 0) continue;
              const m = (t.mint ?? "").toLowerCase();
              if (addedMints.has(m)) continue;
              if (m === BASE_USDC_ADDR || m === BNB_USDC_ADDR) continue;
              addedMints.add(m);
              const evmPnl = evmPnlByMint.get(m);
              combined.push({
                mint: m,
                symbol: t.symbol ?? "???",
                name: t.name ?? "Unknown Token",
                image: t.image,
                amount,
                value,
                pnl: evmPnl?.pnl,
                pnlPercent: evmPnl?.pnlPercent,
                chain: t.chain ?? "base",
              });
            }
          }
        }

        // 4) SPL tokens from Birdeye portfolio (exclude USDC; hide SOL when sellable <= 0)
        for (const t of portfolio.positions) {
          if (t.mint === SOLANA_USDC_MINT) continue;
          if (t.amount <= 0 || t.value <= 0) continue;
          const pos = { mint: t.mint, amount: t.amount };
          if (sellableAmount(pos) <= 0) continue;
          combined.push({
            mint: t.mint,
            symbol: t.symbol || t.mint.slice(0, 8),
            name: t.name || "Unknown",
            image: t.image,
            amount: t.amount,
            value: t.value,
            pnl: t.pnl,
            pnlPercent: t.pnlPercent,
          });
        }
        if (!cancelled) setOpenPositions(combined);
      } catch {
        if (!cancelled) setOpenPositions([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [profile?.walletAddress, profile?.evmAddress]);

  // Only show positions with amount > 0 and value >= 0 (no ghost/zero balances)
  const displayedOpenPositions = useMemo(() => {
    return openPositions.filter((p) => p.amount > 0 && p.value >= 0);
  }, [openPositions]);

  const xHandle = profile?.xHandle || profile?.displayName || "@user";
  const avatar = profile?.avatar || "";
  const container = {
    initial: {},
    animate: {
      transition: {
        staggerChildren: 0.05,
        delayChildren: 0.1,
      },
    },
  };
  const item = {
    initial: { opacity: 0, y: 12 },
    animate: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.35, ease: "easeOut" as const },
    },
  };

  if (loading) {
    return (
      <>
        <DocumentHead title="Loading profile…" appendBrand={true} />
        <div
          className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[#000000] to-[#0B3D2E]"
          style={{
            paddingTop: "var(--safe-area-inset-top)",
            paddingBottom: "var(--safe-area-inset-bottom)",
          }}
        >
          <p className="text-white/60">Loading profile…</p>
        </div>
      </>
    );
  }

  if (error || !profile) {
    return (
      <>
        <DocumentHead title="Profile not found" appendBrand={true} />
        <div
          className="min-h-screen flex flex-col items-center justify-center gap-4 p-4 bg-gradient-to-b from-[#000000] to-[#0B3D2E]"
          style={{
            paddingTop: "var(--safe-area-inset-top)",
            paddingBottom: "var(--safe-area-inset-bottom)",
          }}
        >
          <p className="text-white/80 text-center">
            {error || "Profile not found or private"}
          </p>
          <Button
            variant="ghost"
            onClick={() => navigate("/")}
            className="text-accent-primary hover:text-accent-hover min-h-[44px]"
          >
            Go home
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <DocumentHead
        title={xHandle}
        description={`View ${xHandle}'s wallet, positions, and PnL on COPE`}
        ogImage={avatar || undefined}
        ogType="profile"
      />
      <div
        className="min-h-screen bg-gradient-to-b from-[#000000] to-[#0B3D2E]"
        style={{
          paddingTop: "var(--safe-area-inset-top)",
          paddingBottom: "var(--safe-area-inset-bottom)",
        }}
      >
        <motion.div
          className="p-4 sm:p-6 max-w-[720px] mx-auto pb-8"
          variants={container}
          initial="initial"
          animate="animate"
        >
          <motion.div className="mb-6 flex items-center gap-3" variants={item}>
            <button
              onClick={() => navigate(-1)}
              data-tap-haptic
              className="tap-press p-2 rounded-full hover:bg-white/10 text-white/70 hover:text-white min-w-[44px] min-h-[44px] flex items-center justify-center touch-manipulation"
              aria-label="Back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-xl sm:text-2xl font-bold flex-1 truncate">
              Profile
            </h1>
          </motion.div>

          <motion.div variants={item} className="mb-6">
            <Card glass className="overflow-hidden">
              <div className="relative">
                <div className="h-1 bg-gradient-to-r from-[#12d585]/40 via-[#08b16b]/30 to-transparent" />
                <div className="p-4 sm:p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
                    <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                      {avatar ? (
                        <img
                          src={avatar}
                          alt={xHandle}
                          className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl object-cover ring-2 ring-white/10 flex-shrink-0"
                        />
                      ) : (
                        <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-gradient-to-br from-[#12d585] to-[#08b16b] flex items-center justify-center ring-2 ring-white/10 flex-shrink-0">
                          <span className="text-lg sm:text-xl font-bold text-[#000000]">
                            {xHandle.charAt(1)?.toUpperCase() || "U"}
                          </span>
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <h3 className="font-bold text-base sm:text-lg truncate">
                          {xHandle}
                        </h3>
                        <div className="flex items-center gap-2 text-sm text-white/60 mt-0.5">
                          <Twitter className="w-4 h-4" />
                          <span>Public profile</span>
                        </div>
                        {profile.walletAddress && (
                          <div className="flex items-center gap-2 mt-1 min-w-0 overflow-hidden">
                            <code className="text-xs font-mono text-white/50 truncate">
                              {shortenAddress(profile.walletAddress)}
                            </code>
                          </div>
                        )}
                      </div>
                      {user && profile?.walletAddress && (
                        <Button
                          variant={isFollowed ? "outline" : "primary"}
                          size="sm"
                          disabled={followLoading}
                          onClick={async () => {
                            if (!profile?.walletAddress) return;
                            setFollowLoading(true);
                            try {
                              if (isFollowed) {
                                await removeFromWatchlist(
                                  profile.walletAddress,
                                  {
                                    uid: profile.uid,
                                  },
                                );
                              } else {
                                await addToWatchlist(profile.walletAddress, {
                                  uid: profile.uid,
                                  onPlatform: true,
                                });
                              }
                            } finally {
                              setFollowLoading(false);
                            }
                          }}
                          className="min-h-[44px] min-w-[44px] touch-manipulation flex-shrink-0 gap-2"
                        >
                          {isFollowed ? (
                            <>
                              <Check className="w-4 h-4" />
                              Following
                            </>
                          ) : (
                            <>
                              <UserPlus className="w-4 h-4" />
                              Follow
                            </>
                          )}
                        </Button>
                      )}
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-6 pl-0 sm:pl-4 border-l-0 sm:border-l border-white/10 mt-2 sm:mt-0">
                      <div className="flex flex-col items-center min-w-0 flex-1 sm:flex-initial py-1">
                        <span className="text-lg sm:text-2xl font-bold">
                          {profile.followingCount}
                        </span>
                        <span className="text-[10px] sm:text-xs text-white/60">
                          Following
                        </span>
                      </div>
                      <div className="flex flex-col items-center min-w-0 flex-1 sm:flex-initial py-1">
                        <span className="text-lg sm:text-2xl font-bold">
                          {profile.followersCount}
                        </span>
                        <span className="text-[10px] sm:text-xs text-white/60">
                          Followers
                        </span>
                      </div>
                      <div className="flex flex-col items-center min-w-0 flex-1 sm:flex-initial py-1">
                        <span className="text-lg sm:text-2xl font-bold">
                          {profile.watchlistCount}
                        </span>
                        <span className="text-[10px] sm:text-xs text-white/60">
                          Watchlist
                        </span>
                      </div>
                    </div>
                  </div>

                  {profile.walletAddress && (
                    <>
                      {(profile.winRate != null ||
                        profile.totalTrades != null) && (
                        <div className="mt-4 pt-4 border-t border-white/10">
                          <div className="grid grid-cols-2 gap-4 sm:gap-6">
                            <div>
                              <div className="flex items-center gap-2 mb-2 text-white/60">
                                <TrendingUp className="w-4 h-4" />
                                <span className="text-sm">Win Rate</span>
                              </div>
                              <p className="text-2xl font-bold text-[#12d585]">
                                {Number(profile.winRate ?? 0).toFixed(2)}%
                              </p>
                              <p className="text-xs text-white/50 mt-1">
                                {(() => {
                                  const trades = profile.totalTrades ?? 0;
                                  const wins = Math.round(
                                    trades * ((profile.winRate ?? 0) / 100),
                                  );
                                  const losses = trades - wins;
                                  return `${wins}W / ${losses}L`;
                                })()}
                              </p>
                            </div>
                            <div>
                              <div className="flex items-center gap-2 mb-2 text-white/60">
                                <Activity className="w-4 h-4" />
                                <span className="text-sm">Total Trades</span>
                              </div>
                              <p className="text-2xl font-bold">
                                {profile.totalTrades ?? 0}
                              </p>
                              <p className="text-xs text-white/50 mt-1">
                                All time
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                      <div className="mt-4 pt-4 border-t border-white/10">
                        <p className="text-2xl sm:text-3xl font-bold">
                          {usdcBalanceLoading
                            ? "$0.00"
                            : `$${openPositions
                                .reduce((s, p) => s + p.value, 0)
                                .toLocaleString("en-US", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}`}
                        </p>
                        <p className="text-xs text-white/50 mt-0.5">
                          Total wallet balance
                        </p>
                      </div>
                      <div className="mt-4 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center">
                            <DollarSign className="w-4 h-4 text-white/70" />
                          </div>
                          <div>
                            <p className="text-sm text-white/60">
                              Cash balance
                            </p>
                            <p className="font-semibold">
                              {usdcBalanceLoading
                                ? "$0.00"
                                : `$${usdcBalance.toLocaleString("en-US", {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}`}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="mt-4 pt-4 border-t border-white/10">
                        <p className="text-sm font-medium mb-2">
                          Open positions
                        </p>
                        {displayedOpenPositions.length === 0 ? (
                          <p className="text-sm text-white/50">
                            No open positions
                          </p>
                        ) : (
                          <ul className="space-y-2">
                            {displayedOpenPositions.map((pos) => (
                              <li
                                key={pos.mint}
                                data-tap-haptic
                                className="tap-press flex items-center gap-3 py-3 px-2 rounded-lg min-h-[44px] hover:bg-white/5 active:bg-white/10 touch-manipulation cursor-pointer"
                                role="button"
                                onClick={() => {
                                  const params = new URLSearchParams({
                                    mint: pos.mint,
                                  });
                                  if (
                                    pos.chain === "base" ||
                                    pos.chain === "bnb"
                                  ) {
                                    params.set("chain", pos.chain);
                                  }
                                  navigate(`/app/trade?${params.toString()}`);
                                }}
                              >
                                {pos.image ? (
                                  <img
                                    src={pos.image}
                                    alt=""
                                    className="w-8 h-8 rounded-full object-cover"
                                  />
                                ) : (
                                  <div className="w-8 h-8 rounded-full bg-white/10" />
                                )}
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium truncate">
                                    {pos.symbol}
                                  </p>
                                  <p className="text-xs text-white/50">
                                    $
                                    {pos.value.toLocaleString("en-US", {
                                      minimumFractionDigits: 2,
                                    })}
                                  </p>
                                  {pos.pnl != null && pos.pnl !== 0 && (
                                    <p
                                      className={`text-xs mt-0.5 ${
                                        pos.pnl >= 0
                                          ? "text-[#12d585]"
                                          : "text-red-400"
                                      }`}
                                    >
                                      {pos.pnl >= 0 ? "+" : ""}$
                                      {pos.pnl.toFixed(2)}
                                      {pos.pnlPercent != null &&
                                        !Number.isNaN(pos.pnlPercent) && (
                                          <span className="ml-1 opacity-90">
                                            ({pos.pnlPercent >= 0 ? "+" : ""}
                                            {pos.pnlPercent.toFixed(1)}%)
                                          </span>
                                        )}
                                    </p>
                                  )}
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className="mt-4 pt-4 border-t border-white/10">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm font-medium">
                            Closed positions
                          </p>
                          <span className="flex items-center gap-1 text-xs text-white/50">
                            <ArrowUpDown className="w-3 h-3" /> Recent
                          </span>
                        </div>
                        {closedPositions.length === 0 ? (
                          <p className="text-sm text-white/50">
                            No closed positions
                          </p>
                        ) : (
                          <ul className="space-y-2">
                            {closedPositions.map((pos) => (
                              <li
                                key={pos.mint}
                                className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5"
                              >
                                {pos.image ? (
                                  <img
                                    src={pos.image}
                                    alt=""
                                    className="w-8 h-8 rounded-full object-cover"
                                  />
                                ) : (
                                  <div className="w-8 h-8 rounded-full bg-white/10" />
                                )}
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium truncate">
                                    {pos.symbol}
                                  </p>
                                  <p className="text-xs text-white/50">
                                    Closed
                                  </p>
                                </div>
                                <p className="text-sm text-[#12d585]">
                                  +${pos.value.toFixed(2)}
                                </p>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className="mt-2 flex justify-end">
                        <a
                          href={`https://solscan.io/account/${profile.walletAddress}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          data-tap-haptic
                          className="tap-press text-xs text-accent-primary hover:text-accent-hover flex items-center gap-1 min-h-[44px] items-center touch-manipulation"
                        >
                          View on Explorer
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </Card>
          </motion.div>
        </motion.div>
      </div>
    </>
  );
}
