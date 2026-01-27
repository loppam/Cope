import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Twitter, Wallet, Settings, LogOut, ExternalLink, Trash2, RefreshCw } from 'lucide-react';
import { shortenAddress } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { getSolBalance } from '@/lib/rpc';
import { toast } from 'sonner';

export function Profile() {
  const navigate = useNavigate();
  const { user, userProfile, signOut, removeWallet, loading } = useAuth();
  const [isRemovingWallet, setIsRemovingWallet] = useState(false);
  const [balance, setBalance] = useState<number>(userProfile?.balance || 0);
  const [isRefreshingBalance, setIsRefreshingBalance] = useState(false);

  // Get user data from Firebase or use defaults
  const xHandle = userProfile?.xHandle || userProfile?.displayName || user?.displayName || '@user';
  const avatar = userProfile?.avatar || userProfile?.photoURL || user?.photoURL || '';
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
      console.error('Error fetching balance:', error);
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

  return (
    <div className="p-6 max-w-[720px] mx-auto">
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
                {xHandle.charAt(1)?.toUpperCase() || 'U'}
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
                <code className="font-mono">{shortenAddress(walletAddress)}</code>
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
                    <RefreshCw className={`w-3 h-3 ${isRefreshingBalance ? 'animate-spin' : ''}`} />
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
                onClick={() => navigate('/auth/wallet-setup')}
                className="mt-2 text-accent-primary hover:text-accent-hover"
              >
                Connect Wallet
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* Actions */}
      <div className="space-y-3">
        {walletAddress && (
          <Card className="cursor-pointer hover:border-white/20" onClick={() => navigate('/wallet/fund')}>
            <div className="flex items-center gap-3">
              <Wallet className="w-5 h-5 text-white/70" />
              <span className="font-medium">Fund Wallet</span>
            </div>
          </Card>
        )}

        <Card className="cursor-pointer hover:border-white/20">
          <div className="flex items-center gap-3">
            <Settings className="w-5 h-5 text-white/70" />
            <span className="font-medium">Settings</span>
          </div>
        </Card>

        {walletAddress && (
          <Card 
            className="cursor-pointer hover:border-white/20"
            onClick={() => window.open(`https://solscan.io/account/${walletAddress}`, '_blank')}
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
              if (!confirm('Are you sure you want to remove your wallet? You will need to set it up again.')) {
                return;
              }
              setIsRemovingWallet(true);
              try {
                await removeWallet();
                navigate('/auth/wallet-setup');
              } catch (error) {
                console.error('Remove wallet error:', error);
              } finally {
                setIsRemovingWallet(false);
              }
            }}
          >
            <div className="flex items-center gap-3">
              <Trash2 className="w-5 h-5 text-[#FF4757]" />
              <span className="font-medium text-[#FF4757]">
                {isRemovingWallet ? 'Removing...' : 'Remove Wallet'}
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
              navigate('/');
            } catch (error) {
              console.error('Sign out error:', error);
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
