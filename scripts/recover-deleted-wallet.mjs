#!/usr/bin/env node
/**
 * Recover mnemonic and wallet address from deletedWallets collection.
 * For support: when a user removed their wallet, we archived it here.
 * RUN LOCALLY ONLY - never commit keys or run in CI.
 *
 * Prerequisites: .env with FIREBASE_ADMIN_*, ENCRYPTION_SECRET
 *
 * Usage:
 *   node --env-file=.env scripts/recover-deleted-wallet.mjs <userId>
 *   node --env-file=.env scripts/recover-deleted-wallet.mjs J4hVwZkguBOv4hGrQvE0W1EzPk92
 *
 * Optionally specify a doc ID (from deletedWallets) if user has multiple deletions:
 *   node --env-file=.env scripts/recover-deleted-wallet.mjs <userId> <docId>
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { webcrypto } from "node:crypto";
import { Keypair } from "@solana/web3.js";

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

async function deriveKey(password, salt) {
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
      "Missing Firebase credentials. Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_ADMIN_* in .env",
    );
    process.exit(1);
  }
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
  return getFirestore();
}

async function main() {
  const userId = process.argv[2];
  const docId = process.argv[3];
  if (!userId) {
    console.error(
      "Usage: node --env-file=.env scripts/recover-deleted-wallet.mjs <userId> [docId]",
    );
    process.exit(1);
  }

  const encryptionSecret = process.env.ENCRYPTION_SECRET;
  if (!encryptionSecret) {
    console.error("Missing ENCRYPTION_SECRET in .env");
    process.exit(1);
  }

  const db = await initFirebase();
  const deletedRef = db.collection("deletedWallets");

  let snapshot;
  if (docId) {
    const doc = await deletedRef.doc(docId).get();
    if (!doc.exists || doc.data()?.uid !== userId) {
      console.error("Deleted wallet doc not found or uid mismatch:", docId);
      process.exit(1);
    }
    snapshot = { docs: [doc] };
  } else {
    const q = await deletedRef.where("uid", "==", userId).limit(10).get();
    const docs = q.docs.sort((a, b) => {
      const at = a.data().deletedAt?.toMillis?.() ?? 0;
      const bt = b.data().deletedAt?.toMillis?.() ?? 0;
      return bt - at;
    });
    snapshot = { empty: docs.length === 0, docs };
  }

  if (snapshot.empty) {
    console.error("No deleted wallet found for user:", userId);
    process.exit(1);
  }

  const key = `${userId}:${encryptionSecret}`;

  for (let i = 0; i < snapshot.docs.length; i++) {
    const doc = snapshot.docs[i];
    const d = doc.data();
    const encSecret = d.encryptedSecretKey;
    const encMnemonic = d.encryptedMnemonic;
    const storedAddress = d.walletAddress;

    console.log("\n--- Deleted wallet", i + 1, "---");
    console.log("Doc ID:", doc.id);
    console.log("Stored walletAddress:", storedAddress || "(null)");
    console.log("Deleted at:", d.deletedAt?.toDate?.() ?? d.deletedAt);

    if (!encSecret || !encSecret.trim()) {
      console.log("(No encryptedSecretKey - cannot recover)");
      continue;
    }

    try {
      const decrypted = await decrypt(encSecret, key);
      const secretKey = new Uint8Array(JSON.parse(decrypted));
      const keypair = Keypair.fromSecretKey(secretKey);
      const derivedAddress = keypair.publicKey.toBase58();

      console.log("Derived Solana address:", derivedAddress);

      if (encMnemonic && encMnemonic.trim()) {
        const mnemonic = (await decrypt(encMnemonic, key))?.trim();
        if (mnemonic) {
          console.log("Mnemonic:", mnemonic);
        } else {
          console.log("Mnemonic: (decrypt failed or empty)");
        }
      } else {
        console.log("Mnemonic: (not stored - imported wallet)");
      }
    } catch (e) {
      console.error("Decryption error:", e.message);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
