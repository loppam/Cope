#!/usr/bin/env node
/**
 * One-time migration: build pushTokenIndex from existing users/{uid}/pushTokens.
 * Run after deploying the push-token reverse index so "get all tokens" uses the index.
 *
 * Prerequisites:
 *   FIREBASE_SERVICE_ACCOUNT (JSON string) or FIREBASE_ADMIN_PROJECT_ID + FIREBASE_ADMIN_CLIENT_EMAIL + FIREBASE_ADMIN_PRIVATE_KEY
 *
 * Usage:
 *   npm run migrate-push-token-index
 *   # or: node --env-file=.env scripts/migrate-push-token-index.mjs
 *
 * Options:
 *   --dry-run   Log what would be written without writing to Firestore
 */

import { createHash } from "crypto";
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

const PUSH_TOKEN_INDEX = "pushTokenIndex";
const BATCH_SIZE = 500;

function pushTokenDocId(token) {
  return createHash("sha256").update(token).digest("hex");
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

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) console.log("[DRY RUN] No writes will be performed.\n");

  initFirebase();
  const db = getFirestore();

  console.log("Fetching all users...");
  const usersSnap = await db.collection("users").get();
  const uids = usersSnap.docs.map((d) => d.id);
  console.log(
    `Found ${uids.length} users. Reading pushTokens subcollections...`,
  );

  const indexEntries = [];
  for (const uid of uids) {
    const tokensSnap = await db
      .collection("users")
      .doc(uid)
      .collection("pushTokens")
      .get();
    tokensSnap.docs.forEach((doc) => {
      const data = doc.data();
      const token = data?.token;
      if (!token) return;
      const docId = pushTokenDocId(token);
      indexEntries.push({
        docId,
        uid,
        token,
        platform: data.platform || "web",
      });
    });
  }

  console.log(
    `Collected ${indexEntries.length} push tokens for pushTokenIndex.`,
  );

  if (indexEntries.length === 0) {
    console.log("Nothing to write.");
    return;
  }

  if (dryRun) {
    console.log(
      "[DRY RUN] Would write",
      indexEntries.length,
      "docs to",
      PUSH_TOKEN_INDEX,
    );
    return;
  }

  let written = 0;
  for (let i = 0; i < indexEntries.length; i += BATCH_SIZE) {
    const chunk = indexEntries.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const { docId, uid, token, platform } of chunk) {
      batch.set(db.collection(PUSH_TOKEN_INDEX).doc(docId), {
        uid,
        token,
        platform,
      });
    }
    await batch.commit();
    written += chunk.length;
    console.log(
      `Wrote ${written}/${indexEntries.length} docs to ${PUSH_TOKEN_INDEX}.`,
    );
  }

  console.log("Done. pushTokenIndex is ready for getAllUserTokens().");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
