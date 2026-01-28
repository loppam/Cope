// Vercel Serverless Function: Webhook endpoint for Helius transaction notifications
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getUserTokens, sendToTokens } from '../../src/lib/pushUtils';

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

// Price cache (in-memory, resets on function restart)
const priceCache = new Map<string, { price: number; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch token price from SolanaTracker API
 */
async function getTokenPrice(mint: string): Promise<number> {
  // Check cache first
  const cached = priceCache.get(mint);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.price;
  }

  try {
    const apiKey = process.env.VITE_SOLANATRACKER_API_KEY || process.env.SOLANATRACKER_API_KEY;
    if (!apiKey) {
      console.warn('SolanaTracker API key not configured, using fallback price');
      return 0;
    }

    const response = await fetch(`https://data.solanatracker.io/tokens/${mint}`, {
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.warn(`Failed to fetch token price for ${mint}: ${response.status}`);
      return 0;
    }

    const data = await response.json();
    // Get price from primary pool (highest liquidity)
    const pools = data.pools || [];
    if (pools.length > 0) {
      const primaryPool = pools.reduce((best: any, current: any) => {
        const bestLiquidity = best?.liquidity?.usd || 0;
        const currentLiquidity = current?.liquidity?.usd || 0;
        return currentLiquidity > bestLiquidity ? current : best;
      });
      
      const price = primaryPool?.price?.usd || 0;
      // Cache the price
      priceCache.set(mint, { price, timestamp: Date.now() });
      return price;
    }

    return 0;
  } catch (error) {
    console.error(`Error fetching token price for ${mint}:`, error);
    return 0;
  }
}

/**
 * Fetch SOL price from SolanaTracker API
 */
async function getSolPrice(): Promise<number> {
  // Check cache first
  const cached = priceCache.get('SOL');
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached.price;
  }

  try {
    const apiKey = process.env.VITE_SOLANATRACKER_API_KEY || process.env.SOLANATRACKER_API_KEY;
    if (!apiKey) {
      console.warn('SolanaTracker API key not configured, using fallback SOL price');
      return 150; // Fallback price
    }

    const response = await fetch('https://data.solanatracker.io/price', {
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.warn(`Failed to fetch SOL price: ${response.status}`);
      return 150; // Fallback price
    }

    const data = await response.json();
    const price = data.price || 150;
    
    // Cache the price
    priceCache.set('SOL', { price, timestamp: Date.now() });
    return price;
  } catch (error) {
    console.error('Error fetching SOL price:', error);
    return 150; // Fallback price
  }
}

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

          // Calculate total USD value using dynamic prices
          let amountUsd = 0;
          
          if (hasTokenTransfer) {
            // Fetch prices for all tokens in parallel
            const tokenPricePromises = tokenTransfers.map(async (transfer) => {
              const tokenPrice = await getTokenPrice(transfer.mint);
              // tokenAmount is in raw units, we need to convert to USD
              // For now, we'll use a simplified calculation
              // In production, you'd need to account for token decimals
              return tokenPrice * (transfer.tokenAmount || 0);
            });
            
            const tokenAmounts = await Promise.all(tokenPricePromises);
            amountUsd += tokenAmounts.reduce((sum, amount) => sum + amount, 0);
          }
          
          if (hasNativeTransfer) {
            // Fetch SOL price dynamically
            const solPrice = await getSolPrice();
            const solAmount = nativeTransfers.reduce((sum, t) => sum + t.amount, 0) / 1e9;
            amountUsd += solAmount * solPrice;
          }

          // Determine if it's a large trade (>$10,000)
          const isLargeTrade = amountUsd > 10000;
          const notificationType = isLargeTrade ? 'large_trade' : hasTokenTransfer ? 'token_swap' : 'transaction';

          // Get token address if available
          const tokenAddress = tokenTransfers[0]?.mint || undefined;

          // Create notification
          const notificationRef = db.collection('notifications').doc();
          const notificationData = {
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
          };
          
          await notificationRef.set(notificationData);

          // Push notification
          try {
            const tokens = await getUserTokens(userId);
            const invalidTokens = await sendToTokens(tokens, {
              title: notificationData.title,
              body: notificationData.message,
              deepLink: `/scanner/wallet/${walletAddress}`,
              data: {
                type: notificationData.type,
                txHash: notificationData.txHash || '',
              },
            });
            // Remove invalid tokens
            for (const token of invalidTokens) {
              await db.collection('users').doc(userId).collection('pushTokens').doc(token).delete();
            }
          } catch (pushError) {
            console.error('Error sending push notification:', pushError);
          }

          // Send push notification if user has push enabled
          try {
            const userData = userDoc.data();
            if (userData?.pushEnabled && userData?.pushSubscription) {
              // Send push notification (using Web Push API)
              // Note: This requires VAPID keys to be configured
              // For now, we'll just log - actual push sending would require VAPID setup
              console.log(`Push notification queued for user ${userId}: ${notificationData.title}`);
              
              // In production, you would send the push notification here using web-push library
              // const webpush = require('web-push');
              // await webpush.sendNotification(
              //   userData.pushSubscription,
              //   JSON.stringify({
              //     title: notificationData.title,
              //     body: notificationData.message,
              //     icon: '/icons/icon-192x192.png',
              //     badge: '/icons/icon-96x96.png',
              //     data: {
              //       url: `/app/alerts`,
              //       notificationId: notificationRef.id,
              //     },
              //   })
              // );
            }
          } catch (pushError) {
            // Don't fail the webhook if push fails
            console.error('Error sending push notification:', pushError);
          }

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
