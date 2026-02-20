import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { BackButton } from "@/components/BackButton";
import { Loader2, Search } from "lucide-react";
import {
  findUserByWalletAddress,
  findUserByXHandle,
  searchUsersByHandle,
  type UserSearchResult,
} from "@/lib/auth";
import { toast } from "sonner";
import { shortenAddress } from "@/lib/utils";

export function CopeWallet() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchTypeLabel, setSearchTypeLabel] = useState<
    "Wallet" | "X Account"
  >("Wallet");
  const [usernameResults, setUsernameResults] = useState<UserSearchResult[]>(
    [],
  );
  const [usernameLoading, setUsernameLoading] = useState(false);
  const [showUsernameDropdown, setShowUsernameDropdown] = useState(false);
  const usernameTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

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

  const isUsernameMode = detectSearchType(searchQuery) === "xhandle";

  // Debounced username search when input looks like a username (min 2 chars to limit Firestore reads)
  useEffect(() => {
    if (usernameTimeoutRef.current) clearTimeout(usernameTimeoutRef.current);
    if (
      !searchQuery.trim() ||
      !isUsernameMode ||
      searchQuery.trim().length < 2
    ) {
      setUsernameResults([]);
      setShowUsernameDropdown(false);
      return;
    }
    setUsernameLoading(true);
    usernameTimeoutRef.current = setTimeout(async () => {
      try {
        const results = await searchUsersByHandle(searchQuery.trim(), 20);
        setUsernameResults(results);
        setShowUsernameDropdown(
          results.length > 0 || searchQuery.trim().length >= 1,
        );
      } catch {
        setUsernameResults([]);
      } finally {
        setUsernameLoading(false);
      }
    }, 300);
    return () => {
      if (usernameTimeoutRef.current) clearTimeout(usernameTimeoutRef.current);
    };
  }, [searchQuery, isUsernameMode]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setShowUsernameDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectUser = (user: UserSearchResult) => {
    setSearchQuery(user.xHandle || user.displayName || "");
    setUsernameResults([]);
    setShowUsernameDropdown(false);
    navigate("/cope/wallet/found", {
      state: {
        address: user.walletAddress,
        userData: {
          uid: user.uid,
          displayName: user.displayName,
          xHandle: user.xHandle,
          avatar: user.avatar,
          walletAddress: user.walletAddress,
        },
      },
    });
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
          toast.error("User not found or wallet is private");
        } else {
          // Wallet not found - not on COPE
          navigate("/cope/wallet/new", {
            state: { address: walletAddress },
          });
        }
      }
    } catch (error: any) {
      console.error("Error searching:", error);
      toast.error("Search failed. Please try again.");
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
          <div ref={containerRef} className="relative">
            <label className="block text-sm font-medium mb-2">
              Search by Wallet or X Account
            </label>
            <div className="relative">
              {isUsernameMode && (
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-white/40 pointer-events-none z-10" />
              )}
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
                onFocus={() =>
                  isUsernameMode &&
                  usernameResults.length > 0 &&
                  setShowUsernameDropdown(true)
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleSearch();
                  }
                }}
                className={`font-mono ${isUsernameMode ? "pl-10" : ""}`}
              />
              {isUsernameMode && usernameLoading && (
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                  <Loader2 className="w-4 h-4 text-white/40 animate-spin" />
                </div>
              )}
            </div>
            <p className="text-xs text-white/60 mt-2">
              Automatically detected as {searchTypeLabel}
            </p>

            {/* Username search dropdown (like token search) */}
            {showUsernameDropdown && usernameResults.length > 0 && (
              <div className="absolute z-50 w-full mt-2 max-h-[320px] overflow-y-auto bg-[#0a0a0a] border border-white/10 rounded-[12px] shadow-xl">
                <div className="p-2">
                  {usernameResults.map((user) => (
                    <button
                      key={user.uid}
                      type="button"
                      onClick={() => handleSelectUser(user)}
                      className="w-full p-3 rounded-lg hover:bg-white/5 transition-colors text-left group flex items-center gap-3"
                    >
                      {user.avatar ? (
                        <img
                          src={user.avatar}
                          alt=""
                          className="w-10 h-10 rounded-full flex-shrink-0 object-cover"
                        />
                      ) : (
                        <div className="w-10 h-10 rounded-full flex-shrink-0 bg-white/10 flex items-center justify-center text-white/60 text-sm">
                          {(user.xHandle ||
                            user.displayName ||
                            "?")[1]?.toUpperCase() ?? "?"}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-white group-hover:text-[#12d585] transition-colors truncate">
                          {user.displayName || user.xHandle || "–"}
                        </div>
                        <div className="text-xs text-white/50 font-mono truncate">
                          {user.xHandle}
                        </div>
                      </div>
                      <div className="text-xs text-white/40 font-mono flex-shrink-0">
                        {shortenAddress(user.walletAddress)}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {isUsernameMode &&
              !usernameLoading &&
              searchQuery.trim().length >= 1 &&
              usernameResults.length === 0 &&
              showUsernameDropdown && (
                <div className="absolute z-50 w-full mt-2 p-4 bg-[#0a0a0a] border border-white/10 rounded-[12px] shadow-xl text-center text-white/60 text-sm">
                  No users found
                </div>
              )}
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
