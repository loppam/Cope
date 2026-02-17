// POST /api/account/remove-wallet – Remove wallet from user, archive to deletedWallets for support recovery.
// Requires Authorization: Bearer <idToken>. Confirmation (including funds warning) is done in the client.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

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
const db = getFirestore();

async function getUidFromHeader(req: VercelRequest): Promise<string | null> {
  const authorization = req.headers.authorization;
  if (!authorization) return null;
  const token = authorization.replace("Bearer ", "").trim();
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

function removeEvmAddressFromAlchemyWebhooks(addr: string): void {
  const apiKey =
    process.env.ALCHEMY_NOTIFY_AUTH_TOKEN || process.env.ALCHEMY_API_KEY;
  const webhookIdBase = process.env.ALCHEMY_EVM_DEPOSIT_WEBHOOK_ID_BASE;
  const webhookIdBnb = process.env.ALCHEMY_EVM_DEPOSIT_WEBHOOK_ID_BNB;
  if (!apiKey || !webhookIdBase || !webhookIdBnb) return;
  const low = addr.toLowerCase();
  const body = (id: string) =>
    JSON.stringify({
      webhook_id: id,
      addresses_to_add: [],
      addresses_to_remove: [low],
    });
  const opts = {
    method: "PATCH" as const,
    headers: {
      "Content-Type": "application/json",
      "X-Alchemy-Token": apiKey,
    },
  };
  const url = "https://dashboard.alchemy.com/api/update-webhook-addresses";
  Promise.all([
    fetch(url, { ...opts, body: body(webhookIdBase) }),
    fetch(url, { ...opts, body: body(webhookIdBnb) }),
  ]).catch((e) =>
    console.warn("Alchemy webhook address remove on wallet remove:", e),
  );
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const uid = await getUidFromHeader(req);
  if (!uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    const userData = userSnap.exists ? userSnap.data() : null;

    const walletAddress = userData?.walletAddress;
    const evmAddress = userData?.evmAddress;
    const encryptedMnemonic = userData?.encryptedMnemonic;
    const encryptedSecretKey = userData?.encryptedSecretKey;
    const balance = userData?.balance;

    if (walletAddress || encryptedSecretKey || encryptedMnemonic) {
      const deletedRef = db
        .collection("deletedWallets")
        .doc(`${uid}_${Date.now()}`);
      await deletedRef.set({
        uid,
        walletAddress: walletAddress || null,
        evmAddress: evmAddress || null,
        encryptedMnemonic: encryptedMnemonic || null,
        encryptedSecretKey: encryptedSecretKey || null,
        balanceAtDeletion: typeof balance === "number" ? balance : null,
        deletedAt: FieldValue.serverTimestamp(),
        reason: "user_requested",
      });
    }

    if (
      evmAddress &&
      typeof evmAddress === "string" &&
      evmAddress.length >= 40
    ) {
      removeEvmAddressFromAlchemyWebhooks(evmAddress);
    }

    await userRef.set(
      {
        walletAddress: null,
        balance: 0,
        walletConnected: false,
        isNew: true,
        encryptedMnemonic: null,
        encryptedSecretKey: null,
        evmAddress: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    res.status(200).json({ success: true });
  } catch (error: unknown) {
    console.error("Remove wallet error:", error);
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to remove wallet",
    });
  }
}
