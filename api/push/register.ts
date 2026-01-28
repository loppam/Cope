import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, serverTimestamp } from 'firebase-admin/firestore';

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

async function getUidFromHeader(req: VercelRequest) {
  const authorization = req.headers.authorization;
  if (!authorization) return null;
  const token = authorization.replace('Bearer ', '');
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return decoded.uid;
  } catch (error) {
    console.error('Invalid token', error);
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const uid = await getUidFromHeader(req);
  if (!uid) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { token, platform } = req.body || {};
  if (!token) {
    return res.status(400).json({ error: 'Token is required' });
  }

  const tokenRef = adminDb.collection('users').doc(uid).collection('pushTokens').doc(token);
  if (req.method === 'POST') {
    await tokenRef.set(
      {
        token,
        platform: platform || 'web',
        createdAt: serverTimestamp(),
        lastSeenAt: serverTimestamp(),
      },
      { merge: true }
    );
    return res.status(200).json({ success: true });
  }

  await tokenRef.delete();
  return res.status(200).json({ success: true });
}
