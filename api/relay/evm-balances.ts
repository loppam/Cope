import type { VercelRequest, VercelResponse } from "@vercel/node";
import { HDNodeWallet } from "ethers";
import { JsonRpcProvider, Contract } from "ethers";
import { decryptWalletCredentials } from "./decrypt";
import { BASE_USDC, BNB_USDC } from "./constants";
import { ensureFirebase, getAdminAuth, getAdminDb } from "../../lib/firebase-admin";

const ETH_DERIVATION_PATH = "m/44'/60'/0'/0/0";

const ERC20_ABI = ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"];

async function getBalances(address: string): Promise<{
  base: { usdc: number; native: number };
  bnb: { usdc: number; native: number };
}> {
  const baseRpc = process.env.BASE_RPC_URL || "https://mainnet.base.org";
  const bnbRpc = process.env.BNB_RPC_URL || "https://bsc-dataseed.binance.org";

  const result = {
    base: { usdc: 0, native: 0 },
    bnb: { usdc: 0, native: 0 },
  };

  try {
    const baseProvider = new JsonRpcProvider(baseRpc);
    const [baseNative, baseUsdcRaw] = await Promise.all([
      baseProvider.getBalance(address),
      new Contract(BASE_USDC, ERC20_ABI, baseProvider).balanceOf(address),
    ]);
    result.base.native = Number(baseNative) / 1e18;
    result.base.usdc = Number(baseUsdcRaw) / 1e6;
  } catch (e) {
    console.warn("Base balance fetch failed:", e);
  }

  try {
    const bnbProvider = new JsonRpcProvider(bnbRpc);
    const [bnbNative, bnbUsdcRaw] = await Promise.all([
      bnbProvider.getBalance(address),
      new Contract(BNB_USDC, ERC20_ABI, bnbProvider).balanceOf(address),
    ]);
    result.bnb.native = Number(bnbNative) / 1e18;
    result.bnb.usdc = Number(bnbUsdcRaw) / 1e6;
  } catch (e) {
    console.warn("BNB balance fetch failed:", e);
  }

  return result;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
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
      return res.status(200).json({ evmAddress: null, base: { usdc: 0, native: 0 }, bnb: { usdc: 0, native: 0 } });
    }

    const { mnemonic } = await decryptWalletCredentials(
      userId,
      encryptedMnemonic,
      encryptedSecretKey,
      encryptionSecret
    );

    if (!mnemonic || !mnemonic.trim()) {
      return res.status(200).json({ evmAddress: null, base: { usdc: 0, native: 0 }, bnb: { usdc: 0, native: 0 } });
    }

    const wallet = HDNodeWallet.fromPhrase(mnemonic.trim(), undefined, ETH_DERIVATION_PATH);
    const balances = await getBalances(wallet.address);

    return res.status(200).json({
      evmAddress: wallet.address,
      base: balances.base,
      bnb: balances.bnb,
    });
  } catch (e: unknown) {
    console.error("evm-balances error:", e);
    const message = e instanceof Error ? e.message : "Internal server error";
    return res.status(500).json({ error: message });
  }
}
