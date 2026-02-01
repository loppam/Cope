#!/usr/bin/env node
/**
 * Full reset: clear Firestore (all collections + subcollections), Auth (all users),
 * and delete the Helius webhook (Helius does not allow empty accountAddresses).
 * Uses .env for Firebase Admin and Helius config.
 *
 * Prerequisites in .env:
 *   Firebase: FIREBASE_SERVICE_ACCOUNT (JSON) or FIREBASE_ADMIN_PROJECT_ID + CLIENT_EMAIL + PRIVATE_KEY
 *   Helius:   HELIUS_API_KEY, HELIUS_WEBHOOK_ID, WEBHOOK_URL, HELIUS_WEBHOOK_SECRET (optional)
 *
 * Usage:
 *   npm run reset-all -- --confirm
 *   # or: node scripts/reset-all.mjs --confirm
 *
 * Options:
 *   --confirm   Required to actually run (safety)
 *   --dry-run   Log what would be done, no writes (no --confirm needed)
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
import { getAuth } from "firebase-admin/auth";

function initFirebase() {
  if (getApps().length > 0) return;

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

  if (privateKey && typeof privateKey === "string") {
    privateKey = privateKey.replace(/\\n/g, "\n");
  }

  if (!projectId || !clientEmail || !privateKey) {
    console.error(
      "Missing Firebase credentials. Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_ADMIN_* in .env",
    );
    process.exit(1);
  }

  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
}

const FIRESTORE_COLLECTIONS = [
  "users",
  "notifications",
  "watchedWallets",
  "followers",
  "config",
  "prices",
];

const HELIUS_WEBHOOK_URL = "https://api-mainnet.helius-rpc.com/v0/webhooks";

async function clearFirestore(db, dryRun) {
  if (dryRun) {
    console.log(
      "[DRY RUN] Would recursiveDelete Firestore collections:",
      FIRESTORE_COLLECTIONS.join(", "),
    );
    return;
  }
  for (const collId of FIRESTORE_COLLECTIONS) {
    const ref = db.collection(collId);
    console.log("Deleting Firestore collection:", collId);
    await db.recursiveDelete(ref);
    console.log("  done:", collId);
  }
}

async function clearAuth(auth, dryRun) {
  if (dryRun) {
    console.log("[DRY RUN] Would delete all Auth users");
    return;
  }
  let total = 0;
  let pageToken;
  do {
    const list = await auth.listUsers(1000, pageToken);
    if (list.users.length === 0) break;
    const uids = list.users.map((u) => u.uid);
    await auth.deleteUsers(uids);
    total += uids.length;
    console.log("Deleted Auth users:", total);
    pageToken = list.pageToken;
  } while (pageToken);
  console.log("Auth: total users deleted:", total);
}

async function clearHeliusWebhook(dryRun) {
  const apiKey = process.env.HELIUS_API_KEY;
  const webhookId = process.env.HELIUS_WEBHOOK_ID;

  if (!apiKey) {
    console.warn("HELIUS_API_KEY not set in .env, skipping webhook clear");
    return;
  }
  if (!webhookId) {
    console.warn("HELIUS_WEBHOOK_ID not set in .env, skipping webhook clear");
    return;
  }

  if (dryRun) {
    console.log(
      "[DRY RUN] Would DELETE Helius webhook (next sync will create a new one)",
    );
    return;
  }

  // Helius requires at least one account address on PUT, so we DELETE the webhook instead.
  // Clear HELIUS_WEBHOOK_ID in .env so the next sync (or first watchlist add) creates a new webhook.
  const url = `${HELIUS_WEBHOOK_URL}/${webhookId}?api-key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, { method: "DELETE" });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Helius webhook DELETE failed: ${res.status} ${text}`);
  }
  console.log(
    "Helius webhook deleted. Clear HELIUS_WEBHOOK_ID in .env so the next sync creates a new webhook.",
  );
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const confirm = process.argv.includes("--confirm");

  if (!dryRun && !confirm) {
    console.error(
      "Safety: run with --confirm to actually reset, or --dry-run to only log.",
    );
    console.error("  npm run reset-all -- --confirm");
    process.exit(1);
  }

  if (confirm && !dryRun) {
    console.log(
      "Running FULL RESET (Firestore + Auth + Helius webhook addresses).",
    );
  }

  initFirebase();
  const db = getFirestore();
  const auth = getAuth();

  try {
    await clearFirestore(db, dryRun);
    await clearAuth(auth, dryRun);
    await clearHeliusWebhook(dryRun);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }

  console.log(dryRun ? "Dry run finished (no changes)." : "Reset finished.");
}

main();
