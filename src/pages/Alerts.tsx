import { useEffect, useState } from 'react';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Bell, ExternalLink, Check, Trash2 } from 'lucide-react';
import { shortenAddress } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import {
  getUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  getUnreadNotificationCount,
  WalletNotification,
} from '@/lib/notifications';
import { toast } from 'sonner';

export function Alerts() {
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [notifications, setNotifications] = useState<WalletNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!isAuthenticated || !user) {
      setLoading(false);
      return;
    }

    const loadNotifications = async () => {
      try {
        setLoading(true);
        const userNotifications = await getUserNotifications(user.uid);
        setNotifications(userNotifications);
        
        const count = await getUnreadNotificationCount(user.uid);
        setUnreadCount(count);
      } catch (error) {
        console.error('Error loading notifications:', error);
        toast.error('Failed to load notifications');
      } finally {
        setLoading(false);
      }
    };

    loadNotifications();
    
    // Refresh notifications every 30 seconds
    const interval = setInterval(loadNotifications, 30000);
    return () => clearInterval(interval);
  }, [user, isAuthenticated]);

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

  const unreadNotifications = notifications.filter(n => !n.read);
  const readNotifications = notifications.filter(n => n.read);

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#000000] to-[#0B3D2E] p-6">
      <div className="max-w-[720px] mx-auto">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold mb-2">Alerts</h1>
            {unreadCount > 0 && (
              <p className="text-white/60 text-sm">
                {unreadCount} unread notification{unreadCount !== 1 ? 's' : ''}
              </p>
            )}
          </div>
          {unreadCount > 0 && (
            <Button variant="outline" size="sm" onClick={handleMarkAllAsRead}>
              <Check className="w-4 h-4" />
              Mark all read
            </Button>
          )}
        </div>

        {notifications.length === 0 ? (
          <Card className="text-center py-12">
            <Bell className="w-12 h-12 mx-auto mb-4 text-white/30" />
            <h3 className="text-lg font-semibold mb-2">No Alerts Yet</h3>
            <p className="text-white/60 text-center max-w-sm mx-auto mb-6">
              You'll get notified when wallets you're COPEing make new trades
            </p>
            <Button onClick={() => window.location.href = '/scanner'}>
              Find Wallets to COPE
            </Button>
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
                        <div className="flex items-center gap-2 ml-4">
                          {notification.txHash && (
                            <a
                              href={`https://solscan.io/tx/${notification.txHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#12d585] hover:text-[#08b16b]"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleMarkAsRead(notification.id)}
                          >
                            <Check className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(notification.id)}
                            className="text-[#FF4757] hover:text-[#FF4757] hover:bg-[#FF4757]/10"
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
                        <div className="flex items-center gap-2 ml-4">
                          {notification.txHash && (
                            <a
                              href={`https://solscan.io/tx/${notification.txHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[#12d585] hover:text-[#08b16b]"
                            >
                              <ExternalLink className="w-4 h-4" />
                            </a>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(notification.id)}
                            className="text-[#FF4757] hover:text-[#FF4757] hover:bg-[#FF4757]/10"
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
