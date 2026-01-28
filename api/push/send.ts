import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getUserTokens, sendToTokens } from '../../src/lib/pushUtils';

if (getApps().length === 0) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  initializeApp({
    credential: cert({
      projectId: serviceAccount.project_id,
      clientEmail: serviceAccount.client_email,
      privateKey: serviceAccount.private_key?.replace(/\\n/g, '\n'),
    }),
  });
}

const adminAuth = getAuth();
const adminDb = getFirestore();

async function getUserData(req: VercelRequest) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const token = authHeader.replace('Bearer ', '');
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const userRef = adminDb.collection('users').doc(decoded.uid);
    const snap = await userRef.get();
    return { uid: decoded.uid, xHandle: snap.data()?.xHandle?.toLowerCase() };
  } catch (error) {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const user = await getUserData(req);
  if (!user || user.xHandle !== '@lopam.eth') {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const { title, body, deepLink } = req.body || {};
  if (!title || !body) {
    return res.status(400).json({ error: 'Title and body required' });
  }

  const tokens = await getUserTokens(user.uid);
  const invalidTokens = await sendToTokens(tokens, { title, body, deepLink });
  invalidTokens.forEach(async (token) => {
    await adminDb.collection('users').doc(user.uid).collection('pushTokens').doc(token).delete();
  });
  return res.status(200).json({ success: true, removed: invalidTokens.length });
}
