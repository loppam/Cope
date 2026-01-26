import { Card } from '@/components/Card';
import { TrendingUp, TrendingDown, DollarSign } from 'lucide-react';
import { formatCurrency, formatPercentage } from '@/lib/utils';

export function Positions() {
  const mockPositions = [
    {
      symbol: 'BONK',
      amount: 1000000,
      value: 245.50,
      pnl: 45.20,
      pnlPercent: 22.5,
      change24h: 5.8,
    },
    {
      symbol: 'WIF',
      amount: 150,
      value: 420.00,
      pnl: -12.30,
      pnlPercent: -2.8,
      change24h: -1.2,
    },
  ];

  const totalValue = mockPositions.reduce((acc, pos) => acc + pos.value, 0);
  const totalPnl = mockPositions.reduce((acc, pos) => acc + pos.pnl, 0);
  const totalPnlPercent = (totalPnl / (totalValue - totalPnl)) * 100;

  return (
    <div className="p-6 max-w-[720px] mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-6">Positions</h1>

        {/* Portfolio Summary */}
        <Card glass className="mb-6">
          <div className="text-center">
            <p className="text-sm text-white/60 mb-1">Total Value</p>
            <h2 className="text-3xl font-bold mb-1">{formatCurrency(totalValue)}</h2>
            <p
              className={`text-lg ${
                totalPnl >= 0 ? 'text-[#12d585]' : 'text-[#FF4757]'
              }`}
            >
              {formatCurrency(totalPnl)} ({formatPercentage(totalPnlPercent)})
            </p>
          </div>
        </Card>
      </div>

      {/* Positions List */}
      <div className="space-y-3">
        {mockPositions.length > 0 ? (
          mockPositions.map((position) => (
            <Card key={position.symbol} className="cursor-pointer hover:border-white/20">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#12d585] to-[#08b16b]" />
                  <div>
                    <h3 className="font-semibold">{position.symbol}</h3>
                    <p className="text-sm text-white/50">{position.amount.toLocaleString()}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-semibold">{formatCurrency(position.value)}</p>
                  <p
                    className={`text-sm flex items-center gap-1 ${
                      position.change24h >= 0 ? 'text-[#12d585]' : 'text-[#FF4757]'
                    }`}
                  >
                    {position.change24h >= 0 ? (
                      <TrendingUp className="w-3 h-3" />
                    ) : (
                      <TrendingDown className="w-3 h-3" />
                    )}
                    {formatPercentage(position.change24h)}
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-white/6 flex items-center justify-between text-sm">
                <span className="text-white/60">P&L</span>
                <span
                  className={`font-medium ${
                    position.pnl >= 0 ? 'text-[#12d585]' : 'text-[#FF4757]'
                  }`}
                >
                  {formatCurrency(position.pnl)} ({formatPercentage(position.pnlPercent)})
                </span>
              </div>
            </Card>
          ))
        ) : (
          <div className="text-center py-16">
            <DollarSign className="w-12 h-12 mx-auto mb-4 text-white/30" />
            <p className="text-white/60">No positions yet</p>
          </div>
        )}
      </div>
    </div>
  );
}
