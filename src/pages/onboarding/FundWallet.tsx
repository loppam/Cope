import { useState } from "react";
import { useNavigate, useLocation } from "react-router";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Input } from "@/components/Input";
import { ArrowLeft, Copy, Loader2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { getApiBase } from "@/lib/utils";

type DepositTab = "base" | "bnb" | "solana";

interface DepositQuoteResult {
  depositAddress: string | null;
  amount: string;
  amountFormatted: string;
  requestId: string | null;
  currency: string;
  network: string;
}

export function FundWallet() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, userProfile } = useAuth();
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<DepositTab>("solana");
  const [amountUsd, setAmountUsd] = useState("");
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quote, setQuote] = useState<DepositQuoteResult | null>(null);

  const locationState = location.state as {
    publicKey?: string;
    isNewWallet?: boolean;
  } | null;
  const walletAddress =
    locationState?.publicKey || userProfile?.walletAddress || "";

  const copyAddress = (value: string) => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    toast.success("Address copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  const fetchDepositQuote = async () => {
    if (!user || !walletAddress || (tab !== "base" && tab !== "bnb")) return;
    const num = parseFloat(amountUsd);
    if (!Number.isFinite(num) || num <= 0) {
      toast.error("Enter a valid amount");
      return;
    }
    setQuoteLoading(true);
    setQuote(null);
    try {
      const token = await user.getIdToken();
      const base = getApiBase();
      const res = await fetch(`${base}/api/relay/deposit-quote`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          network: tab,
          amountUsd: num,
          recipientSolAddress: walletAddress,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to get deposit info");
      setQuote(data);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to get deposit info");
    } finally {
      setQuoteLoading(false);
    }
  };

  const displayAddress = quote?.depositAddress || walletAddress;
  const showQr = !!displayAddress;
  const isCrossChain = tab === "base" || tab === "bnb";

  return (
    <div
      className="min-h-screen bg-gradient-to-b from-[#000000] to-[#0B3D2E] flex flex-col"
      style={{
        paddingTop: "var(--safe-area-inset-top)",
        paddingBottom: "var(--safe-area-inset-bottom)",
      }}
    >
      <div className="p-4 flex items-center justify-between">
        <Button variant="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <Button variant="text" onClick={() => navigate("/app/home")}>
          Skip for now
        </Button>
      </div>

      <div className="flex-1 flex flex-col p-6 max-w-md mx-auto w-full min-w-0">
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-2">Fund Your Wallet</h1>
          <p className="text-white/60">Deposit USDC to start trading</p>
        </div>

        {/* Tabs: Base USDC | BNB USDC | Solana USDC */}
        <div className="flex rounded-[12px] bg-white/5 p-1 gap-1 mb-6">
          {(
            [
              { id: "base" as const, label: "Base USDC" },
              { id: "bnb" as const, label: "BNB USDC" },
              { id: "solana" as const, label: "Solana USDC" },
            ] as const
          ).map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setTab(id);
                setQuote(null);
              }}
              className={`flex-1 min-h-[44px] rounded-[10px] text-sm font-medium transition-colors touch-manipulation ${
                tab === id ? "bg-accent-primary text-white" : "bg-transparent text-white/70 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {isCrossChain && (
          <div className="mb-4 space-y-3">
            <label className="block text-sm font-medium text-white/80">Amount (USDC)</label>
            <Input
              type="number"
              placeholder="0.00"
              value={amountUsd}
              onChange={(e) => setAmountUsd(e.target.value)}
              className="min-w-0"
            />
            <div className="flex gap-2">
              {[10, 50, 100, 500].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setAmountUsd(String(n))}
                  className="flex-1 min-h-[44px] rounded-[10px] bg-white/5 hover:bg-white/10 text-sm font-medium touch-manipulation"
                >
                  ${n}
                </button>
              ))}
            </div>
            <Button
              onClick={fetchDepositQuote}
              disabled={quoteLoading || !amountUsd}
              className="w-full min-h-[44px]"
            >
              {quoteLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Getting deposit info...
                </>
              ) : (
                "Get deposit address"
              )}
            </Button>
          </div>
        )}

        {quote && isCrossChain && (
          <div className="p-4 rounded-[16px] bg-[#54A0FF]/10 border border-[#54A0FF]/20 mb-4">
            <p className="text-sm text-[#54A0FF]">
              Send exactly <strong>{quote.amountFormatted} {quote.currency}</strong> on {quote.network.toUpperCase()} to the address below. You will receive ~{quote.amountFormatted} Solana USDC.
            </p>
          </div>
        )}

        <div className="space-y-6">
          <Card glass className="text-center">
            {showQr ? (
              <div className="w-48 h-48 mx-auto mb-4 bg-white rounded-[16px] flex items-center justify-center p-4">
                <QRCodeSVG
                  value={displayAddress}
                  size={192}
                  level="H"
                  includeMargin={false}
                />
              </div>
            ) : (
              <div className="w-48 h-48 mx-auto mb-4 bg-white/10 rounded-[16px] flex items-center justify-center">
                <p className="text-white/40 text-sm">No address</p>
              </div>
            )}
            <p className="text-sm text-white/60 mb-2">
              {isCrossChain && quote
                ? `Scan or send to deposit ${tab.toUpperCase()} USDC`
                : "Scan to deposit Solana USDC (SPL)"}
            </p>
          </Card>

          {displayAddress && (
            <Card>
              <div className="mb-3">
                <p className="text-sm text-white/60 mb-2">
                  {isCrossChain && quote ? "Deposit address" : "Your Solana wallet address"}
                </p>
                <div className="flex items-center gap-2 min-w-0">
                  <code className="flex-1 px-3 py-2 bg-[#000000] rounded-[12px] text-sm font-mono text-white/90 overflow-hidden text-ellipsis">
                    {displayAddress}
                  </code>
                  <Button variant="outline" size="sm" onClick={() => copyAddress(displayAddress)}>
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              {isCrossChain && quote && (
                <p className="text-xs text-white/50">
                  Amount: {quote.amountFormatted} USDC
                </p>
              )}
            </Card>
          )}

          {tab === "solana" && (
            <div className="p-4 rounded-[16px] bg-[#54A0FF]/10 border border-[#54A0FF]/20">
              <p className="text-sm text-[#54A0FF]">
                Send USDC (SPL) to this address on Solana. No conversion needed.
              </p>
            </div>
          )}

          <Button onClick={() => navigate("/app/home")} className="w-full min-h-[44px]">
            I&apos;ve Deposited
          </Button>

          <button
            onClick={() => navigate("/app/home")}
            className="w-full text-center text-sm text-white/60 hover:text-white min-h-[44px] flex items-center justify-center"
          >
            Continue without funding
          </button>
        </div>
      </div>
    </div>
  );
}
