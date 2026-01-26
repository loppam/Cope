// Vercel Serverless Function: Webhook endpoint for Helius transaction notifications
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin (only once)
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

const db = getFirestore();

interface HeliusWebhookPayload {
  accountData: Array<{
    account: string;
    nativeBalanceChange?: number;
    tokenBalanceChanges?: Array<{
      mint: string;
      rawTokenAmount: {
        tokenAmount: string;
      };
      tokenAccount: string;
    }>;
  }>;
  description: string;
  fee: number;
  feePayer: string;
  instructions: Array<any>;
  nativeTransfers: Array<{
    amount: number;
    fromUserAccount: string;
    toUserAccount: string;
  }>;
  signature: string;
  slot: number;
  source: string;
  timestamp: number;
  tokenTransfers: Array<{
    fromTokenAccount?: string;
    fromUserAccount?: string;
    mint: string;
    toTokenAccount?: string;
    toUserAccount?: string;
    tokenAmount: number;
    tokenStandard: string;
  }>;
  type: string;
  webhookId: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify webhook secret (optional but recommended)
  const webhookSecret = req.headers['x-helius-webhook-secret'];
  if (process.env.HELIUS_WEBHOOK_SECRET && webhookSecret !== process.env.HELIUS_WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const payload = req.body as HeliusWebhookPayload[] | HeliusWebhookPayload;
    
    // Helius sends an array of transactions
    const transactions = Array.isArray(payload) ? payload : [payload];

    for (const tx of transactions) {
      // Extract wallet addresses from the transaction
      const walletAddresses = new Set<string>();
      
      // Add fee payer
      if (tx.feePayer) {
        walletAddresses.add(tx.feePayer);
      }

      // Add native transfer participants
      tx.nativeTransfers?.forEach(transfer => {
        walletAddresses.add(transfer.fromUserAccount);
        walletAddresses.add(transfer.toUserAccount);
      });

      // Add token transfer participants
      tx.tokenTransfers?.forEach(transfer => {
        if (transfer.fromUserAccount) walletAddresses.add(transfer.fromUserAccount);
        if (transfer.toUserAccount) walletAddresses.add(transfer.toUserAccount);
      });

      // Add account data participants
      tx.accountData?.forEach(account => {
        walletAddresses.add(account.account);
      });

      // For each wallet address, check if it's in any user's watchlist
      for (const walletAddress of walletAddresses) {
        // Since Firestore doesn't support nested array queries easily,
        // we'll need to get all users and filter client-side
        // For better performance, we can maintain a separate collection
        const allUsersSnapshot = await db.collection('users').get();
        
        const usersWithWallet = allUsersSnapshot.docs.filter(doc => {
          const userData = doc.data();
          const watchlist = userData.watchlist || [];
          return watchlist.some((w: any) => w.address === walletAddress);
        });

        // Create notifications for each user watching this wallet
        for (const userDoc of usersWithWallet) {
          const userId = userDoc.id;
          const userData = userDoc.data();
          const watchlist = userData.watchlist || [];
          const watchedWallet = watchlist.find((w: any) => w.address === walletAddress);

          // Determine notification type and details
          const tokenTransfers = tx.tokenTransfers || [];
          const nativeTransfers = tx.nativeTransfers || [];
          const hasTokenTransfer = tokenTransfers.length > 0;
          const hasNativeTransfer = nativeTransfers.length > 0;

          // Calculate total USD value (simplified - you might want to fetch token prices)
          let amountUsd = 0;
          if (hasTokenTransfer) {
            // Sum token transfer amounts (you'd need to fetch prices)
            amountUsd = tokenTransfers.reduce((sum, t) => sum + (t.tokenAmount || 0), 0);
          }
          if (hasNativeTransfer) {
            // SOL price ~$160 (you'd want to fetch this dynamically)
            const solAmount = nativeTransfers.reduce((sum, t) => sum + t.amount, 0) / 1e9;
            amountUsd += solAmount * 160;
          }

          // Determine if it's a large trade (>$10,000)
          const isLargeTrade = amountUsd > 10000;
          const notificationType = isLargeTrade ? 'large_trade' : hasTokenTransfer ? 'token_swap' : 'transaction';

          // Get token address if available
          const tokenAddress = tokenTransfers[0]?.mint || undefined;

          // Create notification
          const notificationRef = db.collection('notifications').doc();
          await notificationRef.set({
            userId,
            walletAddress,
            type: notificationType,
            title: isLargeTrade 
              ? `Large Trade Detected`
              : hasTokenTransfer
              ? `Token Swap Detected`
              : `Transaction Detected`,
            message: watchedWallet?.nickname
              ? `${watchedWallet.nickname} made a ${isLargeTrade ? 'large trade' : hasTokenTransfer ? 'token swap' : 'transaction'}`
              : `Watched wallet ${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)} made a ${isLargeTrade ? 'large trade' : hasTokenTransfer ? 'token swap' : 'transaction'}`,
            txHash: tx.signature,
            tokenAddress,
            amount: hasTokenTransfer ? tokenTransfers[0]?.tokenAmount : nativeTransfers[0]?.amount,
            amountUsd,
            read: false,
            createdAt: new Date(),
          });

          // Update last checked timestamp for the wallet
          const updatedWatchlist = watchlist.map((w: any) => 
            w.address === walletAddress
              ? { ...w, lastCheckedAt: new Date(), lastTransactionHash: tx.signature }
              : w
          );

          await userDoc.ref.update({
            watchlist: updatedWatchlist,
            updatedAt: new Date(),
          });
        }
      }
    }

    return res.status(200).json({ success: true, processed: transactions.length });
  } catch (error: any) {
    console.error('Webhook processing error:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
}
