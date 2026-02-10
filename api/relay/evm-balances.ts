import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { HDNodeWallet } from "ethers";
import { JsonRpcProvider, Contract } from "ethers";
import { decryptWalletCredentials } from "./decrypt";

function initFirebase() {
  if (getApps().length > 0) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  let projectId: string | undefined;
  let clientEmail: string | undefined;
  let privateKey: string | undefined;
  if (raw) {
    const sa = JSON.parse(raw);
    projectId = sa.project_id;
    clientEmail = sa.client_email;
    privateKey = sa.private_key?.replace(/\\n/g, "\n");
  }
  projectId = projectId || process.env.FIREBASE_ADMIN_PROJECT_ID;
  clientEmail = clientEmail || process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  privateKey = privateKey || process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase admin credentials not configured");
  }
  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
}

const ETH_DERIVATION_PATH = "m/44'/60'/0'/0/0";

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BNB_USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
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
    initFirebase();
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const decoded = await getAuth().verifyIdToken(authHeader.slice(7));
    const userId = decoded.uid;

    const encryptionSecret = process.env.ENCRYPTION_SECRET;
    if (!encryptionSecret) {
      return res.status(503).json({ error: "ENCRYPTION_SECRET not configured" });
    }

    const db = getFirestore();
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
