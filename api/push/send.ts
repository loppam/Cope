import type { VercelRequest, VercelResponse } from "@vercel/node";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

if (getApps().length === 0) {
  const serviceAccount = JSON.parse(
    process.env.FIREBASE_SERVICE_ACCOUNT || "{}",
  );
  initializeApp({
    credential: cert({
      projectId: serviceAccount.project_id,
      clientEmail: serviceAccount.client_email,
      privateKey: serviceAccount.private_key?.replace(/\\n/g, "\n"),
    }),
  });
}

const adminAuth = getAuth();
const adminDb = getFirestore();
const adminMessaging = getMessaging();

async function getUserData(req: VercelRequest) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const token = authHeader.replace("Bearer ", "");
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const userRef = adminDb.collection("users").doc(decoded.uid);
    const snap = await userRef.get();
    return { uid: decoded.uid, xHandle: snap.data()?.xHandle?.toLowerCase() };
  } catch (error) {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });
  const user = await getUserData(req);
  if (!user || user.xHandle !== "@lopam.eth") {
    return res.status(403).json({ error: "Forbidden" });
  }

  const { title, body, deepLink } = req.body || {};
  if (!title || !body) {
    return res.status(400).json({ error: "Title and body required" });
  }

  try {
    const tokens = await getUserTokens(user.uid);
    const invalidTokens = await sendToTokens(tokens, { title, body, deepLink });
    await Promise.all(
      invalidTokens.map((token) =>
        adminDb
          .collection("users")
          .doc(user.uid)
          .collection("pushTokens")
          .doc(token)
          .delete(),
      ),
    );
    return res.status(200).json({ success: true, removed: invalidTokens.length });
  } catch (error) {
    console.error("Failed to send push", error);
    return res.status(500).json({
      error: "Failed to send push",
      message: (error as Error).message,
    });
  }
}

async function getUserTokens(uid: string) {
  const snapshot = await adminDb
    .collection("users")
    .doc(uid)
    .collection("pushTokens")
    .get();
  const tokens: string[] = [];
  snapshot.forEach((doc) => {
    const data = doc.data();
    if (data.token) {
      tokens.push(data.token);
    }
  });
  return tokens;
}

async function sendToTokens(tokens: string[], payload: any) {
  if (!tokens.length) return [];
  const response = await adminMessaging.sendEachForMulticast({
    tokens,
    notification: {
      title: payload.title,
      body: payload.body,
    },
    data: payload.data || {},
    webpush: {
      fcmOptions: {
        link: payload.deepLink || "/app/alerts",
      },
    },
  });
  const invalidTokens: string[] = [];
  response.responses.forEach((resp, idx) => {
    if (!resp.success && resp.error?.code === "messaging/registration-token-not-registered") {
      invalidTokens.push(tokens[idx]);
    }
  });
  return invalidTokens;
}
