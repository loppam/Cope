import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { motion } from "motion/react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import {
  Twitter,
  LogOut,
  ExternalLink,
  Trash2,
  Bell,
  Globe,
  GlobeLock,
  Settings,
  DollarSign,
  ArrowUpDown,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { shortenAddress } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { getTokenAccounts } from "@/lib/rpc";
import {
  getPushNotificationStatus,
  requestPermissionAndGetPushToken,
  savePushTokenWithPlatform,
  unregisterPushToken,
  getStoredPushToken,
} from "@/lib/notifications";
import { updatePublicWalletStatus } from "@/lib/auth";
import { syncWebhook } from "@/lib/webhook";
import { getFollowersCount } from "@/lib/profile";
import { getWalletPositions } from "@/lib/solanatracker";
import { toast } from "sonner";
import type { WatchedWallet } from "@/lib/auth";
import { SOLANA_USDC_MINT, SOL_MINT } from "@/lib/constants";

interface TokenPosition {
  mint: string;
  symbol: string;
  name: string;
  image?: string;
  amount: number;
  value: number;
}

export function Profile() {
  const navigate = useNavigate();
  const { user, userProfile, signOut, removeWallet, deleteAccount, loading, watchlist } =
    useAuth();
  const [isRemovingWallet, setIsRemovingWallet] = useState(false);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [usdcBalance, setUsdcBalance] = useState<number>(0);
  const [openPositions, setOpenPositions] = useState<TokenPosition[]>([]);
  const [closedPositions, setClosedPositions] = useState<TokenPosition[]>([]);
  const [followersCount, setFollowersCount] = useState<number | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [isPublic, setIsPublic] = useState(userProfile?.isPublic !== false);
  const [isTogglingPublic, setIsTogglingPublic] = useState(false);
  const [isTogglingPush, setIsTogglingPush] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const following = watchlist.filter(
    (w): w is WatchedWallet & { uid: string } =>
      w.onPlatform === true && !!w.uid,
  );
  const watchlistExternal = watchlist.filter((w) => !w.onPlatform);

  // Get user data from Firebase or use defaults
  const xHandle =
    userProfile?.xHandle ||
    userProfile?.displayName ||
    user?.displayName ||
    "@user";
  const avatar =
    userProfile?.avatar || userProfile?.photoURL || user?.photoURL || "";
  const walletAddress = userProfile?.walletAddress || null;
  const walletConnected = userProfile?.walletConnected || false;

  // Fetch real-time balance (SOL) and USDC using RPC
  const fetchBalance = async () => {
    if (!walletAddress) return;
    try {
      const tokenAccounts = await getTokenAccounts(walletAddress);
      const usdcAccount = tokenAccounts.find((a) => a.mint === SOLANA_USDC_MINT);
      setUsdcBalance(usdcAccount?.uiAmount ?? 0);
    } catch (error) {
      console.error("Error fetching balance:", error);
    }
  };

  // Fetch balance on mount and when wallet address changes
  useEffect(() => {
    if (walletAddress) {
      fetchBalance();
    } else {
      setUsdcBalance(0);
    }
  }, [walletAddress]);

  // Fetch open token positions (exclude SOL and USDC)
  useEffect(() => {
    if (!walletAddress) {
      setOpenPositions([]);
      setClosedPositions([]);
      return;
    }
    getWalletPositions(walletAddress, false)
      .then((res) => {
        const tokens: TokenPosition[] = [];
        for (const t of res.tokens) {
          const mint = t.token.mint;
          if (mint === SOL_MINT || mint === SOLANA_USDC_MINT) continue;
          const value = t.value || 0;
          if (value <= 0) continue;
          tokens.push({
            mint,
            symbol: t.token.symbol || mint.slice(0, 8),
            name: t.token.name || "Unknown",
            image: t.token.image,
            amount: t.balance ?? 0,
            value,
          });
        }
        setOpenPositions(tokens);
        setClosedPositions([]); // TODO: closed positions from history when available
      })
      .catch(() => {
        setOpenPositions([]);
        setClosedPositions([]);
      });
  }, [walletAddress]);

  // Fetch stats
  useEffect(() => {
    if (user) {
      getPushNotificationStatus().then((status) => {
        setPushEnabled(status.enabled && status.permission === "granted");
      });

      user.getIdToken().then((token) => {
        getFollowersCount(token)
          .then(setFollowersCount)
          .catch(() => setFollowersCount(0));
      });
    }
  }, [user]);

  const handleTogglePublic = async () => {
    if (!user) return;

    setIsTogglingPublic(true);
    try {
      const newValue = !isPublic;
      await updatePublicWalletStatus(user.uid, newValue);
      setIsPublic(newValue);
      toast.success(
        newValue ? "Wallet is now public" : "Wallet is now private",
      );
      // Sync webhook so private users' addresses are removed from Helius
      syncWebhook().catch(() => {});
    } catch (error) {
      console.error("Error toggling public wallet:", error);
      toast.error("Failed to update wallet visibility");
    } finally {
      setIsTogglingPublic(false);
    }
  };

  const handleTogglePush = async () => {
    if (!user) return;

    setIsTogglingPush(true);
    try {
      if (!pushEnabled) {
        // Check if notifications are supported
        if (typeof Notification === "undefined") {
          toast.error("Push notifications are not supported on this device");
          setIsTogglingPush(false);
          return;
        }

        // Check current permission
        const permBefore = Notification.permission;
        if (permBefore === "denied") {
          toast.error(
            "Notification permission was denied. Please enable it in your browser settings.",
          );
          setIsTogglingPush(false);
          return;
        }

        // Get push token (automatically uses FCM or Web Push based on browser)
        const result = await requestPermissionAndGetPushToken();
        if (result && result.token) {
          await savePushTokenWithPlatform(result.token, result.platform);
          setPushEnabled(true);
          toast.success("Push notifications enabled");
        } else {
          // Token is null - re-check permission (may have changed during request)
          const permAfter = Notification.permission;
          if (permAfter === "denied") {
            toast.error(
              "Notification permission denied. Please enable it in your browser settings.",
            );
          } else if (permAfter === "default") {
            toast.error("Please allow notifications when prompted");
          } else {
            // Likely unsupported browser
            toast.info("Push notifications are not supported on this browser");
          }
        }
      } else {
        const token = getStoredPushToken();
        await unregisterPushToken(token || "");
        setPushEnabled(false);
        toast.success("Push notifications disabled");
      }
    } catch (error: any) {
      console.error("Error toggling push notifications:", error);
      const errorMessage = error?.message || "";
      if (
        errorMessage.includes("unsupported") ||
        errorMessage.includes("not supported")
      ) {
        toast.info("Push notifications are not supported on this browser");
      } else {
        toast.error("Failed to update push notification settings");
      }
    } finally {
      setIsTogglingPush(false);
    }
  };

  const container = {
    animate: {
      transition: {
        staggerChildren: 0.06,
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

  return (
    <motion.div
      className="p-4 sm:p-6 max-w-[720px] mx-auto pb-8"
      variants={container}
      initial="initial"
      animate="animate"
    >
      <motion.div className="mb-6 flex items-center justify-between" variants={item}>
        <h1 className="text-2xl font-bold">Profile</h1>
        <button
          onClick={() => setSettingsOpen(true)}
          className="p-2 rounded-full hover:bg-white/10 text-white/70 hover:text-white"
          aria-label="Settings"
        >
          <Settings className="w-5 h-5" />
        </button>
      </motion.div>

      {/* User + Stats merged card */}
      <motion.div variants={item} className="mb-6">
        <Card glass className="overflow-hidden">
          <div className="relative">
            {/* Subtle gradient header strip */}
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
                      <span>Connected</span>
                    </div>
                          <button className="text-sm text-accent-primary hover:underline mt-0.5">
                      + Add a bio
                    </button>
                    {walletConnected && walletAddress && (
                      <div className="flex items-center gap-2 mt-1 min-w-0 overflow-hidden">
                        <code className="text-xs font-mono text-white/50 truncate">
                          {shortenAddress(walletAddress)}
                        </code>
                      </div>
                    )}
                  </div>
                </div>

                {/* Stats row - integrated */}
                <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-6 pl-0 sm:pl-4 border-l-0 sm:border-l border-white/10 mt-2 sm:mt-0">
                  <button
                    onClick={() =>
                      navigate("/app/watchlist", {
                        state: { tab: "following" },
                      })
                    }
                    className="flex flex-col items-center min-w-0 flex-1 sm:flex-initial hover:opacity-80 transition-opacity py-1 active:scale-95"
                  >
                    <span className="text-lg sm:text-2xl font-bold">
                      {following.length}
                    </span>
                    <span className="text-[10px] sm:text-xs text-white/60">
                      Following
                    </span>
                  </button>
                  <button
                    onClick={() =>
                      navigate("/app/watchlist", {
                        state: { tab: "followers" },
                      })
                    }
                    className="flex flex-col items-center min-w-0 flex-1 sm:flex-initial hover:opacity-80 transition-opacity py-1 active:scale-95"
                  >
                    <span className="text-lg sm:text-2xl font-bold">
                      {followersCount ?? "—"}
                    </span>
                    <span className="text-[10px] sm:text-xs text-white/60">
                      Followers
                    </span>
                  </button>
                  <button
                    onClick={() =>
                      navigate("/app/watchlist", {
                        state: { tab: "watchlist" },
                      })
                    }
                    className="flex flex-col items-center min-w-0 flex-1 sm:flex-initial hover:opacity-80 transition-opacity py-1 active:scale-95"
                  >
                    <span className="text-lg sm:text-2xl font-bold">
                      {watchlistExternal.length}
                    </span>
                    <span className="text-[10px] sm:text-xs text-white/60">
                      Watchlist
                    </span>
                  </button>
                </div>
              </div>

              {/* Cash balance + performance placeholder - when connected */}
              {walletConnected && walletAddress && (
                <>
                  <div className="mt-4 pt-4 border-t border-white/10">
                    <p className="text-2xl sm:text-3xl font-bold">
                      ${usdcBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center">
                        <DollarSign className="w-4 h-4 text-white/70" />
                      </div>
                      <div>
                        <p className="text-sm text-white/60">Cash balance</p>
                        <p className="font-semibold">
                          ${usdcBalance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => navigate("/wallet/fund")}
                        className="w-9 h-9 min-w-[44px] min-h-[44px] rounded-full bg-white/10 hover:bg-white/15 flex items-center justify-center text-lg font-medium touch-manipulation"
                        aria-label="Deposit"
                      >
                        +
                      </button>
                      <button
                        onClick={() => navigate("/wallet/withdraw")}
                        className="w-9 h-9 min-w-[44px] min-h-[44px] rounded-full bg-white/10 hover:bg-white/15 flex items-center justify-center text-white/70 touch-manipulation"
                        aria-label="Withdraw"
                      >
                        …
                      </button>
                    </div>
                  </div>
                  <div className="mt-4 pt-4 border-t border-white/10">
                    <button
                      onClick={() => navigate("/app/trade")}
                      className="text-sm font-medium mb-2 block w-full text-left py-2 -mx-2 px-2 rounded-lg min-h-[44px] flex items-center hover:bg-white/5 active:bg-white/10 hover:text-accent-primary transition-colors touch-manipulation"
                    >
                      Open positions
                    </button>
                    {openPositions.length === 0 ? (
                      <p className="text-sm text-white/50">No open positions</p>
                    ) : (
                      <ul className="space-y-2">
                        {openPositions.map((pos) => (
                          <li
                            key={pos.mint}
                            className="flex items-center gap-3 py-3 px-2 rounded-lg min-h-[44px] hover:bg-white/5 active:bg-white/10 touch-manipulation"
                            role="button"
                            onClick={() => navigate(`/token/${pos.mint}`)}
                          >
                            {pos.image ? (
                              <img src={pos.image} alt="" className="w-8 h-8 rounded-full object-cover" />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-white/10" />
                            )}
                            <div className="flex-1 min-w-0">
                              <p className="font-medium truncate">{pos.symbol}</p>
                              <p className="text-xs text-white/50">${pos.value.toLocaleString("en-US", { minimumFractionDigits: 2 })}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="mt-4 pt-4 border-t border-white/10">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium">Closed positions</p>
                      <button className="flex items-center gap-1 text-xs text-white/50 hover:text-white/70">
                        Sort by <ArrowUpDown className="w-3 h-3" /> Recent
                      </button>
                    </div>
                    {closedPositions.length === 0 ? (
                      <p className="text-sm text-white/50">No closed positions</p>
                    ) : (
                      <ul className="space-y-2">
                        {closedPositions.map((pos) => (
                          <li key={pos.mint} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5">
                            {pos.image ? (
                              <img src={pos.image} alt="" className="w-8 h-8 rounded-full object-cover" />
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
                      href={`https://solscan.io/account/${walletAddress}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-accent-primary hover:text-accent-hover flex items-center gap-1"
                    >
                      View on Explorer
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </>
              )}

              {!walletConnected && (
                <div className="mt-4 pt-4 border-t border-white/6 text-center">
                  <p className="text-sm text-white/60 mb-2">
                    No wallet connected
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate("/auth/wallet-setup")}
                    className="text-accent-primary hover:text-accent-hover"
                  >
                    Connect Wallet
                  </Button>
                </div>
              )}
            </div>
          </div>
        </Card>
      </motion.div>

      {/* Settings sheet (cog) */}
      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side="right" className="bg-[#0f0f0f] border-white/10 text-white w-[90vw] max-w-sm sm:w-full">
          <SheetHeader>
            <SheetTitle className="text-white">Settings</SheetTitle>
          </SheetHeader>
          <div className="mt-6 space-y-1 overflow-y-auto flex-1 min-h-0 pb-8">
            {/* Push Notifications Toggle */}
            <div className="flex items-center justify-between gap-3 py-3 rounded-xl hover:bg-white/5 active:bg-white/10 -mx-2 px-3 transition-colors min-h-[44px] touch-manipulation">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0">
                  <Bell className="w-4 h-4 text-white/70" />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-sm">Push Notifications</p>
                  <p className="text-xs text-white/60">Get notified about watched wallet trades</p>
                </div>
              </div>
              <button
                onClick={handleTogglePush}
                disabled={isTogglingPush}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  pushEnabled ? "bg-accent-primary" : "bg-white/20"
                } disabled:opacity-50`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    pushEnabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            {/* Public Wallet Toggle */}
            {walletAddress && (
              <div className="flex items-center justify-between gap-3 py-3 rounded-xl hover:bg-white/5 active:bg-white/10 -mx-2 px-3 transition-colors border-t border-white/6 min-h-[44px] touch-manipulation">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-lg bg-white/5 flex items-center justify-center flex-shrink-0">
                    {isPublic ? (
                      <Globe className="w-4 h-4 text-accent-primary" />
                    ) : (
                      <GlobeLock className="w-4 h-4 text-white/70" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-sm">Public Wallet</p>
                    <p className="text-xs text-white/60">
                      {isPublic ? "Your wallet is visible to others" : "Your wallet is private"}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleTogglePublic}
                  disabled={isTogglingPublic}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    isPublic ? "bg-accent-primary" : "bg-white/20"
                  } disabled:opacity-50`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      isPublic ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            )}

            {/* Remove Wallet */}
            {walletAddress && (
              <button
                onClick={async () => {
                  if (
                    !confirm(
                      "Are you sure you want to remove your wallet? You will need to set it up again.",
                    )
                  ) {
                    return;
                  }
                  setIsRemovingWallet(true);
                  try {
                    await removeWallet();
                    setSettingsOpen(false);
                    navigate("/auth/wallet-setup");
                  } catch (error) {
                    console.error("Remove wallet error:", error);
                  } finally {
                    setIsRemovingWallet(false);
                  }
                }}
                className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-[#FF4757]/10 active:bg-[#FF4757]/15 transition-colors text-left group min-h-[48px] mt-2"
              >
                <div className="w-9 h-9 rounded-lg bg-[#FF4757]/10 flex items-center justify-center flex-shrink-0">
                  <Trash2 className="w-4 h-4 text-[#FF4757]" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-[#FF4757]">
                    {isRemovingWallet ? "Removing..." : "Remove Wallet"}
                  </p>
                  <p className="text-xs text-white/60">Disconnect and delete wallet from account</p>
                </div>
              </button>
            )}

            {/* Delete account */}
            <button
              onClick={() => {
                setSettingsOpen(false);
                setShowDeleteConfirmModal(true);
              }}
              className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-[#FF4757]/10 active:bg-[#FF4757]/15 transition-colors text-left group min-h-[48px]"
            >
              <div className="w-9 h-9 rounded-lg bg-[#FF4757]/10 flex items-center justify-center flex-shrink-0">
                <Trash2 className="w-4 h-4 text-[#FF4757]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-[#FF4757]">Delete account</p>
                <p className="text-xs text-white/60">Permanently delete your account and all data</p>
              </div>
            </button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Delete account confirmation modal - double verification */}
      <AlertDialog open={showDeleteConfirmModal} onOpenChange={setShowDeleteConfirmModal}>
        <AlertDialogContent className="bg-[#0f0f0f] border-white/10 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete account?</AlertDialogTitle>
            <AlertDialogDescription className="text-white/70">
              This will permanently delete your account and all data from our platform. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-white/10 border-white/10 text-white hover:bg-white/15">
              Cancel
            </AlertDialogCancel>
            <button
              onClick={async () => {
                setIsDeletingAccount(true);
                try {
                  await deleteAccount();
                  setShowDeleteConfirmModal(false);
                  navigate("/");
                } catch {
                  // toast already shown by deleteAccount
                } finally {
                  setIsDeletingAccount(false);
                }
              }}
              disabled={isDeletingAccount}
              className="bg-[#FF4757] hover:bg-[#FF4757]/90 text-white px-4 py-2 rounded-lg font-medium disabled:opacity-50"
            >
              {isDeletingAccount ? "Deleting…" : "Delete my account"}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Disconnect */}
      <motion.div variants={item}>
        <Card glass className="overflow-hidden border-white/10">
          <div className="p-4 sm:p-6">
            <button
              onClick={async () => {
                try {
                  await signOut();
                  navigate("/");
                } catch (error) {
                  console.error("Sign out error:", error);
                }
              }}
              disabled={loading}
              className="w-full flex items-center justify-center gap-3 py-3 min-h-[48px] rounded-xl border border-white/10 hover:border-[#FF4757]/30 hover:bg-[#FF4757]/5 active:bg-[#FF4757]/10 text-[#FF4757] transition-all duration-200 disabled:opacity-50"
            >
              <LogOut className="w-5 h-5" />
              <span className="font-medium">Disconnect</span>
            </button>
          </div>
        </Card>
      </motion.div>
    </motion.div>
  );
}
