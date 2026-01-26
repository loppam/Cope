import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { findUserByWalletAddress } from '@/lib/auth';
import { toast } from 'sonner';

export function CopeWallet() {
  const navigate = useNavigate();
  const [address, setAddress] = useState('');
  const [searching, setSearching] = useState(false);

  const handleSearch = async () => {
    if (!address.trim()) return;

    try {
      setSearching(true);
      
      // Check if wallet exists in database
      const userData = await findUserByWalletAddress(address.trim());
      
      if (userData) {
        // Wallet found - user is on COPE
        navigate('/cope/wallet/found', { 
          state: { 
            address: address.trim(),
            userData 
          } 
        });
      } else {
        // Wallet not found - not on COPE
        navigate('/cope/wallet/new', { 
          state: { address: address.trim() } 
        });
      }
    } catch (error: any) {
      console.error('Error searching wallet:', error);
      toast.error('Failed to search wallet. Please try again.');
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#000000] to-[#0B3D2E]">
      <div className="p-4">
        <Button variant="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
      </div>

      <div className="p-6 max-w-[720px] mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2">COPE a Wallet</h1>
          <p className="text-white/60">Track any wallet's verified on-chain trades</p>
        </div>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2">Wallet Address</label>
            <Input
              placeholder="Enter Solana wallet address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="font-mono"
            />
          </div>

          <Button 
            onClick={handleSearch} 
            disabled={!address.trim() || searching} 
            className="w-full h-12"
          >
            {searching ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Searching...
              </>
            ) : (
              'Search Wallet'
            )}
          </Button>

          <div className="pt-6 border-t border-white/6">
            <h3 className="font-semibold mb-3">Quick Tips</h3>
            <ul className="space-y-2 text-sm text-white/70">
              <li>• COPE any wallet, even if they're not on the platform</li>
              <li>• Get real-time notifications when they trade</li>
              <li>• One-tap copy their plays instantly</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
