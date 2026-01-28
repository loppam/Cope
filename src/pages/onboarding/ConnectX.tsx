import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { motion } from "motion/react";
import { Twitter, LogIn } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export function ConnectX() {
  const navigate = useNavigate();
  const { signInWithTwitter, userProfile, loading } = useAuth();
  const [isLoading, setIsLoading] = useState(false);

  const handleTwitterSignIn = async () => {
    try {
      setIsLoading(true);
      await signInWithTwitter();
      // After sign-in, AuthContext will update userProfile
      // We stay on this page and show the profile card
    } catch (error: any) {
      // Error is already handled in AuthContext with toast
      console.error("Twitter sign-in failed:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = () => {
    // Ensure profile is loaded
    if (loading) {
      console.log("[ConnectX] Still loading profile, waiting...");
      return;
    }

    // Check if user has a wallet - match ProtectedRoute logic
    const hasWallet = !!userProfile?.walletAddress;

    console.log("[ConnectX] Login clicked:", {
      hasWallet,
      walletAddress: userProfile?.walletAddress,
      isNew: userProfile?.isNew,
      userProfile: userProfile,
    });

    if (hasWallet) {
      // User has wallet, go to home
      console.log("[ConnectX] User has wallet, navigating to /app/home");
      navigate("/app/home", { replace: true });
    } else {
      // No wallet, go to wallet setup
      console.log(
        "[ConnectX] User has no wallet, navigating to /auth/wallet-setup",
      );
      navigate("/auth/wallet-setup", { replace: true });
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#000000] to-[#0B3D2E] flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center p-6 max-w-md mx-auto w-full">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full"
        >
          <div className="mb-8 text-center">
            <div className="mx-auto mb-6 flex justify-center">
              <svg
                width="81"
                height="32"
                viewBox="0 0 81 32"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="w-32 h-auto"
              >
                <path
                  d="M48.6631 6.37793V26.9648L44.4375 32H44.2754L40.0146 26.9229L40 6.43652L44.0029 1.66699H44.71L48.6631 6.37793ZM79.3027 4.22168L75.9854 9.81445L74.6104 12.2783L79.208 14.4111L75.8428 20.3838L71.1982 18.3457V19.7197L80.0137 24.1748L73.6631 31L62.667 24.8389V7.34961L70.2979 0.666016L79.3027 4.22168ZM16.1367 3.54883L12.0195 9.74805L8.51758 7.76074V19.1182L16.374 23.5186L10.0322 30.333L0 24.1816V6.67188L7.61914 0L16.1367 3.54883ZM37.5791 4.21289V23.6865L27.4678 30.333L18.667 23.874V5.57031L27.0928 0L37.5791 4.21289ZM27.0928 21.3926L29.1523 23.2178V10.9072L31.1191 9.3623L27.0928 7.67676V21.3926ZM53.6143 2.58105C53.924 2.32121 54.3758 2.32116 54.6855 2.58105L59.2891 6.44434C59.4777 6.60267 59.5869 6.8367 59.5869 7.08301V17.1582C59.5869 17.4044 59.4777 17.6376 59.2891 17.7959L54.6279 21.707C54.3182 21.9669 53.8664 21.9678 53.5566 21.708L50.0361 18.7529C49.6392 18.4199 49.6393 17.8096 50.0361 17.4766L52.0752 15.7656C52.1884 15.6706 52.2539 15.5296 52.2539 15.3818V9.06836C52.2538 8.92075 52.1883 8.78045 52.0752 8.68555L49.9678 6.91699C49.5712 6.58392 49.5711 5.9736 49.9678 5.64062L53.6143 2.58105ZM54.4717 2.83594C54.2858 2.68001 54.014 2.68002 53.8281 2.83594L50.1816 5.89551C49.9436 6.09535 49.9445 6.4623 50.1826 6.66211L52.2891 8.43066C52.4777 8.589 52.5869 8.82303 52.5869 9.06934V15.3828C52.5868 15.629 52.4776 15.8623 52.2891 16.0205L50.25 17.7314C50.0119 17.9313 50.0119 18.2982 50.25 18.498L53.7715 21.4521C53.9574 21.6079 54.2283 21.608 54.4141 21.4521L59.0752 17.541C59.1883 17.4461 59.2539 17.3059 59.2539 17.1582V7.08203C59.2538 6.93441 59.1883 6.79413 59.0752 6.69922L54.4717 2.83594ZM55.3369 16.667C55.7049 16.6671 56.0027 16.9651 56.0029 17.333C56.0029 17.7011 55.705 17.9999 55.3369 18C54.9687 18 54.6699 17.7012 54.6699 17.333C54.6701 16.965 54.9688 16.667 55.3369 16.667ZM71.1982 17.0654L75.0371 10.1934L71.1982 8.43945V17.0654ZM54.0029 15.333C54.3711 15.333 54.6699 15.6318 54.6699 16C54.6699 16.3682 54.3711 16.667 54.0029 16.667C53.6349 16.6668 53.3369 16.3681 53.3369 16C53.3369 15.6319 53.6349 15.3332 54.0029 15.333ZM56.6699 15.333C57.0381 15.333 57.3369 15.6318 57.3369 16C57.3369 16.3682 57.0381 16.667 56.6699 16.667C56.3018 16.667 56.0029 16.3682 56.0029 16C56.0029 15.6318 56.3018 15.333 56.6699 15.333ZM55.3369 14C55.705 14.0001 56.0029 14.2989 56.0029 14.667C56.0027 15.0349 55.7049 15.3329 55.3369 15.333C54.9688 15.333 54.6701 15.035 54.6699 14.667C54.6699 14.2988 54.9687 14 55.3369 14ZM55.6699 6.66699C55.854 6.66699 56.0029 6.8159 56.0029 7V8H57.0029C57.1869 8 57.3368 8.14902 57.3369 8.33301V9C57.3369 9.18406 57.187 9.33301 57.0029 9.33301H56.0029V10.333C56.0029 10.5171 55.854 10.667 55.6699 10.667H55.0029C54.819 10.6668 54.6699 10.517 54.6699 10.333V9.33301H53.6699C53.4859 9.33298 53.337 9.18405 53.3369 9V8.33301C53.337 8.14904 53.4859 8.00003 53.6699 8H54.6699V7C54.6699 6.81603 54.819 6.66719 55.0029 6.66699H55.6699Z"
                  fill="white"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-bold mb-2">Welcome to COPE</h1>
            <p className="text-white/60">Follow wallets, catch plays early</p>
          </div>

          <div className="space-y-4">
            {/* Show user profile card if authenticated */}
            {!loading && userProfile && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
              >
                <Card className="bg-white/5 border-white/20">
                  <div className="flex items-center gap-3">
                    {userProfile.avatar && (
                      <img
                        src={userProfile.avatar}
                        alt={
                          userProfile.xHandle ||
                          userProfile.displayName ||
                          "User"
                        }
                        className="w-12 h-12 rounded-full border-2 border-[#12d585]"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-white truncate">
                        {userProfile.displayName ||
                          userProfile.xHandle ||
                          "User"}
                      </p>
                      {userProfile.xHandle && (
                        <p className="text-sm text-white/60 truncate">
                          {userProfile.xHandle}
                        </p>
                      )}
                    </div>
                  </div>
                </Card>
              </motion.div>
            )}

            {/* Show "Why Connect X?" card only if not authenticated */}
            {!loading && !userProfile && (
              <Card>
                <h3 className="font-semibold mb-3">Why Connect X?</h3>
                <ul className="space-y-2 text-sm text-white/70">
                  <li className="flex gap-2">
                    <span className="text-[#12d585]">•</span>
                    <span>Your X identity becomes your COPE profile</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-[#12d585]">•</span>
                    <span>Follow traders you trust</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="text-[#12d585]">•</span>
                    <span>Share your wins (optional)</span>
                  </li>
                </ul>
              </Card>
            )}

            {/* Show Login button if authenticated, Connect button if not */}
            {!loading && userProfile ? (
              <Button onClick={handleLogin} className="w-full h-14">
                <LogIn className="w-5 h-5" />
                Login
              </Button>
            ) : (
              <Button
                onClick={handleTwitterSignIn}
                className="w-full h-14"
                isLoading={isLoading}
                disabled={isLoading}
              >
                <Twitter className="w-5 h-5" />
                Connect with X
              </Button>
            )}

            <p className="text-xs text-white/40 text-center px-4">
              We only access your public X profile. No tweets or DMs.
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
