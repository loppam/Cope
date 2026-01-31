#!/usr/bin/env node
/**
 * Migration: Add xHandleLower to existing users for case-insensitive search.
 *
 * For each user with xHandle but missing xHandleLower:
 * - Set xHandleLower = xHandle.toLowerCase()
 *
 * Prerequisites:
 * - FIREBASE_SERVICE_ACCOUNT (JSON string) in .env
 *
 * Usage:
 *   npm run migrate-xhandle-lower
 *   # or: node --env-file=.env scripts/migrate-xhandle-lower.mjs
 *
 * Options:
 *   --dry-run   Log changes without writing to Firestore
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Load .env from project root if it exists
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env");
if (existsSync(envPath)) {
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      const key = m[1].trim();
      let val = m[2].replace(/^["']|["']$/g, "").trim();
      if (val.endsWith('"') && val.startsWith('"')) val = val.slice(1, -1);
      if (!(key in process.env)) process.env[key] = val;
    }
  }
}

import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

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
      "Missing Firebase credentials. Set FIREBASE_SERVICE_ACCOUNT in .env.",
    );
    process.exit(1);
  }

  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) console.log("[DRY RUN] No writes will be performed.\n");

  initFirebase();
  const db = getFirestore();

  const usersSnap = await db.collection("users").get();
  console.log(`Found ${usersSnap.size} users.\n`);

  let updated = 0;

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const data = userDoc.data();
    const xHandle = data.xHandle;

    if (!xHandle || typeof xHandle !== "string") continue;
    if (data.xHandleLower !== undefined) continue; // already migrated

    const xHandleLower = xHandle.toLowerCase();
    console.log(`  [${uid}] ${xHandle} -> xHandleLower: ${xHandleLower}`);

    if (!dryRun) {
      await userDoc.ref.update({
        xHandleLower,
        updatedAt: FieldValue.serverTimestamp(),
      });
      updated++;
    } else {
      updated++;
    }
  }

  console.log(`\nDone. Updated ${updated} users.`);
  if (dryRun && updated > 0) {
    console.log("Run without --dry-run to apply changes.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
