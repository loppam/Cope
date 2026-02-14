import { useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Bell, ExternalLink, Check, Trash2, Copy } from "lucide-react";
import { useNavigate } from "react-router";
import { shortenAddress } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import {
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  WalletNotification,
  requestPermissionAndGetFcmToken,
  savePushToken,
  getPushNotificationStatus,
} from "@/lib/notifications";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { apiCache, UI_CACHE_TTL_MS } from "@/lib/cache";
import { toast } from "sonner";
import { DocumentHead } from "@/components/DocumentHead";

export function Alerts() {
  const navigate = useNavigate();
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [notifications, setNotifications] = useState<WalletNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [filter, setFilter] = useState<
    "all" | "unread" | "buy" | "sell" | "swap"
  >("all");

  // One-time fetch + refetch on focus/interval (cuts Firestore reads vs onSnapshot)
  const REFETCH_INTERVAL_MS = 60 * 1000;
  const NOTIFICATIONS_LIMIT = 50;

  useEffect(() => {
    if (!isAuthenticated || !user) {
      setLoading(false);
      return;
    }

    const cacheKey = `notifications_${user.uid}`;
    const cached = apiCache.get<WalletNotification[]>(cacheKey);
    if (cached) {
      setNotifications(cached);
      setUnreadCount(cached.filter((n) => !n.read).length);
      setLoading(false);
    }

    const notificationsRef = collection(db, "notifications");

    async function fetchNotifications() {
      try {
        const q = query(
          notificationsRef,
          where("userId", "==", user!.uid),
          orderBy("createdAt", "desc"),
          limit(NOTIFICATIONS_LIMIT),
        );
        let snapshot;
        try {
          snapshot = await getDocs(q);
        } catch (err: any) {
          if (err?.code === "failed-precondition") {
            const fallbackQ = query(
              notificationsRef,
              where("userId", "==", user!.uid),
              limit(NOTIFICATIONS_LIMIT),
            );
            snapshot = await getDocs(fallbackQ);
          } else {
            throw err;
          }
        }
        const fetched = snapshot.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }) as WalletNotification)
          .filter((n: any) => !n.deleted)
          .sort((a: any, b: any) => {
            const aTime = a.createdAt?.toDate?.()?.getTime() || 0;
            const bTime = b.createdAt?.toDate?.()?.getTime() || 0;
            return bTime - aTime;
          });
        setNotifications(fetched);
        setUnreadCount(fetched.filter((n) => !n.read).length);
        apiCache.set(cacheKey, fetched, UI_CACHE_TTL_MS);
      } catch (error) {
        console.error("Error fetching notifications:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchNotifications();

    getPushNotificationStatus().then((status) => {
      setPushEnabled(status.enabled && status.permission === "granted");
    });

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") fetchNotifications();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    const intervalId = setInterval(() => {
      if (document.visibilityState === "visible") fetchNotifications();
    }, REFETCH_INTERVAL_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearInterval(intervalId);
    };
  }, [user, isAuthenticated]);

  // Request push notification permission on first visit
  useEffect(() => {
    if (!user || !isAuthenticated || pushEnabled) return;

    const requestPushPermission = async () => {
      try {
        const token = await requestPermissionAndGetFcmToken();
        if (token) {
          await savePushToken(token);
          setPushEnabled(true);
          toast.success("Push notifications enabled");
        }
      } catch (error) {
        console.error("Error setting up push notifications:", error);
      }
    };

    const timer = setTimeout(() => {
      requestPushPermission();
    }, 2000);

    return () => clearTimeout(timer);
  }, [user, isAuthenticated, pushEnabled]);

  const handleMarkAsRead = async (notificationId: string) => {
    try {
      await markNotificationAsRead(notificationId);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n)),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (error) {
      toast.error("Failed to mark notification as read");
    }
  };

  const handleMarkAllAsRead = async () => {
    if (!user) return;
    try {
      await markAllNotificationsAsRead(user.uid);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
      toast.success("All notifications marked as read");
    } catch (error) {
      toast.error("Failed to mark all as read");
    }
  };

  const handleDelete = async (notificationId: string) => {
    try {
      await deleteNotification(notificationId);
      setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
      if (!notifications.find((n) => n.id === notificationId)?.read) {
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
    } catch (error) {
      toast.error("Failed to delete notification");
    }
  };

  const formatCurrency = (value: number | undefined | null) => {
    const numValue = value ?? 0;
    if (numValue >= 1000000) {
      return `$${(numValue / 1000000).toFixed(2)}M`;
    }
    if (numValue >= 1000) {
      return `$${(numValue / 1000).toFixed(2)}K`;
    }
    return `$${numValue.toFixed(2)}`;
  };

  const formatTokenAmount = (value: number | undefined | null) => {
    if (value == null || Number.isNaN(value)) return null;
    const abs = Math.abs(value);
    if (abs >= 1000000) return `${(value / 1000000).toFixed(2)}M`;
    if (abs >= 1000) return `${(value / 1000).toFixed(2)}K`;
    const maximumFractionDigits = abs >= 1 ? 4 : 6;
    return value.toLocaleString("en-US", { maximumFractionDigits });
  };

  const getAmountLabel = (notification: WalletNotification) => {
    if (notification.amount != null && notification.amountSymbol) {
      const formatted = formatTokenAmount(notification.amount);
      return formatted ? `${formatted} ${notification.amountSymbol}` : null;
    }
    if (notification.amountUsd != null) {
      return formatCurrency(notification.amountUsd);
    }
    return null;
  };

  const formatTime = (timestamp: any) => {
    if (!timestamp) return "Just now";

    // Handle Firestore timestamp
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#000000] to-[#0B3D2E] flex items-center justify-center">
        <div className="text-white/60">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#000000] to-[#0B3D2E] p-6">
        <div className="max-w-[720px] mx-auto">
          <h1 className="text-2xl font-bold mb-8">Alerts</h1>
          <Card className="text-center py-12">
            <Bell className="w-12 h-12 mx-auto mb-4 text-white/30" />
            <p className="text-white/60 mb-4">Please sign in to view alerts</p>
            <Button onClick={() => (window.location.href = "/auth/x-connect")}>
              Sign In
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  // Filter notifications based on selected filter
  const filteredNotifications = notifications.filter((n) => {
    if (filter === "unread") return !n.read;
    if (filter === "buy") return n.type === "buy";
    if (filter === "sell") return n.type === "sell";
    if (filter === "swap") return n.type === "swap";
    return true;
  });

  const unreadNotifications = filteredNotifications.filter((n) => !n.read);
  const readNotifications = filteredNotifications.filter((n) => n.read);

  return (
    <>
      <DocumentHead
        title="Alerts"
        description="Manage your trading alerts and notifications on COPE"
      />
      <div className="min-h-screen bg-gradient-to-b from-[#000000] to-[#0B3D2E] p-4 sm:p-6 pb-8">
      <div className="max-w-[720px] mx-auto">
        <div className="mb-4 sm:mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold mb-1 sm:mb-2">
              Alerts
            </h1>
            {unreadCount > 0 && (
              <p className="text-white/60 text-sm">
                {unreadCount} unread notification{unreadCount !== 1 ? "s" : ""}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleMarkAllAsRead}
                className="min-h-[44px]"
              >
                <Check className="w-4 h-4" />
                Mark all read
              </Button>
            )}
          </div>
        </div>

        {/* Filter Tabs */}
        {notifications.length > 0 && (
          <div className="mb-4 flex gap-2 overflow-x-auto pb-2 -mx-1 scrollbar-hide">
            {[
              { value: "all", label: "All" },
              { value: "unread", label: "Unread" },
              { value: "buy", label: "Buys" },
              { value: "sell", label: "Sells" },
              { value: "swap", label: "Swaps" },
            ].map((filterOption) => (
              <button
                key={filterOption.value}
                onClick={() => setFilter(filterOption.value as any)}
                className={`px-3 sm:px-4 py-2 min-h-[40px] rounded-xl text-sm font-medium whitespace-nowrap transition-all flex-shrink-0 ${
                  filter === filterOption.value
                    ? "bg-accent-primary text-[#000000]"
                    : "bg-white/5 text-white/60 hover:bg-white/10"
                }`}
              >
                {filterOption.label}
              </button>
            ))}
          </div>
        )}

        {filteredNotifications.length === 0 ? (
          <Card glass className="overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-accent-purple/40 via-accent-purple/20 to-transparent" />
            <div className="text-center py-10 sm:py-12 px-4">
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-4">
                <Bell className="w-8 h-8 sm:w-10 sm:h-10 text-white/30" />
              </div>
              <h3 className="text-lg sm:text-xl font-semibold mb-2">
                No Alerts Yet
              </h3>
              <p className="text-white/60 text-center max-w-sm mx-auto mb-6 text-sm sm:text-base">
                {filter === "all"
                  ? "You'll get notified when wallets you're COPEing make new trades"
                  : `No ${filter === "unread" ? "unread" : filter === "buy" ? "buy" : filter === "sell" ? "sell" : "swap"} notifications`}
              </p>
              {filter === "all" && (
                <Button
                  onClick={() => (window.location.href = "/scanner")}
                  className="min-h-[48px]"
                >
                  Find Wallets to COPE
                </Button>
              )}
            </div>
          </Card>
        ) : (
          <div className="space-y-4">
            {/* Unread Notifications */}
            {unreadNotifications.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-white mb-3">Unread</h2>
                <div className="space-y-2">
                  {unreadNotifications.map((notification) => {
                    const amountLabel = getAmountLabel(notification);
                    return (
                      <Card
                        key={notification.id}
                        glass
                        className={`overflow-hidden border-l-4 ${
                          notification.type === "buy"
                            ? "border-[#12d585]"
                            : notification.type === "sell"
                              ? "border-[#FF6B6B]"
                              : "border-[#54A0FF]"
                        }`}
                      >
                        <div className="p-4 sm:p-5">
                          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <h3 className="font-semibold text-white truncate">
                                  {notification.title}
                                </h3>
                                {!notification.read && (
                                  <span className="w-2 h-2 rounded-full bg-[#12d585]"></span>
                                )}
                              </div>
                              <p className="text-sm text-white mb-2 line-clamp-2">
                                {notification.message}
                              </p>
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/90">
                                <code className="font-mono">
                                  {shortenAddress(notification.walletAddress)}
                                </code>
                                {amountLabel && (
                                  <span>
                                    {amountLabel}
                                  </span>
                                )}
                                <span>{formatTime(notification.createdAt)}</span>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                              {notification.tokenAddress && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    navigate("/app/trade", {
                                      state: {
                                        mint: notification.tokenAddress,
                                        fromFeed: true,
                                      },
                                    });
                                  }}
                                  className="text-accent-primary hover:text-accent-hover"
                                  title="Copy Trade"
                                >
                                  <Copy className="w-4 h-4" />
                                </Button>
                              )}
                              {notification.txHash && (
                                <a
                                  href={`https://solscan.io/tx/${notification.txHash}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[#12d585] hover:text-[#08b16b] p-1 hover:bg-white/10 rounded transition-colors"
                                  title="View on Solscan"
                                >
                                  <ExternalLink className="w-4 h-4" />
                                </a>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleMarkAsRead(notification.id)}
                                title="Mark as read"
                              >
                                <Check className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDelete(notification.id)}
                                className="text-[#FF4757] hover:text-[#FF4757] hover:bg-[#FF4757]/10"
                                title="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                          </div>
                        </div>
                      </div>
                    </Card>
                  );
                  })}
                </div>
              </div>
            )}

            {/* Read Notifications */}
            {readNotifications.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-white mb-3">Read</h2>
                <div className="space-y-2">
                  {readNotifications.map((notification) => {
                    const amountLabel = getAmountLabel(notification);
                    return (
                      <Card
                        key={notification.id}
                        glass
                        className={`opacity-60 overflow-hidden border-l-4 ${
                          notification.type === "buy"
                            ? "border-[#12d585]"
                            : notification.type === "sell"
                              ? "border-[#FF6B6B]"
                              : "border-[#54A0FF]"
                        }`}
                      >
                        <div className="p-4 sm:p-5">
                          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <h3 className="font-semibold mb-1 text-white truncate">
                                {notification.title}
                              </h3>
                              <p className="text-sm text-white mb-2 line-clamp-2">
                                {notification.message}
                              </p>
                              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/90">
                                <code className="font-mono">
                                  {shortenAddress(notification.walletAddress)}
                                </code>
                                {amountLabel && (
                                  <span>
                                    {amountLabel}
                                  </span>
                                )}
                                <span>{formatTime(notification.createdAt)}</span>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
                              {notification.tokenAddress && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    navigate("/app/trade", {
                                      state: {
                                        mint: notification.tokenAddress,
                                        fromFeed: true,
                                      },
                                    });
                                  }}
                                  className="text-accent-primary hover:text-accent-hover"
                                  title="Copy Trade"
                                >
                                  <Copy className="w-4 h-4" />
                                </Button>
                              )}
                              {notification.txHash && (
                                <a
                                  href={`https://solscan.io/tx/${notification.txHash}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[#12d585] hover:text-[#08b16b] p-1 hover:bg-white/10 rounded transition-colors"
                                  title="View on Solscan"
                                >
                                  <ExternalLink className="w-4 h-4" />
                                </a>
                              )}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleDelete(notification.id)}
                                className="text-[#FF4757] hover:text-[#FF4757] hover:bg-[#FF4757]/10"
                                title="Delete"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                          </div>
                        </div>
                      </div>
                    </Card>
                  );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    </>
  );
}
