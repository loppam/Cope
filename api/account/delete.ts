// DELETE /api/account/delete – Permanently delete user account and all platform data.
// Requires Authorization: Bearer <idToken>. Double confirmation is done in the client (modal).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
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
const PUSH_TOKEN_INDEX = "pushTokenIndex";

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

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  if (req.method !== "POST" && req.method !== "DELETE") {
    res.setHeader("Allow", "POST, DELETE");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const uid = await getUidFromHeader(req);
  if (!uid) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    // 1. Delete push tokens: users/{uid}/pushTokens and pushTokenIndex
    const pushTokensRef = db.collection("users").doc(uid).collection("pushTokens");
    const pushSnap = await pushTokensRef.get();
    const batch = db.batch();
    for (const doc of pushSnap.docs) {
      batch.delete(doc.ref);
      const indexRef = db.collection(PUSH_TOKEN_INDEX).doc(doc.id);
      batch.delete(indexRef);
    }
    await batch.commit();

    // 2. Remove user's evmAddress from Alchemy deposit webhooks (if any), then delete user document
    const userRef = db.collection("users").doc(uid);
    const userSnap = await userRef.get();
    const evmAddress = userSnap.data()?.evmAddress;
    if (evmAddress && typeof evmAddress === "string" && evmAddress.length >= 40) {
      const apiKey = process.env.ALCHEMY_NOTIFY_AUTH_TOKEN || process.env.ALCHEMY_API_KEY;
      const webhookIdBase = process.env.ALCHEMY_EVM_DEPOSIT_WEBHOOK_ID_BASE;
      const webhookIdBnb = process.env.ALCHEMY_EVM_DEPOSIT_WEBHOOK_ID_BNB;
      const url = "https://dashboard.alchemy.com/api/update-webhook-addresses";
      const low = evmAddress.toLowerCase();
      const opts = {
        method: "PATCH" as const,
        headers: { "Content-Type": "application/json", "X-Alchemy-Token": apiKey },
      };
      if (apiKey && webhookIdBase && webhookIdBnb) {
        await Promise.all([
          fetch(url, { ...opts, body: JSON.stringify({ webhook_id: webhookIdBase, addresses_to_add: [], addresses_to_remove: [low] }) }),
          fetch(url, { ...opts, body: JSON.stringify({ webhook_id: webhookIdBnb, addresses_to_add: [], addresses_to_remove: [low] }) }),
        ]).catch((e) => console.warn("Alchemy webhook address remove on account delete:", e));
      }
    }
    await userRef.delete();

    // 3. Delete Firebase Auth user
    await adminAuth.deleteUser(uid);

    res.status(200).json({ success: true });
  } catch (error: any) {
    console.error("Account delete error:", error);
    res.status(500).json({
      error: error?.message || "Failed to delete account",
    });
  }
}
