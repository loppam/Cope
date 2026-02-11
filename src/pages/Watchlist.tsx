import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router";
import { motion } from "motion/react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { BackButton } from "@/components/BackButton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ExternalLink,
  Trash2,
  Users,
  Twitter,
  Eye,
  UserPlus,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { shortenAddress } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { getUserProfile } from "@/lib/auth";
import { getFollowersList, getFollowersCount } from "@/lib/profile";
import { toast } from "sonner";
import type { WatchedWallet } from "@/lib/auth";

type TabId = "following" | "watchlist" | "followers";

export function Watchlist() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialState = (location.state as { tab?: TabId })?.tab;
  const [activeTab, setActiveTab] = useState<TabId>(
    initialState === "followers" || initialState === "watchlist"
      ? initialState
      : "following",
  );

  const {
    user,
    watchlist,
    addToWatchlist,
    removeFromWatchlist,
    isAuthenticated,
    loading: authLoading,
  } = useAuth();
  const [removingWallets, setRemovingWallets] = useState<Set<string>>(
    new Set(),
  );
  const [removingUids, setRemovingUids] = useState<Set<string>>(new Set());
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [savingNickname, setSavingNickname] = useState(false);
  const [followingProfiles, setFollowingProfiles] = useState<
    Record<
      string,
      { xHandle?: string; avatar?: string; walletAddress?: string }
    >
  >({});
  const [followersCount, setFollowersCount] = useState<number | null>(null);
  const [followersList, setFollowersList] = useState<Array<{ uid: string }>>(
    [],
  );
  const [followersProfiles, setFollowersProfiles] = useState<
    Record<
      string,
      { xHandle?: string; avatar?: string; walletAddress?: string }
    >
  >({});
  const [followersLoading, setFollowersLoading] = useState(false);

  const following = watchlist.filter(
    (w): w is WatchedWallet & { uid: string } =>
      w.onPlatform === true && !!w.uid,
  );
  const watchlistExternal = watchlist.filter((w) => !w.onPlatform);
  const followingUids = following.map((w) => w.uid);

  useEffect(() => {
    if (followingUids.length === 0) {
      setFollowingProfiles({});
      return;
    }
    const load = async () => {
      const profiles: typeof followingProfiles = {};
      await Promise.all(
        following.map(async (w) => {
          if (!w.uid) return;
          const profile = await getUserProfile(w.uid);
          if (profile) {
            profiles[w.uid] = {
              xHandle: profile.xHandle || profile.displayName,
              avatar: profile.avatar || profile.photoURL,
              walletAddress: profile.walletAddress,
            };
          }
        }),
      );
      setFollowingProfiles(profiles);
    };
    load();
  }, [followingUids.join(",")]);

  useEffect(() => {
    if (!user) return;
    user
      .getIdToken()
      .then((token) => getFollowersCount(token))
      .then(setFollowersCount)
      .catch(() => setFollowersCount(0));
  }, [user]);

  useEffect(() => {
    if (activeTab !== "followers" || !user) return;
    setFollowersLoading(true);
    user
      .getIdToken()
      .then((token) => getFollowersList(token))
      .then(setFollowersList)
      .catch(() => setFollowersList([]))
      .finally(() => setFollowersLoading(false));
  }, [activeTab, user]);

  const followersUids = followersList.map((f) => f.uid);
  useEffect(() => {
    if (followersUids.length === 0) {
      setFollowersProfiles({});
      return;
    }
    const load = async () => {
      const profiles: typeof followersProfiles = {};
      await Promise.all(
        followersUids.map(async (uid) => {
          const profile = await getUserProfile(uid);
          if (profile) {
            profiles[uid] = {
              xHandle: profile.xHandle || profile.displayName,
              avatar: profile.avatar || profile.photoURL,
              walletAddress: profile.walletAddress,
            };
          }
        }),
      );
      setFollowersProfiles(profiles);
    };
    load();
  }, [followersUids.join(",")]);

  const getGmgnLink = (address: string) =>
    `https://gmgn.ai/sol/address/${address}`;

  const handleRemoveWallet = async (
    e: React.MouseEvent,
    walletAddress: string,
  ) => {
    e.stopPropagation();
    if (!isAuthenticated) {
      toast.error("Please sign in");
      return;
    }
    try {
      setRemovingWallets((prev) => new Set(prev).add(walletAddress));
      await removeFromWatchlist(walletAddress);
    } catch {
      /* handled in removeFromWatchlist */
    } finally {
      setRemovingWallets((prev) => {
        const next = new Set(prev);
        next.delete(walletAddress);
        return next;
      });
    }
  };

  const handleUnfollow = async (e: React.MouseEvent, uid: string) => {
    e.stopPropagation();
    if (!isAuthenticated) {
      toast.error("Please sign in");
      return;
    }
    try {
      setRemovingUids((prev) => new Set(prev).add(uid));
      await removeFromWatchlist("", { uid });
      toast.success("Unfollowed");
    } catch {
      /* handled in removeFromWatchlist */
    } finally {
      setRemovingUids((prev) => {
        const next = new Set(prev);
        next.delete(uid);
        return next;
      });
    }
  };

  const handleStartEdit = (
    key: string,
    currentName: string,
    e?: React.MouseEvent,
  ) => {
    e?.stopPropagation();
    setEditingKey(key);
    setEditingValue(currentName || "");
  };

  const handleCancelEdit = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditingKey(null);
    setEditingValue("");
  };

  const handleSaveNickname = async (
    walletAddress: string,
    options?: { onPlatform?: boolean; uid?: string },
  ) => {
    if (!isAuthenticated) {
      toast.error("Please sign in");
      return;
    }
    if (!walletAddress?.trim()) {
      toast.error("Cannot update: wallet address missing");
      return;
    }
    const trimmed = editingValue.trim();
    setSavingNickname(true);
    try {
      await addToWatchlist(
        walletAddress,
        { nickname: trimmed || undefined, ...options },
        { suppressToast: true },
      );
      setEditingKey(null);
      setEditingValue("");
      toast.success("Name updated");
    } catch {
      toast.error("Failed to update name");
    } finally {
      setSavingNickname(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#000000] to-[#0B3D2E] flex items-center justify-center">
        <div className="text-white/60">Loading...</div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#000000] to-[#0B3D2E] p-6">
        <div className="max-w-[720px] mx-auto">
          <h1 className="text-2xl font-bold mb-6">Following & Watchlist</h1>
          <Card className="text-center py-12">
            <p className="text-white/60 mb-4">
              Please sign in to view your watchlist
            </p>
            <Button onClick={() => navigate("/auth/x-connect")}>Sign In</Button>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#000000] to-[#0B3D2E]">
      <div className="p-4">
        <BackButton onClick={() => navigate(-1)} />
      </div>
      <div className="p-4 sm:p-6 max-w-[720px] mx-auto pb-8">
        <div className="mb-4 sm:mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold mb-1 sm:mb-2">
            Social
          </h1>
          <p className="text-sm sm:text-base text-white/60">
            Platform users you follow and external wallets you watch
          </p>
        </div>

        {
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as TabId)}
            className="w-full"
          >
            <TabsList className="w-full grid grid-cols-3 mb-4 bg-white/5 border border-white/10 p-1 rounded-xl min-w-0 overflow-hidden transition-colors duration-200">
              <TabsTrigger
                value="following"
                className="data-[state=active]:bg-accent-primary/20 data-[state=active]:text-accent-primary data-[state=active]:border-accent-primary/30 rounded-lg py-2.5 px-2 min-w-0 max-w-full text-xs sm:text-sm overflow-hidden justify-center gap-1 sm:gap-2 transition-all duration-200"
              >
                <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
                <span className="truncate">
                  <span className="hidden sm:inline">Following </span>(
                  {following.length})
                </span>
              </TabsTrigger>
              <TabsTrigger
                value="watchlist"
                className="data-[state=active]:bg-accent-primary/20 data-[state=active]:text-accent-primary data-[state=active]:border-accent-primary/30 rounded-lg py-2.5 px-2 min-w-0 max-w-full text-xs sm:text-sm overflow-hidden justify-center gap-1 sm:gap-2 transition-all duration-200"
              >
                <Eye className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
                <span className="truncate">
                  <span className="hidden sm:inline">Watchlist </span>(
                  {watchlistExternal.length})
                </span>
              </TabsTrigger>
              <TabsTrigger
                value="followers"
                className="data-[state=active]:bg-accent-primary/20 data-[state=active]:text-accent-primary data-[state=active]:border-accent-primary/30 rounded-lg py-2.5 px-2 min-w-0 max-w-full text-xs sm:text-sm overflow-hidden justify-center gap-1 sm:gap-2 transition-all duration-200"
              >
                <UserPlus className="w-3.5 h-3.5 sm:w-4 sm:h-4 flex-shrink-0" />
                <span className="truncate">
                  <span className="hidden sm:inline">Followers </span>(
                  {followersCount ?? followersList.length})
                </span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="following" className="mt-0">
              <Card glass className="overflow-hidden">
                <div className="h-1 bg-gradient-to-r from-[#12d585]/40 via-[#08b16b]/30 to-transparent" />
                {following.length === 0 ? (
                  <div className="py-10 sm:py-12 px-4 text-center text-white/60">
                    <Users className="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-4 opacity-50" />
                    <p className="text-sm sm:text-base">
                      You're not following anyone yet
                    </p>
                    <Button
                      variant="ghost"
                      className="mt-4 text-accent-primary min-h-[44px]"
                      onClick={() =>
                        navigate("/app/tscanner", { state: { tab: "discover" } })
                      }
                    >
                      Discover traders
                    </Button>
                  </div>
                ) : (
                  <motion.div
                    className="divide-y divide-white/5"
                    initial="initial"
                    animate="animate"
                    variants={{
                      animate: {
                        transition: {
                          staggerChildren: 0.04,
                          delayChildren: 0.05,
                        },
                      },
                    }}
                  >
                    {following.map((entry) => {
                      const profile = followingProfiles[entry.uid];
                      const xHandle = profile?.xHandle || entry.nickname || "—";
                      const displayAddress =
                        profile?.walletAddress || entry.address;
                      const xUsername = xHandle.replace(/^@/, "");
                      const xUrl =
                        xUsername && xUsername !== "—"
                          ? `https://x.com/${xUsername}`
                          : null;

                      return (
                        <motion.div
                          key={entry.uid}
                          variants={{
                            initial: { opacity: 0, y: 10 },
                            animate: {
                              opacity: 1,
                              y: 0,
                              transition: { duration: 0.3, ease: "easeOut" },
                            },
                          }}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 sm:p-4 hover:bg-white/5 transition-colors min-h-[56px]"
                        >
                          <div
                            className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                            onClick={() =>
                              displayAddress &&
                              navigate(`/scanner/wallet/${displayAddress}`)
                            }
                          >
                            {profile?.avatar ? (
                              <img
                                src={profile.avatar}
                                alt=""
                                className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl object-cover flex-shrink-0"
                              />
                            ) : (
                              <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-gradient-to-br from-[#12d585]/30 to-[#08b16b]/30 flex items-center justify-center flex-shrink-0">
                                <Users className="w-4 h-4 sm:w-5 sm:h-5 text-accent-primary" />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 min-w-0">
                                {editingKey === `follow:${entry.uid}` ? (
                                  <div
                                    className="flex items-center gap-1 min-w-0"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <input
                                      type="text"
                                      value={editingValue}
                                      onChange={(e) =>
                                        setEditingValue(e.target.value)
                                      }
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter")
                                          handleSaveNickname(
                                            displayAddress || entry.address,
                                            {
                                              onPlatform: true,
                                              uid: entry.uid,
                                            },
                                          );
                                        if (e.key === "Escape")
                                          handleCancelEdit();
                                      }}
                                      onBlur={() => {
                                        if (displayAddress || entry.address)
                                          handleSaveNickname(
                                            displayAddress || entry.address,
                                            {
                                              onPlatform: true,
                                              uid: entry.uid,
                                            },
                                          );
                                      }}
                                      autoFocus
                                      className="flex-1 min-w-0 px-2 py-1 rounded bg-white/10 text-white text-sm border border-white/20 focus:outline-none focus:border-accent-primary"
                                    />
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleSaveNickname(
                                          displayAddress || entry.address,
                                          {
                                            onPlatform: true,
                                            uid: entry.uid,
                                          },
                                        );
                                      }}
                                      disabled={
                                        savingNickname || !displayAddress
                                      }
                                      className="p-1 text-accent-primary hover:bg-accent-primary/20 rounded"
                                    >
                                      <Check className="w-4 h-4" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => handleCancelEdit(e)}
                                      className="p-1 text-white/60 hover:bg-white/10 rounded"
                                    >
                                      <X className="w-4 h-4" />
                                    </button>
                                  </div>
                                ) : (
                                  <>
                                    <span className="font-medium text-white truncate">
                                      {entry.nickname || xHandle}
                                    </span>
                                    {(displayAddress || entry.address) && (
                                      <button
                                        type="button"
                                        onClick={(e) =>
                                          handleStartEdit(
                                            `follow:${entry.uid}`,
                                            entry.nickname || xHandle,
                                            e,
                                          )
                                        }
                                        className="p-1 text-white/40 hover:text-accent-primary hover:bg-white/5 rounded shrink-0"
                                        aria-label="Edit name"
                                      >
                                        <Pencil className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                    {xUrl && (
                                      <a
                                        href={xUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        className="text-accent-primary hover:text-accent-hover"
                                        title="View on X"
                                      >
                                        <Twitter className="w-4 h-4" />
                                      </a>
                                    )}
                                  </>
                                )}
                              </div>
                              <code className="text-xs text-white/50 font-mono">
                                {shortenAddress(displayAddress)}
                              </code>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => handleUnfollow(e, entry.uid)}
                            disabled={removingUids.has(entry.uid)}
                            className="text-[#FF4757] hover:text-[#FF4757] hover:bg-[#FF4757]/10 flex-shrink-0 min-h-[40px] w-full sm:w-auto"
                          >
                            {removingUids.has(entry.uid)
                              ? "Removing..."
                              : "Unfollow"}
                          </Button>
                        </motion.div>
                      );
                    })}
                  </motion.div>
                )}
              </Card>
            </TabsContent>

            <TabsContent value="watchlist" className="mt-0">
              <Card glass className="overflow-hidden">
                <div className="h-1 bg-gradient-to-r from-[#12d585]/40 via-[#08b16b]/30 to-transparent" />
                {watchlistExternal.length === 0 ? (
                  <div className="py-10 sm:py-12 px-4 text-center text-white/60">
                    <Eye className="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-4 opacity-50" />
                    <p className="text-sm sm:text-base">
                      No external wallets in your watchlist
                    </p>
                    <Button
                      variant="ghost"
                      className="mt-4 text-accent-primary min-h-[44px]"
                      onClick={() => navigate("/app/home")}
                    >
                      Add from scanner
                    </Button>
                  </div>
                ) : (
                  <motion.div
                    className="divide-y divide-white/5"
                    initial="initial"
                    animate="animate"
                    variants={{
                      animate: {
                        transition: {
                          staggerChildren: 0.04,
                          delayChildren: 0.05,
                        },
                      },
                    }}
                  >
                    {watchlistExternal.map((wallet) => (
                      <motion.div
                        key={wallet.address}
                        variants={{
                          initial: { opacity: 0, y: 10 },
                          animate: {
                            opacity: 1,
                            y: 0,
                            transition: { duration: 0.3, ease: "easeOut" },
                          },
                        }}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 sm:p-4 hover:bg-white/5 transition-colors cursor-pointer min-h-[56px]"
                        onClick={() =>
                          editingKey !== `watch:${wallet.address}` &&
                          navigate(`/scanner/wallet/${wallet.address}`)
                        }
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-white/5 flex items-center justify-center flex-shrink-0">
                            <Eye className="w-4 h-4 sm:w-5 sm:h-5 text-accent-primary" />
                          </div>
                          <div className="min-w-0 flex-1">
                            {editingKey === `watch:${wallet.address}` ? (
                              <div
                                className="flex items-center gap-1 min-w-0"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="text"
                                  value={editingValue}
                                  onChange={(e) =>
                                    setEditingValue(e.target.value)
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter")
                                      handleSaveNickname(wallet.address);
                                    if (e.key === "Escape") handleCancelEdit();
                                  }}
                                  onBlur={() =>
                                    handleSaveNickname(wallet.address)
                                  }
                                  autoFocus
                                  className="flex-1 min-w-0 px-2 py-1 rounded bg-white/10 text-white text-sm border border-white/20 focus:outline-none focus:border-accent-primary"
                                />
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSaveNickname(wallet.address);
                                  }}
                                  disabled={savingNickname}
                                  className="p-1 text-accent-primary hover:bg-accent-primary/20 rounded"
                                >
                                  <Check className="w-4 h-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => handleCancelEdit(e)}
                                  className="p-1 text-white/60 hover:bg-white/10 rounded"
                                >
                                  <X className="w-4 h-4" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-medium text-white block truncate">
                                  {wallet.nickname || "—"}
                                </span>
                                <button
                                  type="button"
                                  onClick={(e) =>
                                    handleStartEdit(
                                      `watch:${wallet.address}`,
                                      wallet.nickname || "",
                                      e,
                                    )
                                  }
                                  className="p-1 text-white/40 hover:text-accent-primary hover:bg-white/5 rounded shrink-0"
                                  aria-label="Edit name"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                            <code className="text-xs text-white/50 font-mono">
                              {shortenAddress(wallet.address)}
                            </code>
                          </div>
                          <a
                            href={getGmgnLink(wallet.address)}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-accent-primary hover:text-accent-hover p-2 rounded-lg hover:bg-white/5"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </a>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => handleRemoveWallet(e, wallet.address)}
                          disabled={removingWallets.has(wallet.address)}
                          className="text-[#FF4757] hover:text-[#FF4757] hover:bg-[#FF4757]/10 flex-shrink-0 min-h-[40px] w-full sm:w-auto"
                        >
                          {removingWallets.has(wallet.address) ? (
                            "Removing..."
                          ) : (
                            <Trash2 className="w-4 h-4" />
                          )}
                        </Button>
                      </motion.div>
                    ))}
                  </motion.div>
                )}
              </Card>
            </TabsContent>

            <TabsContent value="followers" className="mt-0">
              <Card glass className="overflow-hidden">
                <div className="h-1 bg-gradient-to-r from-[#12d585]/40 via-[#08b16b]/30 to-transparent" />
                {followersLoading ? (
                  <div className="py-10 sm:py-12 px-4 text-center text-white/60">
                    <div className="animate-pulse">Loading followers...</div>
                  </div>
                ) : followersList.length === 0 ? (
                  <div className="py-10 sm:py-12 px-4 text-center text-white/60">
                    <UserPlus className="w-10 h-10 sm:w-12 sm:h-12 mx-auto mb-4 opacity-50" />
                    <p className="text-sm sm:text-base">No followers yet</p>
                    <p className="text-xs sm:text-sm text-white/50 mt-2">
                      Share your profile when your wallet is public
                    </p>
                  </div>
                ) : (
                  <motion.div
                    className="divide-y divide-white/5"
                    initial="initial"
                    animate="animate"
                    variants={{
                      animate: {
                        transition: {
                          staggerChildren: 0.04,
                          delayChildren: 0.05,
                        },
                      },
                    }}
                  >
                    {followersList.map(({ uid }) => {
                      const profile = followersProfiles[uid];
                      const xHandle = profile?.xHandle || "—";
                      const displayAddress = profile?.walletAddress;
                      const xUsername = xHandle.replace(/^@/, "");
                      const xUrl =
                        xUsername && xUsername !== "—"
                          ? `https://x.com/${xUsername}`
                          : null;

                      return (
                        <motion.div
                          key={uid}
                          variants={{
                            initial: { opacity: 0, y: 10 },
                            animate: {
                              opacity: 1,
                              y: 0,
                              transition: { duration: 0.3, ease: "easeOut" },
                            },
                          }}
                          className="flex items-center justify-between p-3 sm:p-4 hover:bg-white/5 transition-colors min-h-[56px]"
                        >
                          <div
                            className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                            onClick={() =>
                              displayAddress &&
                              navigate(`/scanner/wallet/${displayAddress}`)
                            }
                          >
                            {profile?.avatar ? (
                              <img
                                src={profile.avatar}
                                alt=""
                                className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl object-cover flex-shrink-0"
                              />
                            ) : (
                              <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-gradient-to-br from-[#12d585]/30 to-[#08b16b]/30 flex items-center justify-center flex-shrink-0">
                                <UserPlus className="w-4 h-4 sm:w-5 sm:h-5 text-accent-primary" />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-white">
                                  {xHandle}
                                </span>
                                {xUrl && (
                                  <a
                                    href={xUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-accent-primary hover:text-accent-hover"
                                    title="View on X"
                                  >
                                    <Twitter className="w-4 h-4" />
                                  </a>
                                )}
                              </div>
                              {displayAddress && (
                                <code className="text-xs text-white/50 font-mono">
                                  {shortenAddress(displayAddress)}
                                </code>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </motion.div>
                )}
              </Card>
            </TabsContent>
          </Tabs>
        }
      </div>
    </div>
  );
}
