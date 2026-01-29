import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { ArrowLeft, Eye, EyeOff, Loader2 } from "lucide-react";
import {
  importWalletFromPrivateKey,
  importWalletFromMnemonic,
  detectInputType,
} from "@/lib/wallet";
import { useAuth } from "@/contexts/AuthContext";
import { encrypt, generateEncryptionKey } from "@/lib/encryption";
import { toast } from "sonner";

export function ImportWallet() {
  const navigate = useNavigate();
  const { user, updateWallet } = useAuth();
  const [showKey, setShowKey] = useState(false);
  const [privateKey, setPrivateKey] = useState("");
  const [isImporting, setIsImporting] = useState(false);

  const handleImport = async () => {
    if (!privateKey.trim()) {
      toast.error("Please enter your private key or mnemonic phrase");
      return;
    }

    if (!user) {
      toast.error("Please sign in first");
      return;
    }

    setIsImporting(true);
    try {
      const input = privateKey.trim();
      const inputType = detectInputType(input);

      let wallet;
      let mnemonic: string | undefined;

      if (inputType === "mnemonic") {
        // Import from mnemonic
        wallet = importWalletFromMnemonic(input);
        mnemonic = input;
      } else if (inputType === "privateKey") {
        // Import from private key
        wallet = importWalletFromPrivateKey(input);
        // No mnemonic for private key imports
      } else {
        throw new Error(
          "Invalid format. Please enter a valid mnemonic phrase (12/24 words) or private key.",
        );
      }

      // Validate wallet has required fields
      if (
        !wallet.publicKey ||
        typeof wallet.publicKey !== "string" ||
        wallet.publicKey.trim() === ""
      ) {
        throw new Error("Invalid wallet: public key is missing or invalid");
      }

      if (
        !wallet.secretKey ||
        !Array.isArray(wallet.secretKey) ||
        wallet.secretKey.length === 0
      ) {
        throw new Error("Invalid wallet: secret key is missing or invalid");
      }

      // Generate encryption key for this user
      const encryptionKey = generateEncryptionKey(user.uid);

      // Encrypt secret key (always available)
      const encryptedSecretKey = await encrypt(
        JSON.stringify(Array.from(wallet.secretKey)),
        encryptionKey,
      );

      // Encrypt mnemonic if available
      let encryptedMnemonic: string | undefined;
      if (mnemonic) {
        encryptedMnemonic = await encrypt(mnemonic, encryptionKey);
      }

      // Save to Firebase with encrypted credentials
      // This will set: walletAddress, walletConnected: true, isNew: false, and encrypted credentials
      await updateWallet(
        wallet.publicKey,
        0,
        encryptedMnemonic,
        encryptedSecretKey,
      );

      // Verify the update succeeded by checking the profile
      // This ensures all fields were set correctly
      const { getUserProfile } = await import("@/lib/auth");
      const updatedProfile = await getUserProfile(user.uid);

      if (
        !updatedProfile?.walletAddress ||
        updatedProfile.walletAddress !== wallet.publicKey
      ) {
        throw new Error(
          "Wallet import verification failed: wallet address not set correctly",
        );
      }

      if (updatedProfile.walletConnected !== true) {
        throw new Error(
          "Wallet import verification failed: walletConnected not set to true",
        );
      }

      if (updatedProfile.isNew !== false) {
        throw new Error(
          "Wallet import verification failed: isNew not set to false",
        );
      }

      toast.success("Wallet imported successfully!");

      // Navigate to fund page
      navigate("/wallet/fund", {
        state: {
          publicKey: wallet.publicKey,
          isNewWallet: false,
        },
      });
    } catch (error: any) {
      console.error("Error importing wallet:", error);
      toast.error(
        error.message || "Failed to import wallet. Please check your input.",
      );
    } finally {
      setIsImporting(false);
    }
  };

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
          <h1 className="text-2xl font-bold mb-2">Import Wallet</h1>
          <p className="text-white/60">Enter your private key or seed phrase</p>
        </div>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2">
              Private Key / Seed Phrase
            </label>
            <div className="relative">
              <Input
                type={showKey ? "text" : "password"}
                placeholder="Enter your private key or 12/24-word seed phrase"
                value={privateKey}
                onChange={(e) => setPrivateKey(e.target.value)}
                className="pr-12 font-mono text-sm"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-white/50 hover:text-white"
              >
                {showKey ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>

          <div className="p-4 rounded-[16px] bg-[#FF4757]/10 border border-[#FF4757]/20">
            <h4 className="font-semibold text-[#FF4757] mb-2">
              Security Warning
            </h4>
            <ul className="text-sm text-[#FF4757]/90 space-y-1">
              <li>• Never share your private key</li>
              <li>• COPE never stores your key unencrypted</li>
              <li>• Make sure you're on the correct URL</li>
            </ul>
          </div>

          <Button
            onClick={handleImport}
            className="w-full h-12"
            disabled={!privateKey.trim() || isImporting}
          >
            {isImporting ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                Importing...
              </>
            ) : (
              "Import Wallet"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
