import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HDNodeWallet } from "ethers";
import { decryptWalletCredentials } from "../decrypt";
import { ensureFirebase, getAdminAuth, getAdminDb } from "../../../lib/firebase-admin";

const ETH_DERIVATION_PATH = "m/44'/60'/0'/0/0";

export async function evmAddressHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    ensureFirebase();
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const decoded = await getAdminAuth().verifyIdToken(authHeader.slice(7));
    const userId = decoded.uid;

    const encryptionSecret = process.env.ENCRYPTION_SECRET;
    if (!encryptionSecret) {
      return res.status(503).json({ error: "ENCRYPTION_SECRET not configured" });
    }

    const db = getAdminDb();
    const userSnap = await db.collection("users").doc(userId).get();
    const userData = userSnap.data();
    const encryptedSecretKey = userData?.encryptedSecretKey;
    const encryptedMnemonic = userData?.encryptedMnemonic;

    if (!encryptedSecretKey) {
      return res.status(400).json({ error: "Wallet credentials not found" });
    }

    const { mnemonic } = await decryptWalletCredentials(
      userId,
      encryptedMnemonic,
      encryptedSecretKey,
      encryptionSecret
    );

    if (!mnemonic || !mnemonic.trim()) {
      return res.status(200).json({ evmAddress: null });
    }

    const wallet = HDNodeWallet.fromPhrase(mnemonic.trim(), undefined, ETH_DERIVATION_PATH);
    return res.status(200).json({ evmAddress: wallet.address });
  } catch (e: unknown) {
    console.error("evm-address error:", e);
    const message = e instanceof Error ? e.message : "Internal server error";
    return res.status(500).json({ error: message });
  }
}
