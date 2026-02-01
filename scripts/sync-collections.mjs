#!/usr/bin/env node
/**
 * One-time / occasional script: backfill followers + watchedWallets from users.
 * Run after deploying the followers index and incremental watchlist flow.
 * Uses same logic as api/webhook/sync.ts (resolve onPlatform → target walletAddress).
 *
 * Prerequisites:
 *   FIREBASE_SERVICE_ACCOUNT (JSON string) or FIREBASE_ADMIN_PROJECT_ID + FIREBASE_ADMIN_CLIENT_EMAIL + FIREBASE_ADMIN_PRIVATE_KEY
 *
 * Usage:
 *   npm run sync-collections
 *   # or: node --env-file=.env scripts/sync-collections.mjs
 *
 * Options:
 *   --dry-run   Log what would be written without writing to Firestore
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
      "Missing Firebase credentials. Set FIREBASE_SERVICE_ACCOUNT or FIREBASE_ADMIN_* in .env",
    );
    process.exit(1);
  }

  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
}

const BATCH_SIZE = 500;

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) console.log("[DRY RUN] No writes will be performed.\n");

  initFirebase();
  const db = getFirestore();

  console.log("Fetching all users...");
  const usersSnap = await db.collection("users").get();
  const users = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const userByUid = new Map(
    users.map((u) => [
      u.id,
      {
        walletAddress: u.walletAddress || null,
        isPublic: isUserPublic(u),
      },
    ]),
  );

  // --- followers: targetUid -> followerUids[]
  const followersMap = new Map();
  const allTargetUids = new Set();

  for (const user of users) {
    const watchlist = user.watchlist || [];
    for (const w of watchlist) {
      if (w.onPlatform && w.uid) {
        allTargetUids.add(w.uid);
        const target = userByUid.get(w.uid);
        if (target?.isPublic && target?.walletAddress) {
          const list = followersMap.get(w.uid) || [];
          if (!list.includes(user.id)) list.push(user.id);
          followersMap.set(w.uid, list);
        }
      }
    }
  }

  // --- watchedWallets: address -> { watchers: { [uid]: { nickname?, addedAt? } } }
  const addressToWatchers = new Map();

  for (const user of users) {
    const watchlist = user.watchlist || [];
    for (const w of watchlist) {
      if (!w.address) continue;
      let effectiveAddress = null;
      if (w.onPlatform && w.uid) {
        const target = userByUid.get(w.uid);
        if (!target?.isPublic || !target?.walletAddress) continue;
        effectiveAddress = target.walletAddress;
      } else {
        effectiveAddress = w.address;
      }
      if (!effectiveAddress) continue;

      const addedAt =
        w.addedAt instanceof Date
          ? w.addedAt.toISOString()
          : typeof w.addedAt === "string"
            ? w.addedAt
            : new Date().toISOString();
      const existing = addressToWatchers.get(effectiveAddress) || {};
      // Firestore does not allow undefined; omit nickname when missing
      existing[user.id] = {
        addedAt,
        ...(w.nickname != null &&
          w.nickname !== "" && { nickname: w.nickname }),
      };
      addressToWatchers.set(effectiveAddress, existing);
    }
  }

  const addresses = Array.from(addressToWatchers.keys());

  if (dryRun) {
    console.log("Would write followers:", allTargetUids.size, "docs");
    console.log("Would write watchedWallets:", addresses.length, "docs");
    return;
  }

  // Write followers (batch limit 500)
  console.log("Writing followers...");
  const targetUidsArr = Array.from(allTargetUids);
  for (let i = 0; i < targetUidsArr.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = targetUidsArr.slice(i, i + BATCH_SIZE);
    for (const targetUid of chunk) {
      const ref = db.collection("followers").doc(targetUid);
      const followerUids = followersMap.get(targetUid) || [];
      batch.set(ref, { followerUids }, { merge: true });
    }
    await batch.commit();
  }
  console.log("Wrote", allTargetUids.size, "followers docs.");

  // Write watchedWallets
  console.log("Writing watchedWallets...");
  for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = addresses.slice(i, i + BATCH_SIZE);
    for (const addr of chunk) {
      const ref = db.collection("watchedWallets").doc(addr);
      batch.set(
        ref,
        { watchers: addressToWatchers.get(addr) },
        { merge: true },
      );
    }
    await batch.commit();
    console.log(
      "  watchedWallets",
      Math.min(i + BATCH_SIZE, addresses.length),
      "/",
      addresses.length,
    );
  }

  // Remove watchedWallets docs that are no longer in addressToWatchers
  const existingWatched = await db.collection("watchedWallets").get();
  const toDelete = existingWatched.docs.filter(
    (d) => !addressToWatchers.has(d.id),
  );
  if (toDelete.length > 0) {
    console.log("Deleting", toDelete.length, "stale watchedWallets docs...");
    for (let i = 0; i < toDelete.length; i += BATCH_SIZE) {
      const batch = db.batch();
      const chunk = toDelete.slice(i, i + BATCH_SIZE);
      chunk.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  }

  console.log(
    "Done. followers:",
    allTargetUids.size,
    "watchedWallets:",
    addresses.length,
    "stale deleted:",
    toDelete.length,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
