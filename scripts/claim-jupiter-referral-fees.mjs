#!/usr/bin/env node
/**
 * Claim accumulated Jupiter referral fees from your referral token accounts.
 *
 * Prerequisites:
 * - npm install (so @jup-ag/referral-sdk and @solana/web3.js are installed)
 * - Set env: JUPITER_REFERRAL_ACCOUNT, SOLANA_RPC_URL, KEYPAIR_PATH (or KEYPAIR_JSON)
 *
 * Usage:
 *   node --env-file=.env.claim scripts/claim-jupiter-referral-fees.mjs
 *   # or export vars then:
 *   node scripts/claim-jupiter-referral-fees.mjs
 *
 * Optional .env.claim (do not commit; add to .gitignore):
 *   JUPITER_REFERRAL_ACCOUNT=your_referral_account_pubkey
 *   SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
 *   KEYPAIR_PATH=~/.config/solana/id.json
 */

import { ReferralProvider } from "@jup-ag/referral-sdk";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { readFileSync } from "fs";
import { resolve } from "path";

function getEnv(name, required = true) {
  const value = process.env[name];
  if (required && (value == null || value === "")) {
    console.error(
      `Missing required env: ${name}. Set JUPITER_REFERRAL_ACCOUNT, SOLANA_RPC_URL, and KEYPAIR_PATH (or KEYPAIR_JSON).`,
    );
    process.exit(1);
  }
  return value ?? "";
}

function loadKeypair() {
  const path = process.env.KEYPAIR_PATH;
  const json = process.env.KEYPAIR_JSON;
  if (json) {
    const secret = JSON.parse(json);
    return Keypair.fromSecretKey(Uint8Array.from(secret));
  }
  if (path) {
    const resolved = resolve(path.replace(/^~/, process.env.HOME || ""));
    const content = readFileSync(resolved, "utf-8");
    const secret = JSON.parse(content);
    return Keypair.fromSecretKey(Uint8Array.from(secret));
  }
  console.error(
    "Set KEYPAIR_PATH (path to keypair JSON file) or KEYPAIR_JSON (JSON array of secret key bytes).",
  );
  process.exit(1);
}

async function main() {
  const referralAccountPubkey = getEnv("JUPITER_REFERRAL_ACCOUNT");
  const rpcUrl = getEnv("SOLANA_RPC_URL");
  const payer = loadKeypair();

  const connection = new Connection(rpcUrl, "confirmed");
  const referralAccountPubKey = new PublicKey(referralAccountPubkey);

  console.log("Referral account:", referralAccountPubKey.toBase58());
  console.log("Payer:", payer.publicKey.toBase58());
  console.log("Fetching claim transactions...");

  const provider = new ReferralProvider(connection);
  const transactions = await provider.claimAllV2({
    payerPubKey: payer.publicKey,
    referralAccountPubKey,
  });

  if (!transactions?.length) {
    console.log(
      "No claimable fees (or no referral token accounts with balance).",
    );
    return;
  }

  console.log(`Sending ${transactions.length} claim transaction(s)...`);

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    try {
      if (tx instanceof VersionedTransaction) {
        tx.sign([payer]);
        const sig = await connection.sendTransaction(tx, {
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 3,
        });
        console.log(`  [${i + 1}/${transactions.length}] Sent: ${sig}`);
        // Wait for confirmation
        const latest = await connection.getLatestBlockhash("confirmed");
        await connection.confirmTransaction(
          {
            signature: sig,
            blockhash: latest.blockhash,
            lastValidBlockHeight: latest.lastValidBlockHeight,
          },
          "confirmed",
        );
        console.log(`  [${i + 1}/${transactions.length}] Confirmed: ${sig}`);
      } else {
        const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 3,
        });
        console.log(`  [${i + 1}/${transactions.length}] Claimed: ${sig}`);
      }
    } catch (err) {
      console.error(`  [${i + 1}/${transactions.length}] Failed:`, err.message);
    }
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
