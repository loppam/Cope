#!/usr/bin/env node
/**
 * Decrypt and output the EVM private key for a given user.
 * RUN LOCALLY ONLY - never commit keys or run in CI.
 *
 * Prerequisites: .env with FIREBASE_SERVICE_ACCOUNT (or FIREBASE_ADMIN_*),
 * ENCRYPTION_SECRET
 *
 * Usage:
 *   node --env-file=.env scripts/get-user-evm-key.mjs <userId>
 *   node --env-file=.env scripts/get-user-evm-key.mjs 30xLsaNK8vXEcvSXnscve2X6lRD2
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { webcrypto } from "node:crypto";
import { HDNodeWallet } from "ethers";

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

const crypto = webcrypto;
const ETH_DERIVATION_PATH = "m/44'/60'/0'/0/0";

async function deriveKey(password, salt) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
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
    ["encrypt", "decrypt"]
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
    encrypted
  );
  return new TextDecoder().decode(decrypted);
}

async function getMnemonic(userId, encryptedMnemonic, encryptedSecretKey, encryptionSecret) {
  const key = `${userId}:${encryptionSecret}`;
  if (!encryptedMnemonic || !encryptedMnemonic.trim()) return null;
  const mnemonic = await decrypt(encryptedMnemonic, key);
  return mnemonic?.trim() || null;
}

async function initFirebase() {
  const { initializeApp, cert, getApps } = await import("firebase-admin/app");
  const firestoreMod = await import("firebase-admin/firestore");
  const getFirestore = firestoreMod.getFirestore;
  if (getApps().length > 0) return getFirestore();
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  let projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  let clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
  if (raw) {
    try {
      const sa = JSON.parse(raw);
      projectId = sa.project_id;
      clientEmail = sa.client_email;
      privateKey = sa.private_key?.replace(/\\n/g, "\n");
    } catch (e) {
      console.error("Invalid FIREBASE_SERVICE_ACCOUNT JSON:", e.message);
      process.exit(1);
    }
  }
  if (privateKey && typeof privateKey === "string")
    privateKey = privateKey.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    console.error(
      "Missing Firebase credentials. Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_ADMIN_* in .env"
    );
    process.exit(1);
  }
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  return getFirestore();
}

async function main() {
  const userId = process.argv[2];
  if (!userId) {
    console.error("Usage: node --env-file=.env scripts/get-user-evm-key.mjs <userId>");
    process.exit(1);
  }

  const encryptionSecret = process.env.ENCRYPTION_SECRET;
  if (!encryptionSecret) {
    console.error("Missing ENCRYPTION_SECRET in .env");
    process.exit(1);
  }

  const db = await initFirebase();
  const doc = await db.collection("users").doc(userId).get();

  if (!doc.exists) {
    console.error("User not found:", userId);
    process.exit(1);
  }

  const d = doc.data();
  const encMnemonic = d.encryptedMnemonic;
  const encSecret = d.encryptedSecretKey;

  if (!encSecret || !encMnemonic) {
    console.error("User has no wallet credentials (encryptedMnemonic/encryptedSecretKey)");
    process.exit(1);
  }

  const mnemonic = await getMnemonic(userId, encMnemonic, encSecret, encryptionSecret);
  if (!mnemonic) {
    console.error("Could not decrypt mnemonic (user may have imported wallet without mnemonic)");
    process.exit(1);
  }

  const wallet = HDNodeWallet.fromPhrase(mnemonic, undefined, ETH_DERIVATION_PATH);

  console.log("EVM address:", wallet.address);
  console.log("EVM private key (hex):", wallet.privateKey);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
