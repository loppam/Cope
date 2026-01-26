import { useNavigate } from "react-router";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Search, ScanLine, TrendingUp } from "lucide-react";

export function Home() {
  const navigate = useNavigate();

  return (
    <div className="p-6 max-w-[720px] mx-auto animate-fade-in">
      <div className="mb-12 mt-4 space-y-2">
        <h1 className="text-4xl font-bold tracking-tight text-white">
          Your Feed
        </h1>
        <p className="text-lg text-text-secondary">
          Follow wallets to see their plays
        </p>
      </div>

      {/* Empty State */}
      <div className="flex flex-col items-center justify-center py-8">
        <div className="w-24 h-24 rounded-full bg-surface-2 flex items-center justify-center mb-8">
          <TrendingUp className="w-10 h-10 text-accent-primary" />
        </div>

        <h3 className="text-2xl font-semibold mb-3">No Plays Yet</h3>
        <p className="text-text-secondary text-center mb-10 max-w-sm leading-relaxed">
          Start by COPEing wallets or running the Scanner to find top traders
        </p>

        <div className="w-full space-y-4 max-w-sm">
          <Button
            onClick={() => navigate("/cope/wallet")}
            className="w-full h-14 text-base"
            variant="primary"
          >
            <Search className="w-5 h-5" />
            COPE a Wallet
          </Button>

          <Button
            onClick={() => navigate("/scanner")}
            variant="secondary"
            className="w-full h-14 text-base"
          >
            <ScanLine className="w-5 h-5 text-accent-purple" />
            Run COPE Scanner
          </Button>

          <Button
            onClick={() => navigate("/app/trade")}
            variant="ghost"
            className="w-full text-text-muted hover:text-white"
          >
            Or paste a token CA to trade →
          </Button>
        </div>
      </div>

      {/* Info Cards */}
      <div className="mt-12 space-y-4">
        <Card className="bg-surface-1 border-border-subtle">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-lg bg-accent-purple/10 flex items-center justify-center">
              <span className="text-accent-purple text-lg">💡</span>
            </div>
            <h4 className="font-semibold text-lg">What is COPE?</h4>
          </div>
          <p className="text-base text-text-secondary leading-relaxed">
            <span className="text-accent-primary font-medium">COPE</span> =
            Catch Onchain Plays Early. Follow proven wallets, see their verified
            trades in real-time, and copy plays instantly.
          </p>
        </Card>
      </div>
    </div>
  );
}
