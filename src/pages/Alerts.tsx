import { useEffect, useState } from 'react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Bell, ExternalLink, Check, Trash2, Filter, Copy } from 'lucide-react';
import { useNavigate } from 'react-router';
import { shortenAddress } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import {
  getUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  getUnreadNotificationCount,
  WalletNotification,
  requestPermissionAndGetFcmToken,
  savePushToken,
  getPushNotificationStatus,
} from '@/lib/notifications';
import { collection, query, where, orderBy, limit, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { toast } from 'sonner';

export function Alerts() {
  const navigate = useNavigate();
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [notifications, setNotifications] = useState<WalletNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread' | 'large_trade' | 'token_swap'>('all');

  // Real-time listener for notifications
  useEffect(() => {
    if (!isAuthenticated || !user) {
      setLoading(false);
      return;
    }

    // Set up real-time listener
    const notificationsRef = collection(db, 'notifications');
    const q = query(
      notificationsRef,
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(100)
    );

    let unsubscribe: (() => void) | null = null;
    
    try {
      unsubscribe = onSnapshot(q, (snapshot) => {
        const fetchedNotifications = snapshot.docs
          .map(doc => {
            const data = doc.data();
            return {
              id: doc.id,
              ...data,
            } as WalletNotification;
          })
          .filter((n: any) => !n.deleted)
          .sort((a: any, b: any) => {
            const aTime = a.createdAt?.toDate?.()?.getTime() || 0;
            const bTime = b.createdAt?.toDate?.()?.getTime() || 0;
            return bTime - aTime;
          });
        
        setNotifications(fetchedNotifications);
        
        // Update unread count
        const unread = fetchedNotifications.filter((n: any) => !n.read);
        setUnreadCount(unread.length);
        
        setLoading(false);
      }, (error: any) => {
        // If index doesn't exist, try without orderBy
        if (error.code === 'failed-precondition') {
          const fallbackQ = query(
            notificationsRef,
            where('userId', '==', user.uid),
            limit(100)
          );
          
          unsubscribe = onSnapshot(fallbackQ, (snapshot) => {
            const fetchedNotifications = snapshot.docs
              .map(doc => {
                const data = doc.data();
                return {
                  id: doc.id,
                  ...data,
                } as WalletNotification;
              })
              .filter((n: any) => !n.deleted)
              .sort((a: any, b: any) => {
                const aTime = a.createdAt?.toDate?.()?.getTime() || 0;
                const bTime = b.createdAt?.toDate?.()?.getTime() || 0;
                return bTime - aTime;
              });
            
            setNotifications(fetchedNotifications);
            
            const unread = fetchedNotifications.filter((n: any) => !n.read);
            setUnreadCount(unread.length);
            
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

    // Check push notification status
    getPushNotificationStatus(user.uid).then(status => {
      setPushEnabled(status.enabled && status.permission === 'granted');
    });

    return () => {
      if (unsubscribe) {
        unsubscribe();
      }
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
          toast.success('Push notifications enabled');
        }
      } catch (error) {
        console.error('Error setting up push notifications:', error);
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
      setNotifications(prev =>
        prev.map(n => n.id === notificationId ? { ...n, read: true } : n)
      );
      setUnreadCount(prev => Math.max(0, prev - 1));
    } catch (error) {
      toast.error('Failed to mark notification as read');
    }
  };

  const handleMarkAllAsRead = async () => {
    if (!user) return;
    try {
      await markAllNotificationsAsRead(user.uid);
      setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      setUnreadCount(0);
      toast.success('All notifications marked as read');
    } catch (error) {
      toast.error('Failed to mark all as read');
    }
  };

  const handleDelete = async (notificationId: string) => {
    try {
      await deleteNotification(notificationId);
      setNotifications(prev => prev.filter(n => n.id !== notificationId));
      if (!notifications.find(n => n.id === notificationId)?.read) {
        setUnreadCount(prev => Math.max(0, prev - 1));
      }
    } catch (error) {
      toast.error('Failed to delete notification');
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

  const formatTime = (timestamp: any) => {
    if (!timestamp) return 'Just now';
    
    // Handle Firestore timestamp
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
            <Button onClick={() => window.location.href = '/auth/x-connect'}>
              Sign In
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  // Filter notifications based on selected filter
  const filteredNotifications = notifications.filter(n => {
    if (filter === 'unread') return !n.read;
    if (filter === 'large_trade') return n.type === 'large_trade';
    if (filter === 'token_swap') return n.type === 'token_swap';
    return true;
  });

  const unreadNotifications = filteredNotifications.filter(n => !n.read);
  const readNotifications = filteredNotifications.filter(n => n.read);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#000000] to-[#0B3D2E] p-4 sm:p-6">
      <div className="max-w-[720px] mx-auto">
        <div className="mb-6 flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold mb-2">Alerts</h1>
            {unreadCount > 0 && (
              <p className="text-white/60 text-sm">
                {unreadCount} unread notification{unreadCount !== 1 ? 's' : ''}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <Button variant="outline" size="sm" onClick={handleMarkAllAsRead}>
                <Check className="w-4 h-4" />
                Mark all read
              </Button>
            )}
          </div>
        </div>

        {/* Filter Tabs */}
        {notifications.length > 0 && (
          <div className="mb-4 flex gap-2 overflow-x-auto pb-2">
            {[
              { value: 'all', label: 'All' },
              { value: 'unread', label: 'Unread' },
              { value: 'large_trade', label: 'Large Trades' },
              { value: 'token_swap', label: 'Token Swaps' },
            ].map((filterOption) => (
              <button
                key={filterOption.value}
                onClick={() => setFilter(filterOption.value as any)}
                className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  filter === filterOption.value
                    ? 'bg-accent-primary text-[#000000]'
                    : 'bg-white/5 text-white/60 hover:bg-white/10'
                }`}
              >
                {filterOption.label}
              </button>
            ))}
          </div>
        )}

        {filteredNotifications.length === 0 ? (
          <Card className="text-center py-12">
            <Bell className="w-12 h-12 mx-auto mb-4 text-white/30" />
            <h3 className="text-lg font-semibold mb-2">No Alerts Yet</h3>
            <p className="text-white/60 text-center max-w-sm mx-auto mb-6">
              {filter === 'all' 
                ? "You'll get notified when wallets you're COPEing make new trades"
                : `No ${filter === 'unread' ? 'unread' : filter === 'large_trade' ? 'large trade' : 'token swap'} notifications`}
            </p>
            {filter === 'all' && (
              <Button onClick={() => window.location.href = '/scanner'}>
                Find Wallets to COPE
              </Button>
            )}
          </Card>
        ) : (
          <div className="space-y-4">
            {/* Unread Notifications */}
            {unreadNotifications.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-white/70 mb-3">Unread</h2>
                <div className="space-y-2">
                  {unreadNotifications.map((notification) => (
                    <Card
                      key={notification.id}
                      className={`border-l-4 ${
                        notification.type === 'large_trade'
                          ? 'border-[#FFB84D]'
                          : notification.type === 'token_swap'
                          ? 'border-[#12d585]'
                          : 'border-[#54A0FF]'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-semibold">{notification.title}</h3>
                            {!notification.read && (
                              <span className="w-2 h-2 rounded-full bg-[#12d585]"></span>
                            )}
                          </div>
                          <p className="text-sm text-white/70 mb-2">{notification.message}</p>
                          <div className="flex items-center gap-4 text-xs text-white/50">
                            <code className="font-mono">
                              {shortenAddress(notification.walletAddress)}
                            </code>
                            {notification.amountUsd && (
                              <span>{formatCurrency(notification.amountUsd)}</span>
                            )}
                            <span>{formatTime(notification.createdAt)}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                          {notification.tokenAddress && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                navigate('/app/trade', {
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
                    </Card>
                  ))}
                </div>
              </div>
            )}

            {/* Read Notifications */}
            {readNotifications.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-white/70 mb-3">Read</h2>
                <div className="space-y-2">
                  {readNotifications.map((notification) => (
                    <Card
                      key={notification.id}
                      className="opacity-60"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h3 className="font-semibold mb-1">{notification.title}</h3>
                          <p className="text-sm text-white/70 mb-2">{notification.message}</p>
                          <div className="flex items-center gap-4 text-xs text-white/50">
                            <code className="font-mono">
                              {shortenAddress(notification.walletAddress)}
                            </code>
                            {notification.amountUsd && (
                              <span>{formatCurrency(notification.amountUsd)}</span>
                            )}
                            <span>{formatTime(notification.createdAt)}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                          {notification.tokenAddress && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                navigate('/app/trade', {
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
                    </Card>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
