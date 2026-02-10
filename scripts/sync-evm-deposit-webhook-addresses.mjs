#!/usr/bin/env node
/**
 * One-time / occasional: push all users' evmAddress to Alchemy Address Activity webhooks
 * (Base and BNB) so EVM deposits trigger the evm-deposit webhook.
 *
 * Prerequisites: .env with FIREBASE_SERVICE_ACCOUNT (or FIREBASE_ADMIN_*),
 * ALCHEMY_API_KEY, ALCHEMY_EVM_DEPOSIT_WEBHOOK_ID_BASE, ALCHEMY_EVM_DEPOSIT_WEBHOOK_ID_BNB
 *
 * Usage:
 *   node --env-file=.env scripts/sync-evm-deposit-webhook-addresses.mjs
 *   # or: node scripts/sync-evm-deposit-webhook-addresses.mjs  (loads .env manually)
 *
 * Options:
 *   --dry-run   Log addresses that would be added, no API calls
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

const ALCHEMY_UPDATE_URL = "https://dashboard.alchemy.com/api/update-webhook-addresses";
const BATCH_SIZE = 500;

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
  if (privateKey && typeof privateKey === "string") privateKey = privateKey.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    console.error("Missing Firebase credentials. Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_ADMIN_* in .env");
    process.exit(1);
  }
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

async function addAddressesToWebhook(webhookId, addresses, apiKey) {
  const res = await fetch(ALCHEMY_UPDATE_URL, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-Alchemy-Token": apiKey,
    },
    body: JSON.stringify({
      webhook_id: webhookId,
      addresses_to_add: addresses,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Alchemy PATCH failed ${res.status}: ${text}`);
  }
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) console.log("[DRY RUN] No API calls will be made.\n");

  const apiKey = process.env.ALCHEMY_API_KEY;
  const webhookIdBase = process.env.ALCHEMY_EVM_DEPOSIT_WEBHOOK_ID_BASE;
  const webhookIdBnb = process.env.ALCHEMY_EVM_DEPOSIT_WEBHOOK_ID_BNB;

  if (!apiKey) {
    console.error("Missing ALCHEMY_API_KEY in .env");
    process.exit(1);
  }
  if (!webhookIdBase || !webhookIdBnb) {
    console.error("Missing ALCHEMY_EVM_DEPOSIT_WEBHOOK_ID_BASE or ALCHEMY_EVM_DEPOSIT_WEBHOOK_ID_BNB in .env");
    process.exit(1);
  }

  initFirebase();
  const db = getFirestore();

  const usersSnap = await db.collection("users").get();
  const addresses = [];
  for (const doc of usersSnap.docs) {
    const evm = doc.data().evmAddress;
    if (evm && typeof evm === "string" && evm.length >= 40) {
      addresses.push(evm.toLowerCase());
    }
  }
  const unique = [...new Set(addresses)];
  console.log("Found", unique.length, "unique evmAddress(es) from", usersSnap.size, "users.");

  if (unique.length === 0) {
    console.log("Nothing to sync.");
    return;
  }

  if (dryRun) {
    console.log("Would add to Base webhook:", webhookIdBase);
    console.log("Would add to BNB webhook:", webhookIdBnb);
    console.log("Addresses (first 5):", unique.slice(0, 5));
    return;
  }

  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const chunk = unique.slice(i, i + BATCH_SIZE);
    console.log("Adding batch", Math.floor(i / BATCH_SIZE) + 1, "(" + chunk.length, "addresses) to Base webhook...");
    await addAddressesToWebhook(webhookIdBase, chunk, apiKey);
    console.log("Adding same batch to BNB webhook...");
    await addAddressesToWebhook(webhookIdBnb, chunk, apiKey);
  }
  console.log("Done. Synced", unique.length, "addresses to both webhooks.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
