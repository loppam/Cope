import { collection, getDocs } from 'firebase-admin/firestore';
import { adminDb, adminMessaging } from '../../src/lib/firebaseAdmin';

export async function getUserTokens(uid: string): Promise<string[]> {
  const tokensRef = collection(adminDb, 'users', uid, 'pushTokens');
  const snapshot = await getDocs(tokensRef);
  const tokens: string[] = [];
  snapshot.forEach((doc) => {
    const data = doc.data();
    if (data.token) tokens.push(data.token);
  });
  return tokens;
}

export async function sendToTokens(tokens: string[], payload: any) {
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
        link: payload.deepLink || '/app/alerts',
      },
    },
  });
  const invalidTokens: string[] = [];
  response.responses.forEach((resp, idx) => {
    if (!resp.success && resp.error?.code === 'messaging/registration-token-not-registered') {
      invalidTokens.push(tokens[idx]);
    }
  });
  return invalidTokens;
}
