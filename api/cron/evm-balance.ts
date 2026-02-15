/**
 * Cron-only endpoint: return EVM balance for a user (Base + BNB).
 * Auth: Bearer CRON_SECRET. Query: uid.
 * Used by log-balance cron to compute full wallet total.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { HDNodeWallet } from "ethers";
import { getEvmBalances, getEvmTokenPositions } from "../lib/evm-balance";

// Inlined to avoid Vercel ERR_MODULE_NOT_FOUND for api/lib/decrypt
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: new Uint8Array(salt), iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
async function decryptAes(encryptedData: string, password: string): Promise<string> {
  const combined = new Uint8Array(Buffer.from(encryptedData, "base64"));
  const salt = combined.slice(0, 16);
  const iv = combined.slice(16, 28);
  const encrypted = combined.slice(28);
  const key = await deriveKey(password, salt);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);
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
    return res.status(401).json({ error: "Unauthorized" });
  }
  const uid = typeof req.query.uid === "string" ? req.query.uid.trim() : "";
  if (!uid) {
    return res.status(400).json({ error: "Missing uid" });
  }

  ensureFirebase();
  const db = getFirestore();
  const encryptionSecret = process.env.ENCRYPTION_SECRET;
  if (!encryptionSecret) {
    return res.status(503).json({ error: "ENCRYPTION_SECRET not configured" });
  }

  try {
    const userSnap = await db.collection("users").doc(uid).get();
    const userData = userSnap.data();
    const encryptedSecretKey = userData?.encryptedSecretKey;
    const encryptedMnemonic = userData?.encryptedMnemonic;
    if (!encryptedSecretKey) {
      return res.status(200).json({
        evmAddress: null,
        base: { usdc: 0, native: 0 },
        bnb: { usdc: 0, native: 0 },
        tokens: [],
      });
    }
    const { mnemonic } = await decryptWalletCredentials(
      uid,
      encryptedMnemonic,
      encryptedSecretKey,
      encryptionSecret,
    );
    if (!mnemonic?.trim()) {
      return res.status(200).json({
        evmAddress: null,
        base: { usdc: 0, native: 0 },
        bnb: { usdc: 0, native: 0 },
        tokens: [],
      });
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
    return res.status(200).json({
      evmAddress: wallet.address,
      base: balances.base,
      bnb: balances.bnb,
      tokens: tokenPositions,
    });
  } catch (e) {
    console.error("[cron/evm-balance]", e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : "EVM balance failed",
    });
  }
}
