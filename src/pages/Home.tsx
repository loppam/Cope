import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { motion } from "motion/react";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import {
  Search,
  ScanLine,
  TrendingUp,
  Copy,
  ExternalLink,
  Loader2,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { WalletNotification } from "@/lib/notifications";
import { shortenAddress, formatCurrency } from "@/lib/utils";
import { toast } from "sonner";

export function Home() {
  const navigate = useNavigate();
  const { user, watchlist } = useAuth();
  const [notifications, setNotifications] = useState<WalletNotification[]>([]);
  const [loading, setLoading] = useState(true);

  // One-time fetch + refetch on focus/interval (cuts Firestore reads vs onSnapshot)
  const REFETCH_INTERVAL_MS = 60 * 1000;
  const NOTIFICATIONS_LIMIT = 50;

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    const watchedAddresses = watchlist.map((w) => w.address);
    if (watchedAddresses.length === 0) {
      setNotifications([]);
      setLoading(false);
      return;
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
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter(
            (n: any) =>
              !n.deleted && watchedAddresses.includes(n.walletAddress),
          )
          .sort((a: any, b: any) => {
            const aTime = a.createdAt?.toDate?.()?.getTime() || 0;
            const bTime = b.createdAt?.toDate?.()?.getTime() || 0;
            return bTime - aTime;
          }) as WalletNotification[];
        setNotifications(fetched);
      } catch (error) {
        console.error("Error fetching notifications:", error);
      } finally {
        setLoading(false);
      }
    }

    fetchNotifications();

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
  }, [user, watchlist]);

  const formatTime = (timestamp: any) => {
    if (!timestamp) return "Just now";

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

  const getWalletNickname = (walletAddress: string) => {
    const watched = watchlist.find((w) => w.address === walletAddress);
    return watched?.nickname || shortenAddress(walletAddress);
  };

  const handleCopyTrade = (notification: WalletNotification) => {
    if (!notification.tokenAddress) {
      toast.error("No token address available for this trade");
      return;
    }

    navigate("/app/trade", {
      state: {
        mint: notification.tokenAddress,
        fromFeed: true,
        walletNickname: getWalletNickname(notification.walletAddress),
      },
    });
  };

  const getTradeIcon = (type: string) => {
    switch (type) {
      case "buy":
        return <ArrowDownRight className="w-4 h-4 text-[#12d585]" />;
      case "sell":
        return <ArrowUpRight className="w-4 h-4 text-[#FF6B6B]" />;
      case "swap":
        return <ArrowDownRight className="w-4 h-4 text-[#54A0FF]" />;
      default:
        return <TrendingUp className="w-4 h-4 text-white/60" />;
    }
  };

  const getTradeTypeLabel = (type: string) => {
    switch (type) {
      case "buy":
        return "Buy";
      case "sell":
        return "Sell";
      case "swap":
        return "Swap";
      default:
        return "Transaction";
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-[720px] mx-auto animate-fade-in pb-8">
      <div className="mb-4 sm:mb-6 mt-4 space-y-1 sm:space-y-2">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">
          Your Feed
        </h1>
        <p className="text-base sm:text-lg text-text-secondary">
          Follow wallets to see their plays
        </p>
      </div>

      {/* Always-accessible actions */}
      <div className="mb-6 flex flex-wrap gap-2">
        <button
          onClick={() => navigate("/cope/wallet")}
          className="inline-flex items-center gap-2 px-3 sm:px-4 py-2.5 min-h-[44px] rounded-xl bg-accent-primary/20 text-accent-primary border border-accent-primary/30 hover:bg-accent-primary/30 hover:border-accent-primary/50 active:scale-[0.98] transition-all duration-200 text-sm font-medium"
        >
          <Search className="w-4 h-4 flex-shrink-0" />
          <span className="truncate">COPE a Wallet</span>
        </button>
        <button
          onClick={() => navigate("/scanner")}
          className="inline-flex items-center gap-2 px-3 sm:px-4 py-2.5 min-h-[44px] rounded-xl bg-white/5 text-white border border-white/10 hover:bg-white/10 hover:border-white/20 active:scale-[0.98] transition-all duration-200 text-sm font-medium"
        >
          <ScanLine className="w-4 h-4 text-accent-purple flex-shrink-0" />
          <span className="truncate">Run Scanner</span>
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-accent-primary mb-4" />
          <p className="text-text-secondary">Loading feed...</p>
        </div>
      ) : notifications.length === 0 ? (
        /* Empty State */
        <Card glass className="overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-[#12d585]/40 via-[#08b16b]/30 to-transparent" />
          <div className="p-6 sm:p-8 text-center">
            <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-accent-primary/10 flex items-center justify-center mx-auto mb-6">
              <TrendingUp className="w-10 h-10 sm:w-12 sm:h-12 text-accent-primary" />
            </div>
            <h3 className="text-xl sm:text-2xl font-semibold mb-2">
              No Plays Yet
            </h3>
            <p className="text-text-secondary text-center mb-6 sm:mb-8 max-w-sm mx-auto leading-relaxed text-sm sm:text-base">
              Start by COPEing wallets or running the Scanner to find top
              traders
            </p>
            <div className="w-full space-y-3 max-w-sm mx-auto">
              <Button
                onClick={() => navigate("/cope/wallet")}
                className="w-full h-12 sm:h-14 text-base min-h-[48px]"
                variant="primary"
              >
                <Search className="w-5 h-5" />
                COPE a Wallet
              </Button>

              <Button
                onClick={() => navigate("/scanner")}
                variant="secondary"
                className="w-full h-12 sm:h-14 text-base min-h-[48px]"
              >
                <ScanLine className="w-5 h-5 text-accent-purple" />
                Run COPE Scanner
              </Button>

              <Button
                onClick={() => navigate("/app/trade")}
                variant="ghost"
                className="w-full text-text-muted hover:text-white min-h-[48px]"
              >
                Or paste a token CA to trade →
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        /* Feed */
        <motion.div
          className="space-y-4"
          initial="initial"
          animate="animate"
          variants={{
            animate: {
              transition: {
                staggerChildren: 0.05,
                delayChildren: 0.08,
              },
            },
          }}
        >
          {notifications.map((notification) => (
            <motion.div
              key={notification.id}
              variants={{
                initial: { opacity: 0, y: 12 },
                animate: {
                  opacity: 1,
                  y: 0,
                  transition: { duration: 0.35, ease: "easeOut" },
                },
              }}
            >
              <Card
                glass
                className="hover:border-white/20 transition-colors duration-200 overflow-hidden"
              >
                <div className="h-0.5 bg-gradient-to-r from-[#12d585]/20 via-transparent to-transparent" />
                <div className="p-4 sm:p-5">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        {getTradeIcon(notification.type)}
                        <span className="text-xs font-medium text-white/70 uppercase tracking-wide">
                          {getTradeTypeLabel(notification.type)}
                        </span>
                      </div>

                      <h3 className="font-semibold text-base sm:text-lg mb-1 truncate">
                        {getWalletNickname(notification.walletAddress)}
                      </h3>

                      <p className="text-sm text-white/70 mb-2 line-clamp-2">
                        {notification.message}
                      </p>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-white/50 mb-2">
                        {notification.amountUsd && (
                          <span className="font-medium text-white/70">
                            {formatCurrency(notification.amountUsd)}
                          </span>
                        )}
                        {notification.tokenAddress && (
                          <code className="font-mono">
                            {shortenAddress(notification.tokenAddress)}
                          </code>
                        )}
                        <span>{formatTime(notification.createdAt)}</span>
                      </div>

                      {notification.txHash && (
                        <a
                          href={`https://solscan.io/tx/${notification.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-accent-primary hover:text-accent-hover transition-colors"
                        >
                          View Transaction
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>

                    {notification.tokenAddress && (
                      <Button
                        onClick={() => handleCopyTrade(notification)}
                        variant="primary"
                        size="sm"
                        className="flex-shrink-0 min-h-[40px] w-full sm:w-auto"
                      >
                        <Copy className="w-4 h-4" />
                        Copy Trade
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* Info Cards */}
      {notifications.length > 0 && (
        <div className="mt-8 sm:mt-12">
          <Card glass className="overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-accent-purple/40 via-accent-purple/20 to-transparent" />
            <div className="p-4 sm:p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-accent-purple/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-accent-purple text-lg">💡</span>
                </div>
                <h4 className="font-semibold text-base sm:text-lg">
                  What is COPE?
                </h4>
              </div>
              <p className="text-sm sm:text-base text-text-secondary leading-relaxed">
                <span className="text-accent-primary font-medium">COPE</span> =
                Catch Onchain Plays Early. Follow proven wallets, see their
                verified trades in real-time, and copy plays instantly.
              </p>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
