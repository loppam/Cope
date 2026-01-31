import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { BackButton } from "@/components/BackButton";
import { Plus, X } from "lucide-react";

export function ScannerInput() {
  const navigate = useNavigate();
  const [mints, setMints] = useState<string[]>(["", ""]);
  const [lookback, setLookback] = useState("30D");
  // Default values for scanning
  const minMatches = 2;
  const minTrades = 2;

  const addMintRow = () => {
    if (mints.length < 10) {
      setMints([...mints, ""]);
    }
  };

  const removeMintRow = (index: number) => {
    if (mints.length > 2) {
      setMints(mints.filter((_, i) => i !== index));
    }
  };

  const updateMint = (index: number, value: string) => {
    const newMints = [...mints];
    newMints[index] = value;
    setMints(newMints);
  };

  const validMints = mints.filter((m) => m.trim().length > 0);
  const canScan = validMints.length >= 2;

  const handleScan = () => {
    if (canScan) {
      navigate("/scanner/loading", {
        state: { mints: validMints, lookback, minMatches, minTrades },
      });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#000000] to-[#0B3D2E]">
      <div className="p-4">
        <BackButton onClick={() => navigate(-1)} />
      </div>

      <div className="p-4 sm:p-6 max-w-[720px] mx-auto pb-8">
        <div className="mb-6 sm:mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold mb-1 sm:mb-2">
            COPE Scanner
          </h1>
          <p className="text-sm sm:text-base text-white/60">
            Find wallets that traded multiple tokens
          </p>
        </div>

        <div className="space-y-6">
          {/* Token Mints */}
          <div>
            <label className="block text-sm font-medium mb-3">
              Token Mint Addresses ({validMints.length}/10)
            </label>
            <div className="space-y-2">
              {mints.map((mint, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    placeholder={`Mint address ${index + 1}`}
                    value={mint}
                    onChange={(e) => updateMint(index, e.target.value)}
                    className="font-mono text-sm"
                  />
                  {mints.length > 2 && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => removeMintRow(index)}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            {mints.length < 10 && (
              <Button
                variant="ghost"
                onClick={addMintRow}
                className="mt-2 h-10 px-0"
              >
                <Plus className="w-4 h-4" />
                Add token
              </Button>
            )}
          </div>

          {/* Lookback Period */}
          <div>
            <label className="block text-sm font-medium mb-3">
              Lookback Period
            </label>
            <div className="flex gap-2">
              {["7D", "30D", "90D"].map((period) => (
                <button
                  key={period}
                  onClick={() => setLookback(period)}
                  className={`flex-1 min-h-[44px] rounded-xl text-sm font-medium transition-all ${
                    lookback === period
                      ? "bg-gradient-to-r from-[#12d585] to-[#08b16b] text-[#000000]"
                      : "bg-white/5 text-white hover:bg-white/10"
                  }`}
                >
                  {period}
                </button>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="space-y-3 pt-4">
            <Button
              onClick={handleScan}
              disabled={!canScan}
              className="w-full h-12 min-h-[48px]"
            >
              Scan Wallets
            </Button>
          </div>

          {!canScan && (
            <p className="text-sm text-white/50 text-center">
              Add at least 2 token addresses to scan
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
