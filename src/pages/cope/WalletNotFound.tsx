import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Card } from '@/components/Card';
import { UserPlus } from 'lucide-react';
import { shortenAddress } from '@/lib/utils';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

export function WalletNotFound() {
  const navigate = useNavigate();
  const location = useLocation();
  const { address } = location.state as { address: string };
  const { addToWatchlist, isAuthenticated } = useAuth();
  const [nickname, setNickname] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const handleAdd = async () => {
    if (!isAuthenticated) {
      toast.error('Please sign in to add wallets');
      return;
    }

    if (!nickname.trim()) {
      toast.error('Please enter a nickname');
      return;
    }

    try {
      setIsAdding(true);
      await addToWatchlist(address, { nickname: nickname.trim() });
      toast.success('Wallet added to watchlist!');
      navigate('/app/watchlist');
    } catch (error: any) {
      // Error already handled in addToWatchlist
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#000000] to-[#0B3D2E] p-6">
      <div className="max-w-md mx-auto">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/10 flex items-center justify-center">
            <UserPlus className="w-8 h-8 text-white/50" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Wallet Not on COPE</h1>
          <p className="text-white/60">Add it to your watchlist anyway</p>
        </div>

        <Card className="mb-6">
          <div className="mb-4">
            <p className="text-sm text-white/60 mb-2">Wallet Address</p>
            <code className="text-sm font-mono text-white/90">{shortenAddress(address)}</code>
          </div>
          <div className="px-3 py-2 rounded-[12px] bg-[#54A0FF]/10 border border-[#54A0FF]/20">
            <p className="text-sm text-[#54A0FF]">
              This wallet will appear in your feed once they make their first verified trade
            </p>
          </div>
        </Card>

        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">Nickname (Optional)</label>
          <Input
            placeholder="e.g. Smart Trader, Whale..."
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
        </div>

        <Button 
          onClick={handleAdd} 
          disabled={!nickname.trim() || isAdding} 
          className="w-full h-12 mb-3"
        >
          {isAdding ? 'Adding...' : 'Add to Watchlist'}
        </Button>

        <Button variant="outline" onClick={() => navigate(-1)} className="w-full h-10">
          Try Another Wallet
        </Button>
      </div>
    </div>
  );
}
