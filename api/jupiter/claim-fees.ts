import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ReferralProvider } from "@jup-ag/referral-sdk";
import {
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

// Initialize Firebase Admin (only once, same pattern as api/webhook/transaction.ts)
if (getApps().length === 0) {
  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  let projectId: string | undefined;
  let clientEmail: string | undefined;
  let privateKey: string | undefined;

  if (rawServiceAccount) {
    const serviceAccount = JSON.parse(rawServiceAccount);
    projectId = serviceAccount.project_id;
    clientEmail = serviceAccount.client_email;
    privateKey = serviceAccount.private_key?.replace(/\\n/g, "\n");
  }

  projectId = projectId || process.env.FIREBASE_ADMIN_PROJECT_ID;
  clientEmail = clientEmail || process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  if (!privateKey && process.env.FIREBASE_ADMIN_PRIVATE_KEY) {
    privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n");
  }

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase admin credentials are not fully configured");
  }

  initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
}

const adminAuth = getAuth();
const adminDb = getFirestore();

async function getAdminUser(
  req: VercelRequest,
): Promise<{ uid: string } | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const userRef = adminDb.collection("users").doc(decoded.uid);
    const snap = await userRef.get();
    const xHandle = snap.data()?.xHandle?.toLowerCase();
    if (xHandle !== "@lopam.eth") return null;
    return { uid: decoded.uid };
  } catch {
    return null;
  }
}

function loadKeypair(): Keypair | null {
  const json = process.env.KEYPAIR_JSON;
  if (!json) return null;
  try {
    const secret = JSON.parse(json);
    return Keypair.fromSecretKey(Uint8Array.from(secret));
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const user = await getAdminUser(req);
  if (!user) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const referralAccountPubkey = process.env.JUPITER_REFERRAL_ACCOUNT;
  const rpcUrl = process.env.SOLANA_RPC_URL;
  const payer = loadKeypair();

  if (!referralAccountPubkey || !rpcUrl) {
    return res.status(500).json({
      error: "Jupiter claim not configured",
      message: "Set JUPITER_REFERRAL_ACCOUNT and SOLANA_RPC_URL in Vercel env",
    });
  }

  if (!payer) {
    return res.status(500).json({
      error: "Keypair not configured",
      message:
        "Set KEYPAIR_JSON (JSON array of secret key bytes) in Vercel env",
    });
  }

  try {
    const connection = new Connection(rpcUrl, "confirmed");
    const referralAccountPubKey = new PublicKey(referralAccountPubkey);

    const provider = new ReferralProvider(connection);
    const transactions = await provider.claimAllV2({
      payerPubKey: payer.publicKey,
      referralAccountPubKey,
    });

    if (!transactions?.length) {
      return res.status(200).json({
        success: true,
        count: 0,
        signatures: [],
        message:
          "No claimable fees (or no referral token accounts with balance).",
      });
    }

    const signatures: string[] = [];

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
          const latest = await connection.getLatestBlockhash("confirmed");
          await connection.confirmTransaction(
            {
              signature: sig,
              blockhash: latest.blockhash,
              lastValidBlockHeight: latest.lastValidBlockHeight,
            },
            "confirmed",
          );
          signatures.push(sig);
        } else {
          const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
            skipPreflight: false,
            preflightCommitment: "confirmed",
            maxRetries: 3,
          });
          signatures.push(sig);
        }
      } catch (err) {
        console.error(`[Jupiter claim] Tx ${i + 1} failed:`, err);
        return res.status(500).json({
          error: "Claim failed",
          message: (err as Error).message,
          signatures,
          count: signatures.length,
        });
      }
    }

    return res.status(200).json({
      success: true,
      count: signatures.length,
      signatures,
      message: `Claimed ${signatures.length} fee transaction(s).`,
    });
  } catch (error) {
    console.error("[Jupiter claim] Error:", error);
    return res.status(500).json({
      error: "Claim failed",
      message: (error as Error).message,
    });
  }
}
