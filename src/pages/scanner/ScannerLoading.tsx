import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { Card } from '@/components/Card';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { scanWalletsForTokens, ScannerWallet } from '@/lib/birdeye';
import { toast } from 'sonner';

interface LocationState {
  mints: string[];
  lookback: string;
  minMatches: number;
  minTrades: number;
}

export function ScannerLoading() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState;
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<'fetching' | 'finding' | 'ranking'>('fetching');
  const [wallets, setWallets] = useState<ScannerWallet[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!state?.mints || state.mints.length < 2) {
      navigate('/scanner');
      return;
    }

    const scanWallets = async () => {
      try {
        // Phase 1: Fetching
        setPhase('fetching');
        setProgress(33);
        
        // Phase 2: Finding wallets
        setPhase('finding');
        setProgress(66);
        
        // Scan wallets using Birdeye
        const results = await scanWalletsForTokens(
          state.mints,
          state.minMatches,
          state.minTrades
        );
        
        // Phase 3: Ranking
        setPhase('ranking');
        setProgress(90);
        
        // Small delay to show ranking phase
        await new Promise((resolve) => setTimeout(resolve, 500));
        
        setWallets(results);
        setProgress(100);
        
        // Navigate to results
        setTimeout(() => {
          navigate('/scanner/results', { 
            state: { 
              ...state, 
              wallets: results 
            } 
          });
        }, 500);
      } catch (err: any) {
        console.error('Error scanning wallets:', err);
        setError(err.message || 'Failed to scan wallets');
        toast.error(err.message || 'Failed to scan wallets. Please check your Birdeye API key.');
        
        // Navigate back to input after error
        setTimeout(() => {
          navigate('/scanner');
        }, 2000);
      }
    };

    scanWallets();
  }, [navigate, state]);

  const phaseText = {
    fetching: 'Fetching transactions from the blockchain...',
    finding: 'Finding recurring wallets...',
    ranking: 'Calculating investments...',
  };

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#000000] to-[#0B3D2E] flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#FF4757]/20 flex items-center justify-center">
            <span className="text-2xl">⚠️</span>
          </div>
          <h2 className="text-xl font-bold mb-2 text-[#FF4757]">Scan Failed</h2>
          <p className="text-white/60 mb-4">{error}</p>
          <p className="text-sm text-white/50">Redirecting back to scanner...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#000000] to-[#0B3D2E] flex flex-col items-center justify-center p-6">
      <div className="max-w-md w-full">
        <div className="text-center mb-12">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-[#12d585] to-[#08b16b] flex items-center justify-center animate-pulse">
            <Loader2 className="w-8 h-8 text-[#000000] animate-spin" />
          </div>
          <h2 className="text-xl font-bold mb-2">Scanning Wallets</h2>
          <p className="text-white/60">{phaseText[phase]}</p>
        </div>

        <div className="space-y-3 mb-8">
          {state?.mints.slice(0, 3).map((mint, index) => (
            <Card key={index} className="flex items-center gap-3">
              {phase !== 'fetching' || index < progress / 33 ? (
                <CheckCircle2 className="w-5 h-5 text-[#12d585] flex-shrink-0" />
              ) : (
                <Loader2 className="w-5 h-5 text-white/30 animate-spin flex-shrink-0" />
              )}
              <code className="text-sm font-mono text-white/70 truncate">
                {mint.slice(0, 8)}...{mint.slice(-6)}
              </code>
            </Card>
          ))}
        </div>

        <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[#12d585] to-[#08b16b] transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );
}
