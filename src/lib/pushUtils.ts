import { collection, getDocs } from 'firebase-admin/firestore';
import { adminDb, adminMessaging } from './firebaseAdmin';

export async function getUserTokens(uid: string): Promise<string[]> {
  const tokens: string[] = [];
  const tokensRef = collection(adminDb, 'users', uid, 'pushTokens');
  const snapshot = await getDocs(tokensRef);
  snapshot.forEach((doc) => {
    const data = doc.data();
    if (data.token) {
      tokens.push(data.token);
    }
  });
  return tokens;
}

export async function sendToTokens(tokens: string[], payload: any) {
  if (tokens.length === 0) return;
  const response = await adminMessaging.sendEachForMulticast({
    tokens,
    notification: {
      title: payload.title,
      body: payload.body,
    },
    webpush: {
      notification: {
        icon: '/icons/icon-192x192.png',
      },
      fcmOptions: {
        link: payload.deepLink || '/app/alerts',
      },
    },
    data: payload.data || {},
  });
  const invalidTokens: string[] = [];
  response.responses.forEach((resp, idx) => {
    if (!resp.success && resp.error && resp.error.code === 'messaging/registration-token-not-registered') {
      invalidTokens.push(tokens[idx]);
    }
  });
  return invalidTokens;
}
