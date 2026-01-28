import type { VercelRequest, VercelResponse } from "@vercel/node";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { Keypair } from "@solana/web3.js";
import crypto from "crypto";

// Initialize Firebase Admin
function initFirebaseAdmin() {
  if (getApps().length > 0) {
    return getFirestore();
  }

  let serviceAccount;
  try {
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (serviceAccountJson) {
      serviceAccount = JSON.parse(serviceAccountJson);
    } else {
      // Try individual environment variables
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

    initializeApp({
      credential: cert(serviceAccount as any),
    });
  } catch (error: any) {
    console.error("Firebase Admin initialization error:", error);
    throw new Error(`Firebase Admin init failed: ${error.message}`);
  }

  return getFirestore();
}

// Decrypt function matching client-side encryption format
// Client-side uses: base64(salt(16 bytes) + iv(12 bytes) + encrypted)
// With PBKDF2 key derivation (100k iterations) and AES-GCM encryption
async function decrypt(
  encryptedData: string,
  password: string,
): Promise<string> {
  try {
    // Decode from base64 (same as client-side atob)
    const binary = Buffer.from(encryptedData, "base64");

    // Extract salt, IV, and encrypted data (same format as client-side)
    const salt = binary.slice(0, 16);
    const iv = binary.slice(16, 28);
    const encrypted = binary.slice(28);

    // Derive key using PBKDF2 (same as client-side: 100k iterations, SHA-256)
    const key = crypto.pbkdf2Sync(
      password,
      salt,
      100000, // Same iterations as client-side
      32, // 256 bits = 32 bytes
      "sha256",
    );

    // Decrypt using AES-GCM (same as client-side)
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);

    // Extract auth tag (last 16 bytes of encrypted data for GCM)
    const authTagLength = 16;
    const ciphertext = encrypted.slice(0, -authTagLength);
    const authTag = encrypted.slice(-authTagLength);

    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString("utf8");
  } catch (error: any) {
    console.error("Decryption error:", error);
    throw new Error(`Failed to decrypt: ${error.message}`);
  }
}

// Derive public key from secret key
function derivePublicKeyFromSecretKey(secretKey: Uint8Array): string {
  try {
    const keypair = Keypair.fromSecretKey(secretKey);
    return keypair.publicKey.toBase58();
  } catch (error) {
    console.error("Error deriving public key:", error);
    throw new Error("Failed to derive public key from secret key");
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Check for admin authorization (you can add a secret token check here)
  const authToken = req.headers.authorization?.replace("Bearer ", "");
  if (!authToken || authToken !== process.env.MIGRATION_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const db = initFirebaseAdmin();
    const encryptionSecret = process.env.ENCRYPTION_SECRET;

    if (!encryptionSecret) {
      return res
        .status(500)
        .json({ error: "ENCRYPTION_SECRET not configured" });
    }

    // Find all users with encryptedSecretKey but null walletAddress
    const usersRef = db.collection("users");
    const snapshot = await usersRef
      .where("encryptedSecretKey", "!=", null)
      .get();

    const results = {
      processed: 0,
      fixed: 0,
      errors: [] as Array<{ uid: string; error: string }>,
    };

    for (const doc of snapshot.docs) {
      const userData = doc.data();
      const uid = doc.id;

      // Skip if walletAddress is already set
      if (userData.walletAddress) {
        continue;
      }

      // Skip if encryptedSecretKey is missing
      if (!userData.encryptedSecretKey) {
        continue;
      }

      results.processed++;

      try {
        // Decrypt the secret key using the same method as client-side
        const encryptionKey = `${uid}:${encryptionSecret}`;
        const decryptedSecretKeyStr = await decrypt(
          userData.encryptedSecretKey,
          encryptionKey,
        );
        const secretKey = new Uint8Array(JSON.parse(decryptedSecretKeyStr));

        // Derive public key from secret key
        const walletAddress = derivePublicKeyFromSecretKey(secretKey);

        // Update the document with all required fields
        await doc.ref.update({
          walletAddress,
          walletConnected: true,
          isNew: false,
          updatedAt: FieldValue.serverTimestamp(),
        });

        results.fixed++;
        console.log(`Fixed user ${uid}: walletAddress=${walletAddress}`);
      } catch (error: any) {
        console.error(`Error fixing user ${uid}:`, error);
        results.errors.push({
          uid,
          error: error.message || "Unknown error",
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: `Migration completed: ${results.fixed} users fixed, ${results.errors.length} errors`,
      results,
    });
  } catch (error: any) {
    console.error("Migration error:", error);
    return res.status(500).json({
      error: "Migration failed",
      message: error.message,
    });
  }
}
