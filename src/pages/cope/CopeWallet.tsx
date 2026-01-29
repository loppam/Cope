import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { BackButton } from "@/components/BackButton";
import { Loader2 } from "lucide-react";
import { findUserByWalletAddress, findUserByXHandle } from "@/lib/auth";
import { toast } from "sonner";

export function CopeWallet() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchTypeLabel, setSearchTypeLabel] = useState<
    "Wallet" | "X Account"
  >("Wallet");

  const detectSearchType = (input: string): "wallet" | "xhandle" => {
    const trimmed = input.trim();
    if (
      trimmed.startsWith("@") ||
      (!trimmed.includes(" ") &&
        trimmed.length < 20 &&
        !trimmed.match(/^[A-Za-z0-9]{32,44}$/))
    ) {
      return "xhandle";
    }
    return "wallet";
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    try {
      setSearching(true);

      const query = searchQuery.trim();
      const detectedType = detectSearchType(query);
      setSearchTypeLabel(detectedType === "wallet" ? "Wallet" : "X Account");

      let userData = null;
      let walletAddress = query;

      if (detectedType === "xhandle") {
        // Search by X handle - only returns public users
        userData = await findUserByXHandle(query);
        if (userData) {
          walletAddress = userData.walletAddress;
        }
      } else {
        // Search by wallet address
        // Respect privacy: only show if user is public
        // Private users won't show up even if you have their wallet address
        userData = await findUserByWalletAddress(query, true);
      }

      if (userData && userData.walletAddress) {
        // User found - navigate to found page
        navigate("/cope/wallet/found", {
          state: {
            address: walletAddress,
            userData,
          },
        });
      } else {
        // User not found or private
        if (detectedType === "xhandle") {
          toast.error("User not found or their wallet is private");
        } else {
          // Wallet not found - not on COPE
          navigate("/cope/wallet/new", {
            state: { address: walletAddress },
          });
        }
      }
    } catch (error: any) {
      console.error("Error searching:", error);
      toast.error("Failed to search. Please try again.");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div
      className="min-h-screen bg-gradient-to-b from-[#000000] to-[#0B3D2E]"
      style={{
        paddingTop: `calc(1rem + var(--safe-area-inset-top))`,
      }}
    >
      <div className="p-4">
        <BackButton onClick={() => navigate(-1)} />
      </div>

      <div className="p-4 sm:p-6 max-w-[720px] mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2">COPE a Wallet</h1>
          <p className="text-white/60">
            Track any wallet's verified on-chain trades
          </p>
        </div>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2">
              Search by Wallet or X Account
            </label>
            <Input
              placeholder="Enter wallet address or @username"
              value={searchQuery}
              onChange={(e) => {
                const value = e.target.value;
                setSearchQuery(value);
                const detected = detectSearchType(value);
                setSearchTypeLabel(
                  detected === "wallet" ? "Wallet" : "X Account",
                );
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleSearch();
                }
              }}
              className="font-mono"
            />
            <p className="text-xs text-white/60 mt-2">
              Automatically detected as {searchTypeLabel}
            </p>
          </div>

          <Button
            onClick={handleSearch}
            disabled={!searchQuery.trim() || searching}
            className="w-full h-12"
          >
            {searching ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Searching...
              </>
            ) : (
              `Search ${searchTypeLabel}`
            )}
          </Button>

          <div className="pt-6 border-t border-white/6">
            <h3 className="font-semibold mb-3">Quick Tips</h3>
            <ul className="space-y-2 text-sm text-white/70">
              <li>• Search by wallet address or X (Twitter) username</li>
              <li>• Private wallets won't appear in X handle searches</li>
              <li>• Get real-time notifications when they trade</li>
              <li>• One-tap copy their plays instantly</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
