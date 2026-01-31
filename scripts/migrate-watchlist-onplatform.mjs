#!/usr/bin/env node
/**
 * Migration: Add onPlatform and uid to existing watchlist entries.
 *
 * For each watchlist entry without onPlatform:
 * - If the wallet address belongs to a public user on the platform: set onPlatform=true, uid=that user's uid
 * - Otherwise: set onPlatform=false
 *
 * Prerequisites:
 * - FIREBASE_SERVICE_ACCOUNT (JSON string) or FIREBASE_ADMIN_PROJECT_ID + FIREBASE_ADMIN_CLIENT_EMAIL + FIREBASE_ADMIN_PRIVATE_KEY
 *
 * Usage:
 *   npm run migrate-watchlist-onplatform
 *   # or: node --env-file=.env scripts/migrate-watchlist-onplatform.mjs
 *
 * Options:
 *   --dry-run   Log changes without writing to Firestore
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Load .env from project root if it exists (Node does not auto-load .env)
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
import { getFirestore, FieldValue } from "firebase-admin/firestore";

function isUserPublic(data) {
  return data.isPublic !== false;
}

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
      "Missing Firebase credentials. Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_ADMIN_* env vars.",
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

  // Build walletAddress -> { uid, isPublic }
  const walletToUser = new Map();
  const usersSnap = await db.collection("users").get();
  usersSnap.docs.forEach((doc) => {
    const d = doc.data();
    const addr = d.walletAddress;
    if (addr && typeof addr === "string") {
      walletToUser.set(addr, {
        uid: doc.id,
        isPublic: isUserPublic(d),
      });
    }
  });

  console.log(
    `Found ${usersSnap.size} users, ${walletToUser.size} with wallet addresses.\n`,
  );

  let updatedUsers = 0;
  let updatedEntries = 0;

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const data = userDoc.data();
    const watchlist = data.watchlist || [];
    if (watchlist.length === 0) continue;

    let changed = false;
    const newWatchlist = watchlist.map((w) => {
      if (w.onPlatform !== undefined) {
        return w; // already has onPlatform, keep as-is
      }

      const info = walletToUser.get(w.address);
      if (info && info.isPublic) {
        changed = true;
        updatedEntries++;
        console.log(
          `  [${uid}] ${w.address.slice(0, 8)}... -> onPlatform=true, uid=${info.uid}`,
        );
        return { ...w, onPlatform: true, uid: info.uid };
      } else {
        changed = true;
        updatedEntries++;
        if (info && !info.isPublic) {
          console.log(
            `  [${uid}] ${w.address.slice(0, 8)}... -> onPlatform=false (user private)`,
          );
        } else {
          console.log(
            `  [${uid}] ${w.address.slice(0, 8)}... -> onPlatform=false (not on platform)`,
          );
        }
        return { ...w, onPlatform: false };
      }
    });

    if (changed && !dryRun) {
      await userDoc.ref.update({
        watchlist: newWatchlist,
        updatedAt: FieldValue.serverTimestamp(),
      });
      updatedUsers++;
    } else if (changed && dryRun) {
      updatedUsers++;
    }
  }

  console.log(
    `\nDone. Updated ${updatedUsers} users, ${updatedEntries} watchlist entries.`,
  );
  if (dryRun) {
    console.log(
      "Run without --dry-run to apply changes. Then trigger webhook sync.",
    );
  } else if (updatedUsers > 0) {
    console.log(
      "Run webhook sync (e.g. curl -X POST -H 'Authorization: Bearer $WEBHOOK_SYNC_SECRET' $API_URL/api/webhook/sync) to refresh watchedWallets and Helius.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
