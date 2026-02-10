import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { Keypair, VersionedTransaction, Connection } from "@solana/web3.js";
import { decryptWalletCredentials } from "./decrypt";

function initFirebase() {
  if (getApps().length > 0) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  let projectId: string | undefined;
  let clientEmail: string | undefined;
  let privateKey: string | undefined;
  if (raw) {
    const sa = JSON.parse(raw);
    projectId = sa.project_id;
    clientEmail = sa.client_email;
    privateKey = sa.private_key?.replace(/\\n/g, "\n");
  }
  projectId = projectId || process.env.FIREBASE_ADMIN_PROJECT_ID;
  clientEmail = clientEmail || process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  privateKey = privateKey || process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase admin credentials not configured");
  }
  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
}

function getRpcUrl(): string {
  if (process.env.SOLANA_RPC_URL) return process.env.SOLANA_RPC_URL;
  const helius = process.env.HELIUS_API_KEY;
  if (helius) return `https://mainnet.helius-rpc.com/?api-key=${helius}`;
  return "https://api.mainnet-beta.solana.com";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    initFirebase();
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const token = authHeader.slice(7);
    const decoded = await getAuth().verifyIdToken(token);
    const userId = decoded.uid;

    const body = req.body as {
      quoteResponse?: unknown;
      stepIndex?: number;
    };
    const quoteResponse = body?.quoteResponse;
    const stepIndex = typeof body?.stepIndex === "number" ? body.stepIndex : 0;

    if (!quoteResponse || typeof quoteResponse !== "object") {
      return res.status(400).json({ error: "Missing quoteResponse" });
    }

    const quote = quoteResponse as { steps?: Array<{ kind?: string; items?: Array<{ data?: unknown }> }> };
    const steps = quote?.steps;
    if (!Array.isArray(steps) || !steps[stepIndex]) {
      return res.status(400).json({ error: "Invalid step index or steps" });
    }

    const step = steps[stepIndex];
    const items = step?.items;
    const firstItem = Array.isArray(items) ? items[0] : null;
    const data = firstItem?.data;

    if (!data) {
      return res.status(400).json({ error: "No step data to execute" });
    }

    const encryptionSecret = process.env.ENCRYPTION_SECRET;
    if (!encryptionSecret) {
      return res.status(503).json({ error: "ENCRYPTION_SECRET not configured" });
    }

    const db = getFirestore();
    const userSnap = await db.collection("users").doc(userId).get();
    const userData = userSnap.data();
    const encryptedSecretKey = userData?.encryptedSecretKey;
    const encryptedMnemonic = userData?.encryptedMnemonic;

    if (!encryptedSecretKey) {
      return res.status(400).json({ error: "Wallet credentials not found" });
    }

    const { secretKey } = await decryptWalletCredentials(
      userId,
      encryptedMnemonic,
      encryptedSecretKey,
      encryptionSecret
    );
    const wallet = Keypair.fromSecretKey(secretKey);

    let serializedTx: string | null = null;
    if (typeof data === "string") {
      serializedTx = data;
    } else if (data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      if (typeof d.serializedTransaction === "string") serializedTx = d.serializedTransaction;
      else if (typeof d.transaction === "string") serializedTx = d.transaction;
      else if (typeof d.payload === "string") serializedTx = d.payload;
      else if (typeof d.transactionBytes === "string") serializedTx = d.transactionBytes;
    }

    if (!serializedTx) {
      return res.status(400).json({ error: "Step data does not contain Solana transaction" });
    }

    const txBuffer = Buffer.from(serializedTx, "base64");
    const transaction = VersionedTransaction.deserialize(txBuffer);
    transaction.sign([wallet]);
    const signedSerialized = Buffer.from(transaction.serialize()).toString("base64");

    const connection = new Connection(getRpcUrl());
    const rawTx = Buffer.from(signedSerialized, "base64");
    const sig = await connection.sendRawTransaction(rawTx, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });

    return res.status(200).json({
      signature: sig,
      status: "Success",
    });
  } catch (e: unknown) {
    console.error("execute-step error:", e);
    const message = e instanceof Error ? e.message : "Internal server error";
    return res.status(500).json({
      error: message,
      signature: "",
      status: "Failed",
    });
  }
}
