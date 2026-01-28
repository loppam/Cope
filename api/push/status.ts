import type { VercelRequest, VercelResponse } from '@vercel/node';
import { adminAuth, adminDb } from '../lib/firebaseAdmin';

async function getUid(req: VercelRequest) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const token = authHeader.replace('Bearer ', '');
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const uid = await getUid(req);
  if (!uid) return res.status(401).json({ error: 'Unauthorized' });

  const tokensRef = adminDb.collection('users').doc(uid).collection('pushTokens');
  const snapshot = await tokensRef.get();
  return res.status(200).json({ tokens: snapshot.size, enabled: snapshot.size > 0 });
}
