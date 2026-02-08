import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { ArrowLeft, Sparkles, Loader2 } from "lucide-react";
import { generateWallet } from "@/lib/wallet";
import { useAuth } from "@/contexts/AuthContext";
import { encrypt, generateEncryptionKey } from "@/lib/encryption";
import { toast } from "sonner";

export function WalletSetup() {
  const navigate = useNavigate();
  const { user, updateWallet } = useAuth();
  const [isGenerating, setIsGenerating] = useState(false);

  return (
    <div
      className="min-h-screen bg-gradient-to-b from-[#000000] to-[#0B3D2E] flex flex-col"
      style={{
        paddingTop: "var(--safe-area-inset-top)",
        paddingBottom: "var(--safe-area-inset-bottom)",
      }}
    >
      <div className="p-4">
        <Button variant="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
      </div>

      <div className="flex-1 flex flex-col p-6 max-w-md mx-auto w-full">
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2">Setup Wallet</h1>
          <p className="text-white/60">Choose how you want to get started</p>
        </div>

        <div className="space-y-4">
          <Card
            className="cursor-pointer hover:border-[#12d585]/50 transition-colors"
            onClick={async () => {
              if (!user) {
                toast.error("Please sign in first");
                return;
              }

              setIsGenerating(true);
              try {
                // Generate new wallet
                const wallet = generateWallet();

                // Validate wallet has required fields
                if (
                  !wallet.publicKey ||
                  typeof wallet.publicKey !== "string" ||
                  wallet.publicKey.trim() === ""
                ) {
                  throw new Error(
                    "Failed to generate wallet: invalid public key",
                  );
                }

                if (
                  !wallet.secretKey ||
                  !Array.isArray(wallet.secretKey) ||
                  wallet.secretKey.length === 0
                ) {
                  throw new Error(
                    "Failed to generate wallet: invalid secret key",
                  );
                }

                if (!wallet.mnemonic || typeof wallet.mnemonic !== "string") {
                  throw new Error(
                    "Failed to generate wallet: invalid mnemonic",
                  );
                }

                // Generate encryption key for this user
                const encryptionKey = generateEncryptionKey(user.uid);

                // Encrypt mnemonic and secret key
                const encryptedMnemonic = await encrypt(
                  wallet.mnemonic,
                  encryptionKey,
                );
                const encryptedSecretKey = await encrypt(
                  JSON.stringify(Array.from(wallet.secretKey)),
                  encryptionKey,
                );

                // Save to Firebase with encrypted credentials
                // This will set: walletAddress, walletConnected: true, isNew: false, and encrypted credentials
                await updateWallet(
                  wallet.publicKey,
                  0,
                  encryptedMnemonic,
                  encryptedSecretKey,
                );

                // Verify the update succeeded
                const { getUserProfile } = await import("@/lib/auth");
                const updatedProfile = await getUserProfile(user.uid);

                if (
                  !updatedProfile?.walletAddress ||
                  updatedProfile.walletAddress !== wallet.publicKey
                ) {
                  throw new Error(
                    "Wallet generation verification failed: wallet address not set correctly",
                  );
                }

                if (updatedProfile.walletConnected !== true) {
                  throw new Error(
                    "Wallet generation verification failed: walletConnected not set to true",
                  );
                }

                if (updatedProfile.isNew !== false) {
                  throw new Error(
                    "Wallet generation verification failed: isNew not set to false",
                  );
                }

                toast.success("Wallet generated successfully!", {
                  duration: 5000,
                });

                navigate("/wallet/fund", {
                  state: {
                    publicKey: wallet.publicKey,
                    isNewWallet: true,
                  },
                });
              } catch (error: any) {
                console.error("Error generating wallet:", error);
                toast.error(error.message || "Failed to generate wallet");
              } finally {
                setIsGenerating(false);
              }
            }}
          >
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-[16px] bg-gradient-to-br from-[#12d585]/20 to-[#08b16b]/20 flex items-center justify-center flex-shrink-0">
                <Sparkles className="w-6 h-6 text-[#12d585]" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold mb-1">Generate New Wallet</h3>
                <p className="text-sm text-white/60 mb-3">
                  Easy setup. We'll create a secure wallet for you.
                </p>
                {isGenerating ? (
                  <div className="flex items-center gap-2 text-[#12d585] text-xs">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Generating...</span>
                  </div>
                ) : (
                  <span className="inline-block px-3 py-1 rounded-full bg-[#12d585]/10 text-[#12d585] text-xs font-medium">
                    Recommended
                  </span>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
