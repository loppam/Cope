import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { Input } from "@/components/Input";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { getTokenAccounts } from "@/lib/rpc";
import { getIntentStatus } from "@/lib/relay";

const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

type WithdrawNetwork = "base" | "bnb" | "solana";

export function Withdraw() {
  const navigate = useNavigate();
  const { user, userProfile } = useAuth();
  const [network, setNetwork] = useState<WithdrawNetwork>("solana");
  const [amount, setAmount] = useState("");
  const [destinationAddress, setDestinationAddress] = useState("");
  const [usdcBalance, setUsdcBalance] = useState(0);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [quote, setQuote] = useState<unknown>(null);
  const [requestId, setRequestId] = useState<string | null>(null);

  const walletAddress = userProfile?.walletAddress;

  useEffect(() => {
    if (!walletAddress) return;
    getTokenAccounts(walletAddress).then((accounts) => {
      const usdc = accounts.find((a) => a.mint === USDC_MINT);
      setUsdcBalance(usdc?.uiAmount ?? 0);
    });
  }, [walletAddress]);

  const fetchWithdrawQuote = async () => {
    if (!user || !walletAddress) return;
    const num = parseFloat(amount);
    if (!Number.isFinite(num) || num <= 0 || num > usdcBalance) {
      toast.error("Enter a valid amount");
      return;
    }
    if (!destinationAddress.trim() || destinationAddress.length < 20) {
      toast.error("Enter a valid destination address");
      return;
    }
    setQuoteLoading(true);
    setQuote(null);
    setRequestId(null);
    try {
      const token = await user.getIdToken();
      const base = import.meta.env.VITE_API_BASE_URL || "";
      const res = await fetch(`${base}/api/relay/withdraw-quote`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          destinationNetwork: network,
          amount: num,
          destinationAddress: destinationAddress.trim(),
          originAddress: walletAddress,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to get quote");
      setQuote(data);
      const firstStep = data?.steps?.[0];
      if (firstStep?.requestId) setRequestId(firstStep.requestId);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to get quote");
    } finally {
      setQuoteLoading(false);
    }
  };

  const executeWithdraw = async () => {
    if (!user || !quote) return;
    setExecuting(true);
    try {
      const token = await user.getIdToken();
      const base = import.meta.env.VITE_API_BASE_URL || "";
      const res = await fetch(`${base}/api/relay/execute-step`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          quoteResponse: quote,
          stepIndex: 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Execution failed");
      if (data.signature) {
        toast.success("Withdraw submitted", {
          description: "Transaction sent. Relay will complete the transfer.",
        });
        setQuote(null);
        setAmount("");
        if (requestId) {
          let attempts = 0;
          const interval = setInterval(async () => {
            attempts++;
            try {
              const status = await getIntentStatus(requestId);
              if (status?.status === "filled" || status?.status === "complete") {
                clearInterval(interval);
                toast.success("Withdraw complete");
                setUsdcBalance((prev) => Math.max(0, prev - parseFloat(amount)));
              }
            } catch {
              // ignore
            }
            if (attempts >= 30) clearInterval(interval);
          }, 2000);
        }
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Withdraw failed");
    } finally {
      setExecuting(false);
    }
  };

  const networkLabel = network === "solana" ? "Solana" : network === "base" ? "Base" : "BNB";

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
        <h1 className="text-lg font-semibold">Withdraw</h1>
        <div className="w-10" />
      </div>

      <div className="flex-1 flex flex-col p-6 max-w-md mx-auto w-full min-w-0">
        <p className="text-white/60 text-sm mb-4">
          Withdraw USDC to {networkLabel}. You will receive USDC on the selected network.
        </p>

        <div className="flex rounded-[12px] bg-white/5 p-1 gap-1 mb-4">
          {(
            [
              { id: "base" as const, label: "Base" },
              { id: "bnb" as const, label: "BNB" },
              { id: "solana" as const, label: "Solana" },
            ] as const
          ).map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                setNetwork(id);
                setQuote(null);
              }}
              className={`flex-1 min-h-[44px] rounded-[10px] text-sm font-medium transition-colors touch-manipulation ${
                network === id ? "bg-accent-primary text-white" : "bg-transparent text-white/70 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="space-y-3 mb-4">
          <label className="block text-sm font-medium text-white/80">Amount (USDC)</label>
          <div className="flex gap-2">
            <Input
              type="number"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="flex-1 min-w-0"
            />
            <Button
              variant="outline"
              onClick={() => setAmount(usdcBalance.toFixed(2))}
              className="min-h-[44px] shrink-0"
            >
              Max
            </Button>
          </div>
          <p className="text-xs text-white/50">Available: {usdcBalance.toFixed(2)} USDC</p>
        </div>

        <div className="space-y-3 mb-6">
          <label className="block text-sm font-medium text-white/80">
            Destination address ({networkLabel})
          </label>
          <Input
            type="text"
            placeholder={network === "solana" ? "Solana address" : "0x..."}
            value={destinationAddress}
            onChange={(e) => setDestinationAddress(e.target.value)}
            className="min-w-0"
          />
        </div>

        {!quote ? (
          <Button
            onClick={fetchWithdrawQuote}
            disabled={quoteLoading || !amount || !destinationAddress}
            className="w-full min-h-[44px]"
          >
            {quoteLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Getting quote...
              </>
            ) : (
              "Get quote"
            )}
          </Button>
        ) : (
          <Card className="p-4 space-y-4">
            <p className="text-sm text-white/80">Review and confirm withdraw.</p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 min-h-[44px]"
                onClick={() => setQuote(null)}
                disabled={executing}
              >
                Back
              </Button>
              <Button
                className="flex-1 min-h-[44px]"
                onClick={executeWithdraw}
                disabled={executing}
              >
                {executing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  "Confirm"
                )}
              </Button>
            </div>
          </Card>
        )}

        <button
          onClick={() => navigate("/app/profile")}
          className="w-full text-center text-sm text-white/60 hover:text-white mt-4 min-h-[44px] flex items-center justify-center"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
