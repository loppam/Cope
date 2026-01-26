import { useNavigate, useParams } from 'react-router';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { ArrowLeft, TrendingUp, DollarSign } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

export function TokenDetail() {
  const navigate = useNavigate();
  const { mint } = useParams();

  // Mock chart data
  const chartData = Array.from({ length: 24 }, (_, i) => ({
    time: `${i}h`,
    price: 0.0042 + Math.random() * 0.001,
  }));

  const quickBuyAmounts = [0.1, 0.5, 1];
  const sellPercentages = [25, 50, 75];

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#000000] to-[#0B3D2E]">
      <div className="p-4">
        <Button variant="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
      </div>

      <div className="p-6 max-w-[720px] mx-auto">
        {/* Token Header */}
        <div className="flex items-center gap-4 mb-6">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#12d585] to-[#08b16b]" />
          <div>
            <h1 className="text-2xl font-bold">TOKEN</h1>
            <p className="text-white/60 text-sm">$0.0042</p>
          </div>
          <div className="ml-auto text-right">
            <p className="text-[#12d585] flex items-center gap-1">
              <TrendingUp className="w-4 h-4" />
              +5.8%
            </p>
            <p className="text-xs text-white/50">24h</p>
          </div>
        </div>

        {/* Chart */}
        <Card glass className="mb-6 h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <XAxis dataKey="time" stroke="rgba(255,255,255,0.2)" hide />
              <YAxis stroke="rgba(255,255,255,0.2)" hide domain={['auto', 'auto']} />
              <Tooltip
                contentStyle={{
                  background: '#0F4A38',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '12px',
                }}
              />
              <Line type="monotone" dataKey="price" stroke="#12d585" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </Card>

        {/* Buy Section */}
        <Card className="mb-4">
          <h3 className="font-semibold mb-3">Buy</h3>
          <div className="flex gap-2 mb-4">
            {quickBuyAmounts.map((amount) => (
              <button
                key={amount}
                className="flex-1 h-10 rounded-[12px] bg-gradient-to-r from-[#12d585] to-[#08b16b] text-[#000000] font-medium hover:opacity-90"
              >
                {amount} SOL
              </button>
            ))}
          </div>
        </Card>

        {/* Sell Section */}
        <Card>
          <h3 className="font-semibold mb-3">Sell</h3>
          <p className="text-sm text-white/60 mb-3">Position: 0 TOKEN</p>
          <div className="flex gap-2 mb-2">
            {sellPercentages.map((pct) => (
              <button
                key={pct}
                disabled
                className="flex-1 h-10 rounded-[12px] bg-white/5 text-white/30 font-medium"
              >
                {pct}%
              </button>
            ))}
          </div>
          <Button variant="outline" className="w-full h-10" disabled>
            <DollarSign className="w-4 h-4" />
            Sell All
          </Button>
        </Card>
      </div>
    </div>
  );
}
