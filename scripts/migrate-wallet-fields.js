#!/usr/bin/env node

/**
 * Migration script to fix wallet fields for existing users
 * Run with: node scripts/migrate-wallet-fields.js
 *
 * Requires environment variables:
 * - ENCRYPTION_SECRET (same as VITE_ENCRYPTION_SECRET)
 * - FIREBASE_SERVICE_ACCOUNT (JSON string) OR FIREBASE_ADMIN_* variables
 */

import admin from "firebase-admin";
import crypto from "crypto";
import { Keypair } from "@solana/web3.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Load .env file manually
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, "..", ".env");

try {
  const envFile = readFileSync(envPath, "utf8");
  envFile.split("\n").forEach((line) => {
    const [key, ...valueParts] = line.split("=");
    if (key && valueParts.length > 0) {
      const value = valueParts.join("=").trim();
      if (!process.env[key]) {
        process.env[key] = value.replace(/^["']|["']$/g, "");
      }
    }
  });
} catch (error) {
  console.warn("Could not load .env file, using environment variables");
}

// Initialize Firebase Admin
function initFirebaseAdmin() {
  if (admin.apps.length > 0) {
    return admin.firestore();
  }

  let serviceAccount;
  try {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (serviceAccountJson) {
      serviceAccount = JSON.parse(serviceAccountJson);
    } else {
      serviceAccount = {
        projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
        clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(
          /\\n/g,
          "\n",
        ),
      };
    }

    if (!serviceAccount.projectId) {
      throw new Error("Firebase Admin credentials not configured");
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } catch (error) {
    console.error("Firebase Admin initialization error:", error);
    throw new Error(`Firebase Admin init failed: ${error.message}`);
  }

  return admin.firestore();
}

// Decrypt function matching client-side encryption format
async function decrypt(encryptedData, password) {
  try {
    // Decode from base64
    const binary = Buffer.from(encryptedData, "base64");

    // Extract salt, IV, and encrypted data
    const salt = binary.slice(0, 16);
    const iv = binary.slice(16, 28);
    const encrypted = binary.slice(28);

    // Derive key using PBKDF2 (same as client-side: 100k iterations, SHA-256)
    const key = crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256");

    // Decrypt using AES-GCM
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);

    // Extract auth tag (last 16 bytes)
    const authTagLength = 16;
    const ciphertext = encrypted.slice(0, -authTagLength);
    const authTag = encrypted.slice(-authTagLength);

    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString("utf8");
  } catch (error) {
    console.error("Decryption error:", error);
    throw new Error(`Failed to decrypt: ${error.message}`);
  }
}

// Derive public key from secret key
function derivePublicKeyFromSecretKey(secretKey) {
  try {
    const keypair = Keypair.fromSecretKey(secretKey);
    return keypair.publicKey.toBase58();
  } catch (error) {
    console.error("Error deriving public key:", error);
    throw new Error("Failed to derive public key from secret key");
  }
}

async function runMigration() {
  try {
    const db = initFirebaseAdmin();
    const encryptionSecret =
      process.env.ENCRYPTION_SECRET || process.env.VITE_ENCRYPTION_SECRET;

    if (!encryptionSecret) {
      throw new Error(
        "ENCRYPTION_SECRET or VITE_ENCRYPTION_SECRET not found in environment variables",
      );
    }

    console.log("Starting migration...");
    console.log(
      `Using encryption secret: ${encryptionSecret.substring(0, 10)}...`,
    );

    // Find all users with encryptedSecretKey but null walletAddress
    const usersRef = db.collection("users");
    const snapshot = await usersRef
      .where("encryptedSecretKey", "!=", null)
      .get();

    const results = {
      processed: 0,
      fixed: 0,
      skipped: 0,
      errors: [],
    };

    console.log(`Found ${snapshot.size} users with encryptedSecretKey`);

    for (const doc of snapshot.docs) {
      const userData = doc.data();
      const uid = doc.id;

      // Skip if walletAddress is already set
      if (userData.walletAddress) {
        results.skipped++;
        continue;
      }

      // Skip if encryptedSecretKey is missing
      if (!userData.encryptedSecretKey) {
        results.skipped++;
        continue;
      }

      results.processed++;
      console.log(`\nProcessing user ${uid}...`);

      try {
        // Decrypt the secret key
        const encryptionKey = `${uid}:${encryptionSecret}`;
        const decryptedSecretKeyStr = await decrypt(
          userData.encryptedSecretKey,
          encryptionKey,
        );
        const secretKey = new Uint8Array(JSON.parse(decryptedSecretKeyStr));

        // Derive public key from secret key
        const walletAddress = derivePublicKeyFromSecretKey(secretKey);
        console.log(`  Derived wallet address: ${walletAddress}`);

        // Update the document with all required fields
        await doc.ref.update({
          walletAddress,
          walletConnected: true,
          isNew: false,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        results.fixed++;
        console.log(`  ✓ Fixed user ${uid}`);
      } catch (error) {
        console.error(`  ✗ Error fixing user ${uid}:`, error.message);
        results.errors.push({
          uid,
          error: error.message || "Unknown error",
        });
      }
    }

    console.log("\n" + "=".repeat(50));
    console.log("Migration Summary:");
    console.log(`  Processed: ${results.processed}`);
    console.log(`  Fixed: ${results.fixed}`);
    console.log(`  Skipped: ${results.skipped}`);
    console.log(`  Errors: ${results.errors.length}`);

    if (results.errors.length > 0) {
      console.log("\nErrors:");
      results.errors.forEach(({ uid, error }) => {
        console.log(`  - ${uid}: ${error}`);
      });
    }

    console.log("\nMigration completed!");
    return results;
  } catch (error) {
    console.error("Migration error:", error);
    throw error;
  }
}

// Run the migration
runMigration()
  .then(() => {
    console.log("\nMigration script finished successfully");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\nMigration script failed:", error);
    process.exit(1);
  });
