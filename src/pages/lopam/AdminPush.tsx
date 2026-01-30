import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { auth } from "@/lib/firebase";

export function AdminPush() {
  const { userProfile } = useAuth();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [deepLink, setDeepLink] = useState("/app/alerts");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claimLoading, setClaimLoading] = useState(false);
  const [claimSuccess, setClaimSuccess] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  const handleClaimJupiterFees = async () => {
    setClaimLoading(true);
    setClaimError(null);
    setClaimSuccess(null);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        throw new Error("Authentication required");
      }
      const response = await fetch("/api/jupiter/claim-fees", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || data.error || "Failed to claim fees");
      }
      const msg =
        data.message ||
        (data.count > 0
          ? `Claimed ${data.count} fee transaction(s). Signatures: ${(data.signatures || []).join(", ")}`
          : "No claimable fees.");
      setClaimSuccess(msg);
    } catch (err) {
      setClaimError((err as Error).message);
    } finally {
      setClaimLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!title || !body) {
      setError("Title and body required");
      return;
    }
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (!idToken) {
        throw new Error("Authentication required");
      }
      const response = await fetch("/api/push/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ title, body, deepLink }),
      });
      if (!response.ok) {
        const json = await response.json().catch(() => ({}));
        throw new Error(json.error || "Failed to send push");
      }
      const result = await response.json();
      setSuccess(
        `Push sent successfully! ` +
          `Total tokens: ${result.totalTokens || 0}, ` +
          `FCM: ${result.fcmTokens || 0}, ` +
          `Web Push: ${result.webPushTokens || 0}, ` +
          `Removed invalid: ${result.removed || 0}`,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  if (userProfile?.xHandle?.toLowerCase() !== "@lopam.eth") {
    return (
      <div className="p-6">
        <Card className="text-center py-10">
          <p>Admin access only</p>
        </Card>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-gradient-to-b from-[#000000] to-[#0B3D2E] p-6"
      style={{
        paddingTop: "calc(1.5rem + var(--safe-area-inset-top))",
        paddingBottom: "calc(1.5rem + var(--safe-area-inset-bottom))",
      }}
    >
      <div className="max-w-[600px] mx-auto">
        <h1 className="text-3xl font-bold mb-4">Lopam Push Console</h1>
        <Card className="space-y-4 p-6 mb-4">
          <div className="text-sm text-white/60 space-y-1">
            <p>
              <strong>iOS Web Push Requirements:</strong>
            </p>
            <ul className="list-disc list-inside space-y-1 ml-2">
              <li>App must be installed as PWA (Add to Home Screen)</li>
              <li>iOS 16.4+ required</li>
              <li>Notification permission must be granted</li>
              <li>VAPID keys must be set in Vercel environment</li>
            </ul>
          </div>
        </Card>
        <Card className="space-y-4 p-6">
          <div>
            <label className="block text-sm text-white/70">Title</label>
            <input
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm text-white/70">Body</label>
            <textarea
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
            />
          </div>
          <div>
            <label className="block text-sm text-white/70">
              Deep link (optional)
            </label>
            <input
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-white"
              value={deepLink}
              onChange={(e) => setDeepLink(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-[#FF4757]">{error}</p>}
          {success && <p className="text-sm text-[#12d585]">{success}</p>}
          <Button onClick={handleSubmit} disabled={loading} className="w-full">
            {loading ? "Sending..." : "Send Push"}
          </Button>
        </Card>

        <Card className="space-y-4 p-6 mt-4">
          <h2 className="text-lg font-semibold">Jupiter referral fees</h2>
          <p className="text-sm text-white/60">
            Claim accumulated referral fees from your Jupiter referral token
            accounts. Requires JUPITER_REFERRAL_ACCOUNT, SOLANA_RPC_URL, and
            KEYPAIR_JSON set in the API environment.
          </p>
          {claimError && <p className="text-sm text-[#FF4757]">{claimError}</p>}
          {claimSuccess && (
            <p className="text-sm text-[#12d585] whitespace-pre-wrap">
              {claimSuccess}
            </p>
          )}
          <Button
            onClick={handleClaimJupiterFees}
            disabled={claimLoading}
            className="w-full"
          >
            {claimLoading ? "Claiming..." : "Claim Jupiter fees"}
          </Button>
        </Card>
      </div>
    </div>
  );
}
