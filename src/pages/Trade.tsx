import { useState } from 'react';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { Card } from '@/components/Card';
import { DollarSign } from 'lucide-react';

export function Trade() {
  const [mint, setMint] = useState('');
  const [amount, setAmount] = useState('');

  const quickAmounts = [0.1, 0.5, 1];

  return (
    <div className="p-6 max-w-[720px] mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-2">Trade Terminal</h1>
        <p className="text-white/60">Paste token CA to trade instantly</p>
      </div>

      <div className="space-y-6">
        {/* Token Input */}
        <div>
          <label className="block text-sm font-medium mb-2">Token Contract Address</label>
          <Input
            placeholder="Paste Solana token mint address"
            value={mint}
            onChange={(e) => setMint(e.target.value)}
            className="font-mono text-sm"
          />
        </div>

        {mint && (
          <Card glass>
            <div className="mb-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#12d585] to-[#08b16b]" />
                <div>
                  <h3 className="font-semibold">TOKEN</h3>
                  <p className="text-sm text-white/60">$0.0042</p>
                </div>
              </div>
            </div>

            {/* Buy Section */}
            <div className="mb-6">
              <label className="block text-sm font-medium mb-2">Buy Amount (SOL)</label>
              <Input
                type="number"
                placeholder="0.0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <div className="flex gap-2 mt-2">
                {quickAmounts.map((amt) => (
                  <button
                    key={amt}
                    onClick={() => setAmount(amt.toString())}
                    className="flex-1 h-8 rounded-[10px] bg-white/5 hover:bg-white/10 text-sm transition-colors"
                  >
                    {amt} SOL
                  </button>
                ))}
              </div>
            </div>

            <Button className="w-full h-12 mb-3">
              <DollarSign className="w-5 h-5" />
              Buy
            </Button>

            {/* Sell Section */}
            <div className="pt-4 border-t border-white/6">
              <p className="text-sm text-white/60 mb-2">Your Position: 0 TOKEN</p>
              <div className="flex gap-2">
                {[25, 50, 75].map((pct) => (
                  <button
                    key={pct}
                    disabled
                    className="flex-1 h-8 rounded-[10px] bg-white/5 text-sm text-white/30"
                  >
                    {pct}%
                  </button>
                ))}
              </div>
              <Button variant="outline" className="w-full h-10 mt-2" disabled>
                Sell All
              </Button>
            </div>
          </Card>
        )}

        {!mint && (
          <div className="text-center py-16">
            <DollarSign className="w-12 h-12 mx-auto mb-4 text-white/30" />
            <p className="text-white/60">Paste a token address to start trading</p>
          </div>
        )}
      </div>
    </div>
  );
}
