#!/usr/bin/env node
/**
 * One-time script: For all users with EVM wallets, bridge their Base/BNB USDC
 * to Solana USDC (recipient = user's Solana walletAddress).
 *
 * Prerequisites:
 *   - .env with: FIREBASE_SERVICE_ACCOUNT (or FIREBASE_ADMIN_*), ENCRYPTION_SECRET,
 *     WEBHOOK_EVM_DEPOSIT_SECRET or RELAY_INTERNAL_SECRET, RELAY_API_KEY (if required),
 *     API_BASE_URL (your app URL, e.g. https://yourapp.vercel.app)
 *   - Optional: ALCHEMY_API_KEY (used for Base + BNB Alchemy RPCs), or BASE_RPC_URL / BNB_RPC_URL
 *
 * Usage:
 *   npm run bridge-evm-usdc-to-sol
 *   npm run bridge-evm-usdc-to-sol -- --dry-run
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env");
if (existsSync(envPath)) {
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      const key = m[1].trim();
      const val = m[2].replace(/^["']|["']$/g, "").trim();
      if (!(key in process.env)) process.env[key] = val;
    }
  }
}

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { HDNodeWallet, JsonRpcProvider, Contract } from "ethers";

const ETH_DERIVATION_PATH = "m/44'/60'/0'/0/0";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BNB_USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

function initFirebase() {
  if (getApps().length > 0) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  let projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  let clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
  if (raw) {
    const sa = JSON.parse(raw);
    projectId = sa.project_id;
    clientEmail = sa.client_email;
    privateKey = sa.private_key?.replace(/\\n/g, "\n");
  }
  if (typeof privateKey === "string") privateKey = privateKey?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    console.error("Missing Firebase credentials.");
    process.exit(1);
  }
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

async function deriveKey(password, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
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
    ["decrypt"],
  );
}

async function decrypt(encryptedData, password) {
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

async function getMnemonic(
  userId,
  encryptedMnemonic,
  encryptedSecretKey,
  encryptionSecret,
) {
  const key = `${userId}:${encryptionSecret}`;
  await decrypt(encryptedSecretKey, key);
  if (!encryptedMnemonic) return null;
  return decrypt(encryptedMnemonic, key);
}

const STATIC_NETWORK_OPT = { staticNetwork: true };

function getBaseRpcUrl() {
  if (process.env.BASE_RPC_URL) return process.env.BASE_RPC_URL;
  const key = process.env.ALCHEMY_API_KEY?.trim();
  if (key) return `https://base-mainnet.g.alchemy.com/v2/${key}`;
  return "https://mainnet.base.org";
}

function getBnbRpcUrl() {
  if (process.env.BNB_RPC_URL) return process.env.BNB_RPC_URL;
  const key = process.env.ALCHEMY_API_KEY?.trim();
  if (key) return `https://bnb-mainnet.g.alchemy.com/v2/${key}`;
  return "https://bsc-dataseed1.binance.org";
}

function createBaseProvider() {
  return new JsonRpcProvider(getBaseRpcUrl(), 8453, STATIC_NETWORK_OPT);
}

function createBnbProvider() {
  return new JsonRpcProvider(getBnbRpcUrl(), 56, STATIC_NETWORK_OPT);
}

async function getEvmBalances(address, baseProvider, bnbProvider) {
  const result = {
    base: { usdc: 0, native: 0 },
    bnb: { usdc: 0, native: 0 },
  };
  if (baseProvider) {
    try {
      const [baseNative, baseUsdcRaw] = await Promise.all([
        baseProvider.getBalance(address),
        new Contract(BASE_USDC, ERC20_ABI, baseProvider).balanceOf(address),
      ]);
      result.base.native = Number(baseNative) / 1e18;
      result.base.usdc = Number(baseUsdcRaw) / 1e6;
    } catch (e) {
      console.warn("Base balance fetch failed:", e.message);
    }
  }
  if (bnbProvider) {
    try {
      const [bnbNative, bnbUsdcRaw] = await Promise.all([
        bnbProvider.getBalance(address),
        new Contract(BNB_USDC, ERC20_ABI, bnbProvider).balanceOf(address),
      ]);
      result.bnb.native = Number(bnbNative) / 1e18;
      result.bnb.usdc = Number(bnbUsdcRaw) / 1e6;
    } catch (e) {
      console.warn("BNB balance fetch failed:", e.message);
    }
  }
  return result;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const apiBase = process.env.API_BASE_URL || "http://localhost:3000";
  const secret =
    process.env.WEBHOOK_EVM_DEPOSIT_SECRET ||
    process.env.RELAY_INTERNAL_SECRET;
  const encryptionSecret = process.env.ENCRYPTION_SECRET;

  if (!secret || !encryptionSecret) {
    console.error(
      "Set ENCRYPTION_SECRET and (WEBHOOK_EVM_DEPOSIT_SECRET or RELAY_INTERNAL_SECRET).",
    );
    process.exit(1);
  }

  initFirebase();
  const db = getFirestore();
  const usersSnap = await db.collection("users").get();
  const header = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${secret}`,
  };

  let baseProvider = null;
  let bnbProvider = null;
  try {
    baseProvider = createBaseProvider();
  } catch (e) {
    console.warn("Base provider init failed:", e.message);
  }
  try {
    bnbProvider = createBnbProvider();
  } catch (e) {
    console.warn("BNB provider init failed:", e.message);
  }

  for (const doc of usersSnap.docs) {
    const userId = doc.id;
    const data = doc.data();
    const encryptedSecretKey = data?.encryptedSecretKey;
    const encryptedMnemonic = data?.encryptedMnemonic;
    const walletAddress = data?.walletAddress;

    if (!encryptedSecretKey || !walletAddress) continue;
    let mnemonic;
    try {
      mnemonic = await getMnemonic(
        userId,
        encryptedMnemonic,
        encryptedSecretKey,
        encryptionSecret,
      );
    } catch (e) {
      console.warn(`User ${userId}: decrypt failed`, e.message);
      continue;
    }
    if (!mnemonic?.trim()) continue;

    const evmWallet = HDNodeWallet.fromPhrase(
      mnemonic.trim(),
      undefined,
      ETH_DERIVATION_PATH,
    );
    const evmAddress = evmWallet.address;
    const balances = await getEvmBalances(evmAddress, baseProvider, bnbProvider);

    for (const network of ["base", "bnb"]) {
      const usdc =
        network === "base" ? balances.base.usdc : balances.bnb.usdc;
      if (usdc < 0.01) continue;

      const amountRaw = Math.floor(usdc * 1e6).toString();
      if (dryRun) {
        console.log(
          `[DRY-RUN] Would bridge ${usdc.toFixed(2)} USDC on ${network} for user ${userId} -> ${walletAddress}`,
        );
        continue;
      }

      let quote;
      try {
        const quoteRes = await fetch(
          `${apiBase}/api/relay/bridge-from-evm-quote`,
          {
            method: "POST",
            headers: header,
            body: JSON.stringify({
              evmAddress,
              network,
              amountRaw,
              recipientSolAddress: walletAddress,
            }),
          },
        );
        if (!quoteRes.ok) {
          console.error(
            `User ${userId} ${network}: quote failed`,
            await quoteRes.text(),
          );
          continue;
        }
        quote = await quoteRes.json();
      } catch (e) {
        console.error(
          `User ${userId} ${network}: quote request failed`,
          e.message,
        );
        continue;
      }

      try {
        const execRes = await fetch(
          `${apiBase}/api/relay/execute-bridge-custodial`,
          {
            method: "POST",
            headers: header,
            body: JSON.stringify({ userId, quoteResponse: quote }),
          },
        );
        if (!execRes.ok) {
          console.error(
            `User ${userId} ${network}: execute failed`,
            await execRes.text(),
          );
          continue;
        }
        console.log(
          `Bridged ${usdc.toFixed(2)} USDC (${network}) for user ${userId}`,
        );
      } catch (e) {
        console.error(
          `User ${userId} ${network}: execute request failed`,
          e.message,
        );
      }
    }
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
