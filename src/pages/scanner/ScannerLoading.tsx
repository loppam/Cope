import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { Card } from '@/components/Card';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { scanWalletsForTokens, type ScannerProgress } from '@/lib/scanner';
import type { ScannerWallet } from '@/lib/birdeye';
import { toUserMessage } from '@/lib/user-errors';
import { formatNumber } from '@/lib/utils';
import { toast } from 'sonner';

interface LocationState {
  mints: string[];
  lookback: string;
  minMatches: number;
  minTrades: number;
}

function buildProgressText(p: ScannerProgress): string {
  const tx = formatNumber(p.transactionsScanned, 0);
  const wallets = formatNumber(p.uniqueWalletsSeen, 0);
  if (p.phase === 'fetching') {
    return `${tx} transactions scanned • ${wallets} wallets seen • Token ${p.currentToken}/${p.totalTokens}`;
  }
  if (p.phase === 'finding') {
    return `${tx} transactions • ${wallets} unique wallets • Finding matches...`;
  }
  if (p.phase === 'ranking') {
    const m = p.matchedWallets ?? 0;
    return `${tx} scanned • ${wallets} wallets • ${m} matches • Ranking PnL & ROI...`;
  }
  return 'Scanning...';
}

export function ScannerLoading() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as LocationState;
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState('');
  const [progressData, setProgressData] = useState<ScannerProgress | null>(null);
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
        setProgressText('Connecting to Solana Tracker...');
        setProgress(5);

        const results = await scanWalletsForTokens(
          state.mints,
          state.minMatches,
          state.minTrades,
          (p) => {
            setPhase(p.phase);
            setProgressData(p);
            setProgressText(buildProgressText(p));
            const fetchPct = p.totalTokens > 0 ? (p.currentToken / p.totalTokens) * 70 : 20;
            const phaseBonus = p.phase === 'finding' ? 75 : p.phase === 'ranking' ? 90 : fetchPct;
            setProgress(Math.min(95, phaseBonus));
          }
        );

        setPhase('ranking');
        setProgressText(`${formatNumber(results.length, 0)} wallets matched • Almost done...`);
        setProgress(98);
        setWallets(results);

        await new Promise((r) => setTimeout(r, 400));
        setProgress(100);

        setTimeout(() => {
          navigate('/scanner/results', {
            state: { ...state, wallets: results },
          });
        }, 500);
      } catch (err: any) {
        console.error('Error scanning wallets:', err);
        const friendly = toUserMessage(err, 'Couldn\'t scan wallets. Please try again.');
        setError(friendly);
        toast.error(friendly);

        setTimeout(() => {
          navigate('/scanner');
        }, 2000);
      }
    };

    scanWallets();
  }, [navigate, state]);

  const phaseText = {
    fetching: progressText || 'Fetching token transactions...',
    finding: progressText || 'Finding recurring wallets...',
    ranking: progressText || 'Calculating PnL & ROI...',
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
          <p className="text-white/60 text-sm min-h-[2.5rem] flex items-center justify-center">
            {phaseText[phase]}
          </p>
        </div>

        <div className="space-y-3 mb-8">
          {state?.mints.slice(0, 5).map((mint, index) => {
            const fetched = progressData && index < progressData.currentToken;
            return (
            <Card key={index} className="flex items-center gap-3 min-h-[44px]">
              {fetched ? (
                <CheckCircle2 className="w-5 h-5 text-[#12d585] flex-shrink-0" />
              ) : (
                <Loader2 className="w-5 h-5 text-white/30 animate-spin flex-shrink-0" />
              )}
              <code className="text-sm font-mono text-white/70 truncate">
                {mint.slice(0, 8)}...{mint.slice(-6)}
              </code>
            </Card>
          );
          })}
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
