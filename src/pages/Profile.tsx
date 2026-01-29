import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import {
  Twitter,
  Wallet,
  Settings,
  LogOut,
  ExternalLink,
  Trash2,
  RefreshCw,
  Bell,
  Users,
  Globe,
  GlobeLock,
  Eye,
  ArrowRight,
} from "lucide-react";
import { shortenAddress } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { getSolBalance } from "@/lib/rpc";
import {
  getUnreadNotificationCount,
  getPushNotificationStatus,
  requestPermissionAndGetFcmToken,
  savePushToken,
  unregisterPushToken,
  getStoredPushToken,
} from "@/lib/notifications";
import { updatePublicWalletStatus } from "@/lib/auth";
import { toast } from "sonner";

export function Profile() {
  const navigate = useNavigate();
  const {
    user,
    userProfile,
    signOut,
    removeWallet,
    loading,
    watchlist,
    updateProfile,
  } = useAuth();
  const [isRemovingWallet, setIsRemovingWallet] = useState(false);
  const [balance, setBalance] = useState<number>(userProfile?.balance || 0);
  const [isRefreshingBalance, setIsRefreshingBalance] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);
  const [pushEnabled, setPushEnabled] = useState(false);
  // Default to public if isPublic is undefined (for existing users)
  const [isPublic, setIsPublic] = useState(userProfile?.isPublic !== false);
  const [isTogglingPublic, setIsTogglingPublic] = useState(false);
  const [isTogglingPush, setIsTogglingPush] = useState(false);

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

  // Fetch real-time balance using RPC
  const fetchBalance = async () => {
    if (!walletAddress) return;

    setIsRefreshingBalance(true);
    try {
      const solBalance = await getSolBalance(walletAddress);
      setBalance(solBalance);
    } catch (error) {
      console.error("Error fetching balance:", error);
      // Keep the stored balance if RPC fails
    } finally {
      setIsRefreshingBalance(false);
    }
  };

  // Fetch balance on mount and when wallet address changes
  useEffect(() => {
    if (walletAddress) {
      fetchBalance();
    } else {
      setBalance(0);
    }
  }, [walletAddress]);

  // Fetch stats
  useEffect(() => {
    if (user) {
      getUnreadNotificationCount(user.uid).then((count) => {
        setNotificationCount(count);
      });

      getPushNotificationStatus(user.uid).then((status) => {
        setPushEnabled(status.enabled && status.permission === "granted");
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
        if (Notification.permission === "denied") {
          toast.error(
            "Notification permission was denied. Please enable it in your browser settings.",
          );
          setIsTogglingPush(false);
          return;
        }

        const token = await requestPermissionAndGetFcmToken();
        if (token) {
          await savePushToken(token);
          setPushEnabled(true);
          toast.success("Push notifications enabled");
        } else {
          // Token is null - could be unsupported browser or permission denied
          // Check permission state to give better error message
          if (Notification.permission === "denied") {
            toast.error(
              "Notification permission denied. Please enable it in your browser settings.",
            );
          } else if (Notification.permission === "default") {
            toast.error("Please allow notifications when prompted");
          } else {
            // Likely unsupported browser (e.g., Safari on iOS)
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

  return (
    <div className="p-4 sm:p-6 max-w-[720px] mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Profile</h1>
      </div>

      {/* User Info */}
      <Card glass className="mb-6">
        <div className="flex items-center gap-4 mb-4">
          {avatar ? (
            <img
              src={avatar}
              alt={xHandle}
              className="w-16 h-16 rounded-full object-cover"
            />
          ) : (
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#12d585] to-[#08b16b] flex items-center justify-center">
              <span className="text-xl font-bold text-[#000000]">
                {xHandle.charAt(1)?.toUpperCase() || "U"}
              </span>
            </div>
          )}
          <div>
            <h3 className="font-bold text-lg">{xHandle}</h3>
            <div className="flex items-center gap-2 text-sm text-white/60">
              <Twitter className="w-4 h-4" />
              <span>Connected</span>
            </div>
          </div>
        </div>

        <div className="pt-4 border-t border-white/6">
          {walletConnected && walletAddress ? (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-white/60">Wallet</span>
                <code className="font-mono">
                  {shortenAddress(walletAddress)}
                </code>
              </div>
              <div className="flex items-center justify-between text-sm mt-2">
                <span className="text-white/60">Balance</span>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{balance.toFixed(4)} SOL</span>
                  <button
                    onClick={fetchBalance}
                    disabled={isRefreshingBalance}
                    className="p-1 hover:bg-white/10 rounded transition-colors disabled:opacity-50"
                    title="Refresh balance"
                  >
                    <RefreshCw
                      className={`w-3 h-3 ${isRefreshingBalance ? "animate-spin" : ""}`}
                    />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-2">
              <p className="text-sm text-white/60">No wallet connected</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate("/auth/wallet-setup")}
                className="mt-2 text-accent-primary hover:text-accent-hover"
              >
                Connect Wallet
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* Stats */}
      <Card glass className="mb-6">
        <h3 className="font-semibold text-lg mb-4">Statistics</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center">
            <div className="flex items-center justify-center mb-2">
              <Users className="w-5 h-5 text-accent-primary" />
            </div>
            <p className="text-2xl font-bold">{watchlist.length}</p>
            <p className="text-xs text-white/60 mt-1">Watched Wallets</p>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center mb-2">
              <Bell className="w-5 h-5 text-accent-primary" />
            </div>
            <p className="text-2xl font-bold">{notificationCount}</p>
            <p className="text-xs text-white/60 mt-1">Notifications</p>
          </div>
        </div>
      </Card>

      {/* Watched Wallets */}
      {watchlist.length > 0 && (
        <Card glass className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-lg">Watched Wallets</h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate("/app/watchlist")}
              className="text-accent-primary hover:text-accent-hover"
            >
              View All
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
          <div className="space-y-2">
            {watchlist.slice(0, 3).map((wallet) => (
              <div
                key={wallet.address}
                className="flex items-center justify-between p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
                onClick={() => navigate(`/scanner/wallet/${wallet.address}`)}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Eye className="w-4 h-4 text-accent-primary flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">
                      {wallet.nickname || shortenAddress(wallet.address)}
                    </p>
                    <p className="text-xs text-white/50 font-mono truncate">
                      {shortenAddress(wallet.address)}
                    </p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-white/40 flex-shrink-0" />
              </div>
            ))}
            {watchlist.length > 3 && (
              <p className="text-xs text-white/60 text-center pt-2">
                +{watchlist.length - 3} more wallet
                {watchlist.length - 3 !== 1 ? "s" : ""}
              </p>
            )}
          </div>
        </Card>
      )}

      {/* Settings */}
      <Card glass className="mb-6">
        <h3 className="font-semibold text-lg mb-4">Settings</h3>
        <div className="space-y-4">
          {/* Push Notifications Toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bell className="w-5 h-5 text-white/70" />
              <div>
                <p className="font-medium">Push Notifications</p>
                <p className="text-xs text-white/60">
                  Get notified about watched wallet trades
                </p>
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
            <div className="flex items-center justify-between pt-4 border-t border-white/6">
              <div className="flex items-center gap-3">
                {isPublic ? (
                  <Globe className="w-5 h-5 text-accent-primary" />
                ) : (
                  <GlobeLock className="w-5 h-5 text-white/70" />
                )}
                <div>
                  <p className="font-medium">Public Wallet</p>
                  <p className="text-xs text-white/60">
                    {isPublic
                      ? "Your wallet is visible to others"
                      : "Your wallet is private"}
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
        </div>
      </Card>

      {/* Actions */}
      <div className="space-y-3">
        {walletAddress && (
          <Card
            className="cursor-pointer hover:border-white/20"
            onClick={() => navigate("/wallet/fund")}
          >
            <div className="flex items-center gap-3">
              <Wallet className="w-5 h-5 text-white/70" />
              <span className="font-medium">Fund Wallet</span>
            </div>
          </Card>
        )}

        {walletAddress && (
          <Card
            className="cursor-pointer hover:border-white/20"
            onClick={() =>
              window.open(
                `https://solscan.io/account/${walletAddress}`,
                "_blank",
              )
            }
          >
            <div className="flex items-center gap-3">
              <ExternalLink className="w-5 h-5 text-white/70" />
              <span className="font-medium">View on Explorer</span>
            </div>
          </Card>
        )}

        {walletAddress && (
          <Card
            className="cursor-pointer hover:border-[#FF4757]/20 border-[#FF4757]/10"
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
                navigate("/auth/wallet-setup");
              } catch (error) {
                console.error("Remove wallet error:", error);
              } finally {
                setIsRemovingWallet(false);
              }
            }}
          >
            <div className="flex items-center gap-3">
              <Trash2 className="w-5 h-5 text-[#FF4757]" />
              <span className="font-medium text-[#FF4757]">
                {isRemovingWallet ? "Removing..." : "Remove Wallet"}
              </span>
            </div>
          </Card>
        )}

        <Button
          variant="outline"
          className="w-full h-10 text-[#FF4757] hover:bg-[#FF4757]/10"
          onClick={async () => {
            try {
              await signOut();
              navigate("/");
            } catch (error) {
              console.error("Sign out error:", error);
            }
          }}
          disabled={loading}
        >
          <LogOut className="w-5 h-5" />
          Disconnect
        </Button>
      </div>
    </div>
  );
}
