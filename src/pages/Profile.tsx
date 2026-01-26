import { useNavigate } from 'react-router';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Twitter, Wallet, Settings, LogOut, ExternalLink } from 'lucide-react';
import { shortenAddress } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';

export function Profile() {
  const navigate = useNavigate();
  const { user, userProfile, signOut, loading } = useAuth();

  // Get user data from Firebase or use defaults
  const xHandle = userProfile?.xHandle || userProfile?.displayName || user?.displayName || '@user';
  const avatar = userProfile?.avatar || userProfile?.photoURL || user?.photoURL || '';
  const walletAddress = userProfile?.walletAddress || null;
  const balance = userProfile?.balance || 0;
  const walletConnected = userProfile?.walletConnected || false;

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
                <span className="font-medium">{balance.toFixed(4)} SOL</span>
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
