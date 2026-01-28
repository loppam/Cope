import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Search, ScanLine, TrendingUp, Copy, ExternalLink, Loader2, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { collection, query, where, orderBy, limit, onSnapshot, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { WalletNotification } from "@/lib/notifications";
import { shortenAddress, formatCurrency } from "@/lib/utils";
import { toast } from "sonner";

export function Home() {
  const navigate = useNavigate();
  const { user, watchlist } = useAuth();
  const [notifications, setNotifications] = useState<WalletNotification[]>([]);
  const [loading, setLoading] = useState(true);

  // Real-time listener for notifications
  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    // Get watched wallet addresses
    const watchedAddresses = watchlist.map(w => w.address);
    
    if (watchedAddresses.length === 0) {
      setLoading(false);
      return;
    }

    // Set up real-time listener
    const notificationsRef = collection(db, 'notifications');
    const q = query(
      notificationsRef,
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    // Try with orderBy first, fallback if index doesn't exist
    let unsubscribe: (() => void) | null = null;
    
    try {
      unsubscribe = onSnapshot(q, (snapshot) => {
        const fetchedNotifications = snapshot.docs
          .map(doc => ({
            id: doc.id,
            ...doc.data(),
          }))
          .filter((n: any) => !n.deleted && watchedAddresses.includes(n.walletAddress))
          .sort((a: any, b: any) => {
            const aTime = a.createdAt?.toDate?.()?.getTime() || 0;
            const bTime = b.createdAt?.toDate?.()?.getTime() || 0;
            return bTime - aTime;
          }) as WalletNotification[];
        
        setNotifications(fetchedNotifications);
        setLoading(false);
      }, (error: any) => {
        // If index doesn't exist, try without orderBy
        if (error.code === 'failed-precondition') {
          const fallbackQ = query(
            notificationsRef,
            where('userId', '==', user.uid),
            limit(50)
          );
          
          unsubscribe = onSnapshot(fallbackQ, (snapshot) => {
            const fetchedNotifications = snapshot.docs
              .map(doc => ({
                id: doc.id,
                ...doc.data(),
              }))
              .filter((n: any) => !n.deleted && watchedAddresses.includes(n.walletAddress))
              .sort((a: any, b: any) => {
                const aTime = a.createdAt?.toDate?.()?.getTime() || 0;
                const bTime = b.createdAt?.toDate?.()?.getTime() || 0;
                return bTime - aTime;
              }) as WalletNotification[];
            
            setNotifications(fetchedNotifications);
            setLoading(false);
          });
        } else {
          console.error('Error fetching notifications:', error);
          setLoading(false);
        }
      });
    } catch (error) {
      console.error('Error setting up notification listener:', error);
      setLoading(false);
    }

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, [user, watchlist]);

  const formatTime = (timestamp: any) => {
    if (!timestamp) return 'Just now';
    
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const getWalletNickname = (walletAddress: string) => {
    const watched = watchlist.find(w => w.address === walletAddress);
    return watched?.nickname || shortenAddress(walletAddress);
  };

  const handleCopyTrade = (notification: WalletNotification) => {
    if (!notification.tokenAddress) {
      toast.error('No token address available for this trade');
      return;
    }
    
    navigate('/app/trade', {
      state: {
        mint: notification.tokenAddress,
        fromFeed: true,
        walletNickname: getWalletNickname(notification.walletAddress),
      },
    });
  };

  const getTradeIcon = (type: string) => {
    switch (type) {
      case 'large_trade':
        return <ArrowUpRight className="w-4 h-4 text-[#FFB84D]" />;
      case 'token_swap':
        return <ArrowDownRight className="w-4 h-4 text-[#12d585]" />;
      default:
        return <TrendingUp className="w-4 h-4 text-white/60" />;
    }
  };

  const getTradeTypeLabel = (type: string) => {
    switch (type) {
      case 'large_trade':
        return 'Large Trade';
      case 'token_swap':
        return 'Token Swap';
      default:
        return 'Transaction';
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-[720px] mx-auto animate-fade-in pb-32">
      <div className="mb-8 mt-4 space-y-2">
        <h1 className="text-4xl font-bold tracking-tight text-white">
          Your Feed
        </h1>
        <p className="text-lg text-text-secondary">
          Follow wallets to see their plays
        </p>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-accent-primary mb-4" />
          <p className="text-text-secondary">Loading feed...</p>
        </div>
      ) : notifications.length === 0 ? (
        /* Empty State */
        <div className="flex flex-col items-center justify-center py-8">
          <div className="w-24 h-24 rounded-full bg-surface-2 flex items-center justify-center mb-8">
            <TrendingUp className="w-10 h-10 text-accent-primary" />
          </div>

          <h3 className="text-2xl font-semibold mb-3">No Plays Yet</h3>
          <p className="text-text-secondary text-center mb-10 max-w-sm leading-relaxed">
            Start by COPEing wallets or running the Scanner to find top traders
          </p>

          <div className="w-full space-y-4 max-w-sm">
            <Button
              onClick={() => navigate("/cope/wallet")}
              className="w-full h-14 text-base"
              variant="primary"
            >
              <Search className="w-5 h-5" />
              COPE a Wallet
            </Button>

            <Button
              onClick={() => navigate("/scanner")}
              variant="secondary"
              className="w-full h-14 text-base"
            >
              <ScanLine className="w-5 h-5 text-accent-purple" />
              Run COPE Scanner
            </Button>

            <Button
              onClick={() => navigate("/app/trade")}
              variant="ghost"
              className="w-full text-text-muted hover:text-white"
            >
              Or paste a token CA to trade →
            </Button>
          </div>
        </div>
      ) : (
        /* Feed */
        <div className="space-y-4">
          {notifications.map((notification) => (
            <Card key={notification.id} className="hover:border-white/20 transition-colors">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    {getTradeIcon(notification.type)}
                    <span className="text-xs font-medium text-white/70 uppercase tracking-wide">
                      {getTradeTypeLabel(notification.type)}
                    </span>
                  </div>
                  
                  <h3 className="font-semibold text-lg mb-1">
                    {getWalletNickname(notification.walletAddress)}
                  </h3>
                  
                  <p className="text-sm text-white/70 mb-3">
                    {notification.message}
                  </p>

                  <div className="flex items-center gap-4 text-xs text-white/50 mb-3">
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
                    className="flex-shrink-0"
                  >
                    <Copy className="w-4 h-4" />
                    Copy Trade
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Info Cards */}
      {notifications.length > 0 && (
        <div className="mt-12 space-y-4">
          <Card className="bg-surface-1 border-border-subtle">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-8 h-8 rounded-lg bg-accent-purple/10 flex items-center justify-center">
                <span className="text-accent-purple text-lg">💡</span>
              </div>
              <h4 className="font-semibold text-lg">What is COPE?</h4>
            </div>
            <p className="text-base text-text-secondary leading-relaxed">
              <span className="text-accent-primary font-medium">COPE</span> =
              Catch Onchain Plays Early. Follow proven wallets, see their verified
              trades in real-time, and copy plays instantly.
            </p>
          </Card>
        </div>
      )}
    </div>
  );
}
