import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminAuth, adminDb } from '../lib/firebaseAdmin';
import { serverTimestamp } from 'firebase-admin/firestore';

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
