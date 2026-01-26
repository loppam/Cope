import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ArrowLeft, Copy, Eye, EyeOff, Check } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

export function FundWallet() {
  const navigate = useNavigate();
  const location = useLocation();
  const { userProfile } = useAuth();
  const [copied, setCopied] = useState(false);
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [mnemonicSaved, setMnemonicSaved] = useState(false);
  
  // Get wallet data from location state or Firebase
  const locationState = location.state as { mnemonic?: string; publicKey?: string; isNewWallet?: boolean } | null;
  const walletAddress = locationState?.publicKey || userProfile?.walletAddress || '';
  const mnemonic = locationState?.mnemonic;
  const isNewWallet = locationState?.isNewWallet || false;

  const copyAddress = () => {
    navigator.clipboard.writeText(walletAddress);
    setCopied(true);
    toast.success('Address copied!');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#000000] to-[#0B3D2E] flex flex-col">
      <div className="p-4 flex items-center justify-between">
        <Button variant="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <Button variant="text" onClick={() => navigate('/app/home')}>
          Skip for now
        </Button>
      </div>

      <div className="flex-1 flex flex-col p-6 max-w-md mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2">Fund Your Wallet</h1>
          <p className="text-white/60">Deposit SOL to start trading</p>
        </div>

        <div className="space-y-6">
          {isNewWallet && mnemonic && (
            <Card className="border-[#12d585]/50 bg-[#12d585]/5">
              <div className="mb-4">
                <h3 className="font-semibold text-[#12d585] mb-2 flex items-center gap-2">
                  <span>⚠️</span>
                  <span>Save Your Recovery Phrase</span>
                </h3>
                <p className="text-sm text-white/70 mb-4">
                  Write down these 12 words in order. This is the only way to recover your wallet if you lose access.
                </p>
                
                {!mnemonicSaved ? (
                  <>
                    <div className="relative">
                      <div className={`grid grid-cols-3 gap-2 p-4 rounded-[12px] bg-[#000000] border ${showMnemonic ? 'border-[#12d585]/50' : 'border-white/10'}`}>
                        {mnemonic.split(' ').map((word, index) => (
                          <div key={index} className="flex items-center gap-1 text-sm">
                            <span className="text-white/40 text-xs">{index + 1}.</span>
                            <span className="font-mono text-white/90">
                              {showMnemonic ? word : '••••••••'}
                            </span>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() => setShowMnemonic(!showMnemonic)}
                        className="absolute top-2 right-2 text-white/50 hover:text-white"
                      >
                        {showMnemonic ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    
                    <Button
                      onClick={() => {
                        navigator.clipboard.writeText(mnemonic);
                        toast.success('Recovery phrase copied!');
                      }}
                      variant="outline"
                      className="w-full mt-3 text-[#FFB84D] border-[#FFB84D]/30 hover:bg-[#FFB84D]/10"
                    >
                      <Copy className="w-4 h-4 mr-2" />
                      Copy Recovery Phrase
                    </Button>
                    
                    <Button
                      onClick={() => setMnemonicSaved(true)}
                      className="w-full mt-2 bg-[#12d585] hover:bg-[#12d585]/90 text-[#000000]"
                    >
                      <Check className="w-4 h-4 mr-2" />
                      I've Saved It
                    </Button>
                  </>
                ) : (
                  <div className="p-4 rounded-[12px] bg-[#12d585]/10 border border-[#12d585]/30">
                    <p className="text-sm text-[#12d585] flex items-center gap-2">
                      <Check className="w-4 h-4" />
                      Recovery phrase saved. Keep it secure!
                    </p>
                  </div>
                )}
              </div>
            </Card>
          )}

          <Card glass className="text-center">
            {walletAddress ? (
              <div className="w-48 h-48 mx-auto mb-4 bg-white rounded-[16px] flex items-center justify-center p-4">
                <QRCodeSVG
                  value={walletAddress}
                  size={192}
                  level="H"
                  includeMargin={false}
                />
              </div>
            ) : (
              <div className="w-48 h-48 mx-auto mb-4 bg-white/10 rounded-[16px] flex items-center justify-center">
                <p className="text-white/40 text-sm">No wallet address</p>
              </div>
            )}
            <p className="text-sm text-white/60 mb-2">Scan to deposit SOL</p>
          </Card>

          {walletAddress && (
            <Card>
              <div className="mb-3">
                <p className="text-sm text-white/60 mb-2">Your Wallet Address</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 bg-[#000000] rounded-[12px] text-sm font-mono text-white/90 overflow-hidden text-ellipsis">
                    {walletAddress}
                  </code>
                  <Button variant="outline" size="sm" onClick={copyAddress}>
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </Card>
          )}

          <div className="p-4 rounded-[16px] bg-[#54A0FF]/10 border border-[#54A0FF]/20">
            <p className="text-sm text-[#54A0FF]">
              💡 Tip: Minimum 0.05 SOL recommended to cover gas fees
            </p>
          </div>

          <Button onClick={() => navigate('/app/home')} className="w-full h-12">
            I've Deposited
          </Button>

          <button
            onClick={() => navigate('/app/home')}
            className="w-full text-center text-sm text-white/60 hover:text-white"
          >
            Continue without funding
          </button>
        </div>
      </div>
    </div>
  );
}
