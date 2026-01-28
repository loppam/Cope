import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { BackButton } from '@/components/BackButton';
import { Star, ExternalLink, Trash2 } from 'lucide-react';
import { shortenAddress } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { WatchedWallet } from '@/lib/auth';
import { toast } from 'sonner';

export function Watchlist() {
  const navigate = useNavigate();
  const { watchlist, removeFromWatchlist, isAuthenticated, loading: authLoading } = useAuth();
  const [removingWallets, setRemovingWallets] = useState<Set<string>>(new Set());

  const getGmgnLink = (address: string) => {
    return `https://gmgn.ai/sol/address/${address}`;
  };

  const handleRemove = async (e: React.MouseEvent, walletAddress: string) => {
    e.stopPropagation();
    
    if (!isAuthenticated) {
      toast.error('Please sign in');
      return;
    }

    try {
      setRemovingWallets(prev => new Set(prev).add(walletAddress));
      await removeFromWatchlist(walletAddress);
    } catch (error) {
      // Error already handled in removeFromWatchlist
    } finally {
      setRemovingWallets(prev => {
        const newSet = new Set(prev);
        newSet.delete(walletAddress);
        return newSet;
      });
    }
  };

  if (authLoading) {
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
          <h1 className="text-2xl font-bold mb-6">Watchlist</h1>
          <Card className="text-center py-12">
            <p className="text-white/60 mb-4">Please sign in to view your watchlist</p>
            <Button onClick={() => navigate('/auth/x-connect')}>
              Sign In
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#000000] to-[#0B3D2E]">
      <div className="p-4">
        <BackButton onClick={() => navigate(-1)} />
      </div>
      <div className="p-4 sm:p-6 max-w-[1200px] mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-2">Watchlist</h1>
          <p className="text-white/60">Wallets you're tracking for transaction notifications</p>
        </div>

        {watchlist.length === 0 ? (
          <Card className="text-center py-12">
            <Star className="w-12 h-12 mx-auto mb-4 text-white/30" />
            <p className="text-white/60 mb-4">Your watchlist is empty</p>
            <p className="text-sm text-white/50 mb-6">
              COPE wallets from the scanner to track their transactions
            </p>
            <Button onClick={() => navigate('/app/home')}>
              Go to Home
            </Button>
          </Card>
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-3 px-4 text-sm font-medium text-white/70">Nickname</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-white/70">Wallet Address</th>
                  <th className="text-center py-3 px-4 text-sm font-medium text-white/70">Actions</th>
                </tr>
              </thead>
              <tbody>
                {watchlist.map((wallet) => {
                  return (
                    <tr
                      key={wallet.address}
                      className="border-b border-white/5 hover:bg-white/5 transition-colors"
                    >
                      <td className="py-4 px-4">
                        <span className="text-white font-semibold">
                          {wallet.nickname || '—'}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-2">
                          <code className="text-sm font-mono text-white">
                            {shortenAddress(wallet.address)}
                          </code>
                          <a
                            href={getGmgnLink(wallet.address)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#12d585] hover:text-[#08b16b] transition-colors"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        </div>
                      </td>
                      <td className="py-4 px-4 text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => handleRemove(e, wallet.address)}
                          disabled={removingWallets.has(wallet.address)}
                          className="text-[#FF4757] hover:text-[#FF4757] hover:bg-[#FF4757]/10"
                        >
                          {removingWallets.has(wallet.address) ? (
                            <>Removing...</>
                          ) : (
                            <>
                              <Trash2 className="w-4 h-4" />
                            </>
                          )}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </div>
    </div>
  );
}
