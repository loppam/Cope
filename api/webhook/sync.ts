// Vercel Serverless Function: Sync all watched wallets to Helius webhook
// This should be called when a wallet is added/removed from watchlist
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin (only once)
if (getApps().length === 0) {
  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  let projectId: string | undefined;
  let clientEmail: string | undefined;
  let privateKey: string | undefined;

  if (rawServiceAccount) {
    const serviceAccount = JSON.parse(rawServiceAccount);
    projectId = serviceAccount.project_id;
    clientEmail = serviceAccount.client_email;
    privateKey = serviceAccount.private_key?.replace(/\\n/g, '\n');
  }

  projectId = projectId || process.env.FIREBASE_ADMIN_PROJECT_ID;
  clientEmail = clientEmail || process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  if (!privateKey && process.env.FIREBASE_ADMIN_PRIVATE_KEY) {
    privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, '\n');
  }

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Firebase admin credentials are not fully configured');
  }

  initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
}

const db = getFirestore();
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const HELIUS_API_URL = 'https://api.helius.xyz/v0/webhooks';
const WEBHOOK_ID = process.env.HELIUS_WEBHOOK_ID; // Store this in .env after creating first webhook

/**
 * Sync all watched wallets across all users to Helius webhook
 * This aggregates all unique wallet addresses from all user watchlists
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Optional: Add authentication/authorization here
  const authHeader = req.headers.authorization;
  if (process.env.WEBHOOK_SYNC_SECRET && authHeader !== `Bearer ${process.env.WEBHOOK_SYNC_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (!HELIUS_API_KEY) {
      return res.status(500).json({ error: 'HELIUS_API_KEY not configured' });
    }

    // Get all users with watchlists
    const usersSnapshot = await db.collection('users').get();
    const allWatchedWallets = new Set<string>();

    usersSnapshot.docs.forEach(doc => {
      const userData = doc.data();
      const watchlist = userData.watchlist || [];
      watchlist.forEach((w: any) => {
        if (w.address) {
          allWatchedWallets.add(w.address);
        }
      });
    });

    const accountAddresses = Array.from(allWatchedWallets);

    if (accountAddresses.length === 0) {
      return res.status(200).json({ 
        success: true, 
        message: 'No wallets to monitor',
        webhookId: WEBHOOK_ID 
      });
    }

    // Get webhook URL
    const webhookURL = process.env.WEBHOOK_URL || `${req.headers.origin || 'https://your-domain.vercel.app'}/api/webhook/transaction`;

    // If we have an existing webhook, update it
    if (WEBHOOK_ID) {
      const updateResponse = await fetch(`${HELIUS_API_URL}?api-key=${HELIUS_API_KEY}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          webhookID: WEBHOOK_ID,
          transactionTypes: ['ANY'],
          accountAddresses,
          webhookType: 'enhanced',
        }),
      });

      if (!updateResponse.ok) {
        const error = await updateResponse.text();
        throw new Error(`Failed to update webhook: ${error}`);
      }

      const data = await updateResponse.json();
      return res.status(200).json({ 
        success: true, 
        webhookId: data.webhookID,
        walletsMonitored: accountAddresses.length 
      });
    }

    // Create new webhook if it doesn't exist
    const createResponse = await fetch(`${HELIUS_API_URL}?api-key=${HELIUS_API_KEY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        webhookURL,
        transactionTypes: ['ANY'],
        accountAddresses,
        webhookType: 'enhanced',
      }),
    });

    if (!createResponse.ok) {
      const error = await createResponse.text();
      throw new Error(`Failed to create webhook: ${error}`);
    }

    const data = await createResponse.json();
    
    // Store webhook ID (you should save this to your .env or database)
    console.log(`New webhook created: ${data.webhookID}. Add this to HELIUS_WEBHOOK_ID in .env`);

    return res.status(200).json({ 
      success: true, 
      webhookId: data.webhookID,
      walletsMonitored: accountAddresses.length,
      message: 'Add webhookId to HELIUS_WEBHOOK_ID in .env'
    });
  } catch (error: any) {
    console.error('Webhook sync error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
