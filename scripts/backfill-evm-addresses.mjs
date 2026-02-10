#!/usr/bin/env node
/**
 * One-time backfill: set evmAddress for users who have wallet credentials
 * (encryptedMnemonic + encryptedSecretKey) but no evmAddress.
 *
 * Uses the same derivation as api/relay (BIP44 m/44'/60'/0'/0/0). After running,
 * execute sync-evm-deposit-webhook-addresses.mjs to add addresses to Alchemy webhooks.
 *
 * Prerequisites: .env with FIREBASE_SERVICE_ACCOUNT (or FIREBASE_ADMIN_*),
 * ENCRYPTION_SECRET
 *
 * Usage:
 *   node --env-file=.env scripts/backfill-evm-addresses.mjs
 *   node scripts/backfill-evm-addresses.mjs
 *
 * Options:
 *   --dry-run   Log users that would be updated, no Firestore writes
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

let getFirestore;
let FieldValue;

async function initFirebase() {
  const { initializeApp, cert, getApps } = await import("firebase-admin/app");
  const firestoreMod = await import("firebase-admin/firestore");
  getFirestore = firestoreMod.getFirestore;
  FieldValue = firestoreMod.FieldValue;
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
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) console.log("[DRY RUN] No Firestore writes.\n");

  const encryptionSecret = process.env.ENCRYPTION_SECRET;
  if (!encryptionSecret) {
    console.error("Missing ENCRYPTION_SECRET in .env");
    process.exit(1);
  }

  const db = await initFirebase();

  const usersSnap = await db.collection("users").get();
  const toBackfill = [];
  for (const doc of usersSnap.docs) {
    const d = doc.data();
    const uid = doc.id;
    const evm = d.evmAddress;
    const encMnemonic = d.encryptedMnemonic;
    const encSecret = d.encryptedSecretKey;
    const hasEvm = evm && typeof evm === "string" && evm.length >= 40;
    const hasCreds =
      encSecret &&
      typeof encSecret === "string" &&
      encMnemonic &&
      typeof encMnemonic === "string";
    if (hasCreds && !hasEvm) toBackfill.push({ uid, encMnemonic, encSecret });
  }

  console.log(
    "Users with wallet credentials but no evmAddress:",
    toBackfill.length
  );
  if (toBackfill.length === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  let ok = 0;
  let err = 0;
  for (const { uid, encMnemonic, encSecret } of toBackfill) {
    try {
      const mnemonic = await getMnemonic(
        uid,
        encMnemonic,
        encSecret,
        encryptionSecret
      );
      if (!mnemonic) {
        console.warn(uid, "no mnemonic (imported wallet?)");
        err++;
        continue;
      }
      const wallet = HDNodeWallet.fromPhrase(
        mnemonic,
        undefined,
        ETH_DERIVATION_PATH
      );
      const addr = wallet.address.toLowerCase();
      if (dryRun) {
        console.log(uid, "->", addr);
        ok++;
        continue;
      }
      await db.collection("users").doc(uid).update({
        evmAddress: addr,
        updatedAt: FieldValue.serverTimestamp(),
      });
      console.log(uid, "->", addr);
      ok++;
    } catch (e) {
      console.error(uid, e.message || e);
      err++;
    }
  }

  console.log("\nBackfill done. Updated:", ok, "Errors:", err);
  if (ok > 0 && !dryRun) {
    console.log(
      "\nRun the following to add these addresses to Alchemy deposit webhooks:"
    );
    console.log("  node scripts/sync-evm-deposit-webhook-addresses.mjs");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
