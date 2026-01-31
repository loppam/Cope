import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Card } from "@/components/Card";
import { Check, Star } from "lucide-react";
import { shortenAddress } from "@/lib/utils";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface UserData {
  uid: string;
  displayName: string | null;
  xHandle: string | null;
  avatar: string | null;
  walletAddress: string;
}

export function WalletFound() {
  const navigate = useNavigate();
  const location = useLocation();
  const { address, userData } = location.state as {
    address: string;
    userData?: UserData;
  };
  const { addToWatchlist, isAuthenticated } = useAuth();

  // Use displayName from userData as default nickname
  const displayName = userData?.displayName || userData?.xHandle || "";
  const [nickname, setNickname] = useState(displayName);
  const [isAdding, setIsAdding] = useState(false);

  // Update nickname if userData changes
  useEffect(() => {
    if (displayName && !nickname) {
      setNickname(displayName);
    }
  }, [displayName]);

  const handleCope = async () => {
    if (!isAuthenticated) {
      toast.error("Please sign in to COPE wallets");
      return;
    }

    try {
      setIsAdding(true);
      const finalNickname = nickname.trim() || displayName || undefined;
      await addToWatchlist(address, {
        nickname: finalNickname,
        onPlatform: true,
        uid: userData?.uid,
      });
      toast.success("Wallet added to watchlist!");
      navigate("/app/watchlist");
    } catch (error: any) {
      // Error already handled in addToWatchlist
    } finally {
      setIsAdding(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#000000] to-[#0B3D2E] p-6">
      <div className="max-w-md mx-auto">
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#12d585]/20 flex items-center justify-center">
            <Check className="w-8 h-8 text-[#12d585]" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Wallet Found!</h1>
          <p className="text-white/60">This trader is already on COPE</p>
        </div>

        <Card glass className="mb-6">
          <div className="text-center mb-4">
            {userData?.avatar ? (
              <img
                src={userData.avatar}
                alt={displayName || "User"}
                className="w-16 h-16 mx-auto mb-3 rounded-full object-cover"
              />
            ) : (
              <div className="w-16 h-16 mx-auto mb-3 rounded-full bg-gradient-to-br from-[#12d585] to-[#08b16b]" />
            )}
            <h3 className="font-bold text-lg">{displayName || "COPE User"}</h3>
            <code className="text-sm text-white/50 font-mono">
              {shortenAddress(address)}
            </code>
          </div>
        </Card>

        <div className="mb-6">
          <label className="block text-sm font-medium mb-2">
            Nickname{" "}
            {displayName && (
              <span className="text-white/50 text-xs">
                (default: {displayName})
              </span>
            )}
          </label>
          <Input
            placeholder={displayName || "e.g. Smart Trader, Whale..."}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
          />
          {displayName && (
            <p className="text-xs text-white/50 mt-1">
              This wallet belongs to {displayName} on COPE
            </p>
          )}
        </div>

        <Button
          onClick={handleCope}
          disabled={isAdding}
          className="w-full h-12 mb-3"
        >
          <Star className="w-5 h-5" />
          {isAdding ? "Adding..." : "Add to Watchlist"}
        </Button>

        <Button
          variant="outline"
          onClick={() => navigate("/app/home")}
          className="w-full h-10"
        >
          Back to Home
        </Button>
      </div>
    </div>
  );
}
