#!/usr/bin/env node
/**
 * One-time backfill: send 0.005 SOL to every existing user with a walletAddress
 * whose current SOL balance is below 0.005 SOL (so they can pay tx fees).
 *
 * Prerequisites: .env with FIREBASE_SERVICE_ACCOUNT (or FIREBASE_ADMIN_*),
 * FUNDER_PRIVATE_KEY (base58 Solana private key), and optionally SOLANA_RPC_URL or HELIUS_API_KEY.
 *
 * Usage:
 *   node scripts/fund-existing-wallets-sol.mjs
 *   node scripts/fund-existing-wallets-sol.mjs --dry-run
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
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import bs58 from "bs58";

const SOL_FUNDER_AMOUNT_LAMPORTS = 5_000_000; // 0.005 SOL
const SOL_THRESHOLD_LAMPORTS = 5_000_000; // fund if balance below this
const DELAY_MS = 500;

function getRpcUrl() {
  if (process.env.SOLANA_RPC_URL) return process.env.SOLANA_RPC_URL;
  if (process.env.HELIUS_API_KEY) {
    return `https://rpc.helius.xyz/?api-key=${process.env.HELIUS_API_KEY}`;
  }
  return "https://api.mainnet-beta.solana.com";
}

function getFunderKeypair() {
  const raw = process.env.FUNDER_PRIVATE_KEY;
  if (!raw || typeof raw !== "string" || raw.trim() === "") {
    return null;
  }
  try {
    const secret = bs58.decode(raw.trim());
    return Keypair.fromSecretKey(secret);
  } catch (e) {
    console.error("Invalid FUNDER_PRIVATE_KEY:", e.message);
    return null;
  }
}

async function sendSolFromFunder(connection, funderKeypair, destination, lamports) {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: funderKeypair.publicKey,
      toPubkey: new PublicKey(destination),
      lamports,
    })
  );
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = funderKeypair.publicKey;
  tx.sign(funderKeypair);
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });
  return sig;
}

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

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) console.log("[dry-run] No SOL will be sent.\n");

  const funderKeypair = getFunderKeypair();
  if (!funderKeypair) {
    console.error("Set FUNDER_PRIVATE_KEY (base58 Solana private key) in .env");
    process.exit(1);
  }

  initFirebase();
  const db = getFirestore();
  const connection = new Connection(getRpcUrl(), "confirmed");

  const usersSnap = await db.collection("users").get();
  let funded = 0;
  let skipped = 0;

  for (const doc of usersSnap.docs) {
    const userId = doc.id;
    const walletAddress = doc.data()?.walletAddress;
    if (!walletAddress || typeof walletAddress !== "string" || walletAddress.length < 32) {
      skipped++;
      continue;
    }

    let balance;
    try {
      balance = await connection.getBalance(new PublicKey(walletAddress));
    } catch (e) {
      console.warn(`[${userId}] getBalance failed:`, e.message);
      skipped++;
      continue;
    }

    if (balance >= SOL_THRESHOLD_LAMPORTS) {
      skipped++;
      continue;
    }

    if (dryRun) {
      console.log(`[dry-run] Would fund ${userId} (${walletAddress}) balance=${balance} lamports`);
      funded++;
      continue;
    }

    try {
      const sig = await sendSolFromFunder(connection, funderKeypair, walletAddress, SOL_FUNDER_AMOUNT_LAMPORTS);
      console.log(`[${userId}] funded ${walletAddress} sig=${sig}`);
      funded++;
    } catch (e) {
      console.error(`[${userId}] fund failed:`, e.message);
    }

    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  console.log(`\nDone. Funded: ${funded}, Skipped: ${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
