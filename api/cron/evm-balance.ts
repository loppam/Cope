/**
 * Cron-only endpoint: return EVM balance for a user (Base + BNB).
 * Auth: Bearer CRON_SECRET. Query: uid.
 * Used by log-balance cron to compute full wallet total.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { Contract, HDNodeWallet, JsonRpcProvider } from "ethers";

// Inlined to avoid Vercel ERR_MODULE_NOT_FOUND for api/lib/evm-balance
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BNB_USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
] as const;
const NATIVE_ETH_PLACEHOLDER = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

async function getEvmBalances(address: string): Promise<{
  base: { usdc: number; native: number };
  bnb: { usdc: number; native: number };
}> {
  const result = { base: { usdc: 0, native: 0 }, bnb: { usdc: 0, native: 0 } };
  try {
    const baseProvider = new JsonRpcProvider(
      process.env.BASE_RPC_URL || "https://mainnet.base.org",
    );
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
    const bnbProvider = new JsonRpcProvider(
      process.env.BNB_RPC_URL || "https://bsc-dataseed.binance.org",
    );
    const [bnbNative, bnbUsdcRaw] = await Promise.all([
      bnbProvider.getBalance(address),
      new Contract(BNB_USDC, ERC20_ABI, bnbProvider).balanceOf(address),
    ]);
    result.bnb.native = Number(bnbNative) / 1e18;
    // BNB USDC (Binance-Peg) has 18 decimals on-chain, unlike Base USDC (6)
    result.bnb.usdc = Number(bnbUsdcRaw) / 1e18;
  } catch (e) {
    console.warn("BNB balance fetch failed:", e);
  }
  return result;
}

type EvmTokenPosition = {
  mint: string;
  symbol: string;
  name: string;
  amount: number;
  value: number;
  chain: "base" | "bnb";
  image?: string;
  decimals: number;
};

async function getEvmTokenPositions(
  address: string,
): Promise<EvmTokenPosition[]> {
  const apiKey = process.env.MORALIS_API_KEY;
  if (!apiKey) return [];

  const tokens: EvmTokenPosition[] = [];
  const chains: Array<{ chain: "base" | "bnb"; param: string }> = [
    { chain: "base", param: "base" },
    { chain: "bnb", param: "bsc" },
  ];

  await Promise.all(
    chains.map(async ({ chain, param }) => {
      try {
        const url = `https://deep-index.moralis.io/api/v2.2/wallets/${address}/tokens?chain=${param}&limit=100&exclude_spam=true`;
        const res = await fetch(url, {
          headers: { accept: "application/json", "X-API-Key": apiKey },
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          result?: Array<{
            token_address?: string;
            name?: string;
            symbol?: string;
            logo?: string;
            decimals?: number;
            balance?: string;
            balance_formatted?: string;
            usd_value?: number;
            native_token?: boolean;
          }>;
        };
        const list = Array.isArray(data?.result) ? data.result : [];
        for (const t of list) {
          // Prefer raw balance / 10^decimals (authoritative); Moralis balance_formatted can be wrong (returns raw)
          let bal = 0;
          if (
            t.balance != null &&
            t.balance !== "" &&
            typeof t.decimals === "number" &&
            t.decimals >= 0
          ) {
            try {
              bal = Number(BigInt(t.balance)) / Math.pow(10, t.decimals);
            } catch {
              bal = 0;
            }
          } else {
            const formatted = t.balance_formatted?.trim();
            if (formatted !== "" && formatted != null) {
              bal = parseFloat(formatted);
            }
          }
          const value = t.usd_value ?? 0;
          if (bal <= 0 && value <= 0) continue;

          const addr = (t.token_address ?? "").toLowerCase();
          const isNative =
            t.native_token || !addr || addr === NATIVE_ETH_PLACEHOLDER;
          // Normalize USDC mint to base-usdc / bnb-usdc for consistent matching
          const mint = isNative
            ? chain === "base"
              ? "base-eth"
              : "bnb-bnb"
            : addr === BASE_USDC.toLowerCase()
              ? "base-usdc"
              : addr === BNB_USDC.toLowerCase()
                ? "bnb-usdc"
                : addr;

          tokens.push({
            mint,
            symbol: (
              t.symbol ?? (chain === "base" ? "ETH" : "BNB")
            ).toUpperCase(),
            name: t.name ?? (chain === "base" ? "Ethereum (Base)" : "BNB"),
            amount: bal,
            value,
            chain,
            image: t.logo,
            decimals: typeof t.decimals === "number" ? t.decimals : 18,
          });
        }
      } catch (e) {
        console.warn(`Moralis token fetch failed for ${chain}:`, e);
      }
    }),
  );

  return tokens;
}

// Inlined to avoid Vercel ERR_MODULE_NOT_FOUND for api/lib/decrypt
async function deriveKey(
  password: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new Uint8Array(salt),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
async function decryptAes(
  encryptedData: string,
  password: string,
): Promise<string> {
  const combined = new Uint8Array(Buffer.from(encryptedData, "base64"));
  const salt = combined.slice(0, 16);
  const iv = combined.slice(16, 28);
  const encrypted = combined.slice(28);
  const key = await deriveKey(password, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    encrypted,
  );
  return new TextDecoder().decode(decrypted);
}
async function decryptWalletCredentials(
  userId: string,
  encryptedMnemonic: string | undefined,
  encryptedSecretKey: string,
  encryptionSecret: string,
): Promise<{ mnemonic?: string; secretKey: Uint8Array }> {
  const key = `${userId}:${encryptionSecret}`;
  const secretKeyStr = await decryptAes(encryptedSecretKey, key);
  const secretKey = new Uint8Array(JSON.parse(secretKeyStr) as number[]);
  let mnemonic: string | undefined;
  if (encryptedMnemonic) mnemonic = await decryptAes(encryptedMnemonic, key);
  return { mnemonic, secretKey };
}

const ETH_DERIVATION_PATH = "m/44'/60'/0'/0/0";

function ensureFirebase() {
  if (getApps().length > 0) return;
  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  let projectId: string | undefined;
  let clientEmail: string | undefined;
  let privateKey: string | undefined;
  if (rawServiceAccount) {
    try {
      const sa = JSON.parse(rawServiceAccount);
      projectId = sa.project_id;
      clientEmail = sa.client_email;
      privateKey = sa.private_key?.replace(/\\n/g, "\n");
    } catch {
      /* ignore */
    }
  }
  projectId = projectId || process.env.FIREBASE_ADMIN_PROJECT_ID;
  clientEmail = clientEmail || process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  if (!privateKey && process.env.FIREBASE_ADMIN_PRIVATE_KEY) {
    privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n");
  }
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase admin not configured");
  }
  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const uid = typeof req.query.uid === "string" ? req.query.uid.trim() : "";
  if (!uid) {
    res.status(400).json({ error: "Missing uid" });
    return;
  }

  ensureFirebase();
  const db = getFirestore();
  const encryptionSecret = process.env.ENCRYPTION_SECRET;
  if (!encryptionSecret) {
    res.status(503).json({ error: "ENCRYPTION_SECRET not configured" });
    return;
  }

  try {
    const userSnap = await db.collection("users").doc(uid).get();
    const userData = userSnap.data();
    const encryptedSecretKey = userData?.encryptedSecretKey;
    const encryptedMnemonic = userData?.encryptedMnemonic;
    if (!encryptedSecretKey) {
      res.status(200).json({
        evmAddress: null,
        base: { usdc: 0, native: 0 },
        bnb: { usdc: 0, native: 0 },
        tokens: [],
      });
      return;
    }
    const { mnemonic } = await decryptWalletCredentials(
      uid,
      encryptedMnemonic,
      encryptedSecretKey,
      encryptionSecret,
    );
    if (!mnemonic?.trim()) {
      res.status(200).json({
        evmAddress: null,
        base: { usdc: 0, native: 0 },
        bnb: { usdc: 0, native: 0 },
        tokens: [],
      });
      return;
    }
    const wallet = HDNodeWallet.fromPhrase(
      mnemonic.trim(),
      undefined,
      ETH_DERIVATION_PATH,
    );
    const [balances, tokenPositions] = await Promise.all([
      getEvmBalances(wallet.address),
      getEvmTokenPositions(wallet.address),
    ]);
    res.status(200).json({
      evmAddress: wallet.address,
      base: balances.base,
      bnb: balances.bnb,
      tokens: tokenPositions,
    });
  } catch (e) {
    console.error("[cron/evm-balance]", e);
    res.status(500).json({
      error: e instanceof Error ? e.message : "EVM balance failed",
    });
  }
}
