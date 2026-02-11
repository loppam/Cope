import { useState, useEffect, useMemo } from "react";
import { useParams, useNavigate } from "react-router";
import { motion } from "motion/react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Twitter, ExternalLink, DollarSign, ArrowUpDown, ArrowLeft } from "lucide-react";
import { getApiBase } from "@/lib/utils";
import { shortenAddress } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { getPublicProfileByHandle, type PublicProfileByHandle } from "@/lib/profile";
import { getUsdcBalance } from "@/lib/rpc";
import { getWalletPositions, getWalletPnL, getSolPrice } from "@/lib/solanatracker";
import { getSolBalance } from "@/lib/rpc";
import { getWalletProfitability } from "@/lib/moralis";
import { SOLANA_USDC_MINT, SOL_MINT } from "@/lib/constants";

interface TokenPosition {
  mint: string;
  symbol: string;
  name: string;
  image?: string;
  amount: number;
  value: number;
  pnl?: number;
  pnlPercent?: number;
}

const APPROX_ETH_PRICE = 3000;
const APPROX_BNB_PRICE = 600;

export function PublicProfile() {
  const { handle } = useParams<{ handle: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [profile, setProfile] = useState<PublicProfileByHandle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [usdcBalance, setUsdcBalance] = useState<number>(0);
  const [usdcBalanceLoading, setUsdcBalanceLoading] = useState(true);
  const [openPositions, setOpenPositions] = useState<TokenPosition[]>([]);
  const [closedPositions] = useState<TokenPosition[]>([]);

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
          setError(e instanceof Error ? e.message : "Profile not found or private");
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
        const [positionsRes, solBalance, solPrice, evmData] = await Promise.all([
          getWalletPositions(profile!.walletAddress, true),
          getSolBalance(profile!.walletAddress),
          getSolPrice(),
          profile!.evmAddress
            ? fetch(`${base}/api/relay/evm-balances-public?address=${encodeURIComponent(profile!.evmAddress)}`)
                .then((r) => r.json())
                .catch(() => null)
            : Promise.resolve(null),
        ]);

        if (cancelled) return;

        await new Promise((r) => setTimeout(r, 1000));
        if (cancelled) return;

        const evmAddress = profile!.evmAddress;
        const [pnlRes, evmPnlBase, evmPnlBnb] = await Promise.all([
          getWalletPnL(profile!.walletAddress, true),
          evmAddress ? getWalletProfitability(evmAddress, "base") : Promise.resolve([]),
          evmAddress ? getWalletProfitability(evmAddress, "bsc") : Promise.resolve([]),
        ]);

        if (cancelled) return;

        const evmPnlByMint = new Map<string, { pnl: number; pnlPercent?: number }>();
        for (const item of [...evmPnlBase, ...evmPnlBnb]) {
          evmPnlByMint.set(item.mint, { pnl: item.pnl, pnlPercent: item.pnlPercent });
        }

        const combined: TokenPosition[] = [];
        if (solBalance > 0 && solPrice > 0) {
          combined.push({
            mint: SOL_MINT,
            symbol: "SOL",
            name: "Solana",
            amount: solBalance,
            value: solBalance * solPrice,
          });
        }
        if (evmAddress && evmData) {
          const baseBal = evmData.base ?? { usdc: 0, native: 0 };
          const bnbBal = evmData.bnb ?? { usdc: 0, native: 0 };
          if (baseBal.usdc > 0) {
            const evmPnl = evmPnlByMint.get("base-usdc");
            combined.push({
              mint: "base-usdc",
              symbol: "USDC",
              name: "USD Coin (Base)",
              amount: baseBal.usdc,
              value: baseBal.usdc,
              pnl: evmPnl?.pnl,
              pnlPercent: evmPnl?.pnlPercent,
            });
          }
          if (baseBal.native > 0) {
            const evmPnl = evmPnlByMint.get("base-eth");
            combined.push({
              mint: "base-eth",
              symbol: "ETH",
              name: "Ethereum (Base)",
              amount: baseBal.native,
              value: baseBal.native * APPROX_ETH_PRICE,
              pnl: evmPnl?.pnl,
              pnlPercent: evmPnl?.pnlPercent,
            });
          }
          if (bnbBal.usdc > 0) {
            const evmPnl = evmPnlByMint.get("bnb-usdc");
            combined.push({
              mint: "bnb-usdc",
              symbol: "USDC",
              name: "USD Coin (BNB)",
              amount: bnbBal.usdc,
              value: bnbBal.usdc,
              pnl: evmPnl?.pnl,
              pnlPercent: evmPnl?.pnlPercent,
            });
          }
          if (bnbBal.native > 0) {
            const evmPnl = evmPnlByMint.get("bnb-bnb");
            combined.push({
              mint: "bnb-bnb",
              symbol: "BNB",
              name: "BNB",
              amount: bnbBal.native,
              value: bnbBal.native * APPROX_BNB_PRICE,
              pnl: evmPnl?.pnl,
              pnlPercent: evmPnl?.pnlPercent,
            });
          }
        }
        const pnlByMint = pnlRes?.tokens ?? {};
        for (const t of positionsRes.tokens) {
          const mint = t.token.mint;
          const symbol = (t.token.symbol || "").toUpperCase();
          if (mint === SOL_MINT || mint === SOLANA_USDC_MINT) continue;
          if (symbol === "SOL") continue;
          const value = t.value || 0;
          if (value <= 0) continue;
          const p = pnlByMint[mint];
          const pnl = p?.total ?? 0;
          const totalInvested = p?.total_invested ?? 0;
          const costBasis = p?.cost_basis ?? 0;
          let pnlPercent: number | undefined;
          if (totalInvested > 0) pnlPercent = (pnl / totalInvested) * 100;
          else if (costBasis > 0) pnlPercent = (pnl / costBasis) * 100;
          combined.push({
            mint,
            symbol: t.token.symbol || mint.slice(0, 8),
            name: t.token.name || "Unknown",
            image: t.token.image,
            amount: t.balance ?? 0,
            value,
            pnl,
            pnlPercent,
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

  const displayedOpenPositions = useMemo(() => {
    return openPositions.filter((p) => {
      if (p.mint === SOL_MINT) return p.amount >= 0.01;
      if (
        p.symbol === "USDC" ||
        p.mint === SOLANA_USDC_MINT ||
        p.mint === "base-usdc" ||
        p.mint === "bnb-usdc"
      )
        return false;
      return true;
    });
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
      <div
        className="min-h-screen flex items-center justify-center bg-gradient-to-b from-[#000000] to-[#0B3D2E]"
        style={{ paddingTop: "var(--safe-area-inset-top)", paddingBottom: "var(--safe-area-inset-bottom)" }}
      >
        <p className="text-white/60">Loading profile…</p>
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center gap-4 p-4 bg-gradient-to-b from-[#000000] to-[#0B3D2E]"
        style={{ paddingTop: "var(--safe-area-inset-top)", paddingBottom: "var(--safe-area-inset-bottom)" }}
      >
        <p className="text-white/80 text-center">{error || "Profile not found or private"}</p>
        <Button
          variant="ghost"
          onClick={() => navigate("/")}
          className="text-accent-primary hover:text-accent-hover min-h-[44px]"
        >
          Go home
        </Button>
      </div>
    );
  }

  return (
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
            className="p-2 rounded-full hover:bg-white/10 text-white/70 hover:text-white min-w-[44px] min-h-[44px] flex items-center justify-center touch-manipulation"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl sm:text-2xl font-bold flex-1 truncate">Profile</h1>
          {user && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                navigate("/app/watchlist", {
                  state: { addTargetUid: profile.uid, addTargetHandle: profile.xHandle },
                })
              }
              className="text-accent-primary hover:text-accent-hover min-h-[44px] min-w-[44px] touch-manipulation"
            >
              COPE them
            </Button>
          )}
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
                      <h3 className="font-bold text-base sm:text-lg truncate">{xHandle}</h3>
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
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-6 pl-0 sm:pl-4 border-l-0 sm:border-l border-white/10 mt-2 sm:mt-0">
                    <div className="flex flex-col items-center min-w-0 flex-1 sm:flex-initial py-1">
                      <span className="text-lg sm:text-2xl font-bold">{profile.followingCount}</span>
                      <span className="text-[10px] sm:text-xs text-white/60">Following</span>
                    </div>
                    <div className="flex flex-col items-center min-w-0 flex-1 sm:flex-initial py-1">
                      <span className="text-lg sm:text-2xl font-bold">{profile.followersCount}</span>
                      <span className="text-[10px] sm:text-xs text-white/60">Followers</span>
                    </div>
                    <div className="flex flex-col items-center min-w-0 flex-1 sm:flex-initial py-1">
                      <span className="text-lg sm:text-2xl font-bold">{profile.watchlistCount}</span>
                      <span className="text-[10px] sm:text-xs text-white/60">Watchlist</span>
                    </div>
                  </div>
                </div>

                {profile.walletAddress && (
                  <>
                    <div className="mt-4 pt-4 border-t border-white/10">
                      <p className="text-2xl sm:text-3xl font-bold">
                        {usdcBalanceLoading
                          ? "—"
                          : `$${(usdcBalance + openPositions.reduce((s, p) => s + p.value, 0)).toLocaleString(
                              "en-US",
                              { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                            )}`}
                      </p>
                      <p className="text-xs text-white/50 mt-0.5">Total wallet balance</p>
                    </div>
                    <div className="mt-4 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center">
                          <DollarSign className="w-4 h-4 text-white/70" />
                        </div>
                        <div>
                          <p className="text-sm text-white/60">Cash balance</p>
                          <p className="font-semibold">
                            {usdcBalanceLoading
                              ? "—"
                              : `$${usdcBalance.toLocaleString("en-US", {
                                  minimumFractionDigits: 2,
                                  maximumFractionDigits: 2,
                                })}`}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 pt-4 border-t border-white/10">
                      <p className="text-sm font-medium mb-2">Open positions</p>
                      {displayedOpenPositions.length === 0 ? (
                        <p className="text-sm text-white/50">No open positions</p>
                      ) : (
                        <ul className="space-y-2">
                          {displayedOpenPositions.map((pos) => (
                            <li
                              key={pos.mint}
                              className="flex items-center gap-3 py-3 px-2 rounded-lg min-h-[44px] hover:bg-white/5 active:bg-white/10 touch-manipulation cursor-pointer"
                              role="button"
                              onClick={() => navigate(`/token/${pos.mint}`)}
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
                                <p className="font-medium truncate">{pos.symbol}</p>
                                <p className="text-xs text-white/50">
                                  ${pos.value.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                                </p>
                                {pos.pnl != null && pos.pnl !== 0 && (
                                  <p
                                    className={`text-xs mt-0.5 ${
                                      pos.pnl >= 0 ? "text-[#12d585]" : "text-red-400"
                                    }`}
                                  >
                                    {pos.pnl >= 0 ? "+" : ""}${pos.pnl.toFixed(2)}
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
                        <p className="text-sm font-medium">Closed positions</p>
                        <span className="flex items-center gap-1 text-xs text-white/50">
                          <ArrowUpDown className="w-3 h-3" /> Recent
                        </span>
                      </div>
                      {closedPositions.length === 0 ? (
                        <p className="text-sm text-white/50">No closed positions</p>
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
                                <p className="font-medium truncate">{pos.symbol}</p>
                                <p className="text-xs text-white/50">Closed</p>
                              </div>
                              <p className="text-sm text-[#12d585]">+${pos.value.toFixed(2)}</p>
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
                        className="text-xs text-accent-primary hover:text-accent-hover flex items-center gap-1 min-h-[44px] items-center touch-manipulation"
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
  );
}
