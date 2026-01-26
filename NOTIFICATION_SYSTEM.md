# Notification System for Watched Wallets

## Overview

The notification system tracks transactions from wallets that users have "COPE'd" (added to their watchlist) and sends alerts when those wallets make new trades.

## Architecture

### Frontend (Current Implementation)

1. **Watchlist Management** (`src/lib/auth.ts`)
   - `addWalletToWatchlist()` - Add wallet to user's watchlist
   - `removeWalletFromWatchlist()` - Remove wallet from watchlist
   - `getWatchlist()` - Get user's watchlist
   - Watchlist stored in Firestore `users/{userId}.watchlist` array

2. **Notification Management** (`src/lib/notifications.ts`)
   - `createNotification()` - Create a notification (called by backend)
   - `getUserNotifications()` - Fetch user's notifications
   - `markNotificationAsRead()` - Mark notification as read
   - `markAllNotificationsAsRead()` - Mark all as read
   - `deleteNotification()` - Delete a notification
   - Notifications stored in Firestore `notifications` collection

3. **UI Components**
   - `ScannerResults.tsx` - COPE button to add wallets to watchlist
   - `Watchlist.tsx` - Display and manage watched wallets
   - `Alerts.tsx` - Display notifications from watched wallets

### Backend (To Be Implemented)

The backend service needs to:

1. **Monitor Watched Wallets**
   - Poll Birdeye API for new transactions from watched wallets
   - Check for transactions that occurred after the wallet was added to watchlist
   - Use Birdeye's `/defi/v3/token/txs` endpoint with `owner` filter

2. **Create Notifications**
   - When a new transaction is detected, create a notification in Firestore
   - Notification should include:
     - Transaction hash
     - Token address (if applicable)
     - Transaction amount (USD)
     - Transaction type (buy/sell/swap)

3. **Recommended Implementation**

   **Option A: Vercel Serverless Functions (Recommended)**
   - Create a cron job that runs every 1-5 minutes
   - Function: `api/cron/check-watched-wallets.ts`
   - Fetches all users with watchlists
   - For each user, checks their watched wallets for new transactions
   - Creates notifications for new transactions

   **Option B: Firebase Cloud Functions**
   - Similar to Vercel but uses Firebase Cloud Functions
   - Can use Firestore triggers or scheduled functions

   **Option C: External Service**
   - Use a service like Zapier, n8n, or custom Node.js service
   - Polls Birdeye API and creates notifications

## Implementation Steps

### Step 1: Backend Service Setup

Create a Vercel serverless function:

```typescript
// api/cron/check-watched-wallets.ts
import { getWatchlist } from '@/lib/auth'; // You'll need to adapt this for serverless
import { createNotification } from '@/lib/notifications';
import { getTokenTransactions } from '@/lib/birdeye';

export default async function handler(req: Request) {
  // Verify cron secret
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Get all users with watchlists
  const users = await getAllUsersWithWatchlists();
  
  for (const user of users) {
    const watchlist = await getWatchlist(user.uid);
    
    for (const wallet of watchlist) {
      // Get recent transactions for this wallet
      // Compare with last checked timestamp
      // Create notifications for new transactions
    }
  }
  
  return new Response('OK');
}
```

### Step 2: Track Last Checked Timestamp

Add to `WatchedWallet` interface:
```typescript
lastCheckedAt?: any; // Firestore timestamp
lastTransactionHash?: string; // Last transaction hash seen
```

### Step 3: Notification Types

- **transaction**: General transaction detected
- **large_trade**: Transaction above a certain threshold (e.g., $10,000)
- **token_swap**: Specific token swap detected

### Step 4: Rate Limiting

- Birdeye API has rate limits
- Implement delays between wallet checks
- Consider batching requests
- Cache transaction data to avoid duplicate checks

## Firestore Structure

### Users Collection
```
users/{userId}
  - watchlist: [
      {
        address: string,
        addedAt: timestamp,
        matched?: number,
        totalInvested?: number,
        totalRemoved?: number,
        profitMargin?: number,
        lastCheckedAt?: timestamp,
        lastTransactionHash?: string
      }
    ]
```

### Notifications Collection
```
notifications/{notificationId}
  - userId: string
  - walletAddress: string
  - type: 'transaction' | 'large_trade' | 'token_swap'
  - title: string
  - message: string
  - txHash?: string
  - tokenAddress?: string
  - amount?: number
  - amountUsd?: number
  - read: boolean
  - createdAt: timestamp
```

## Next Steps

1. ✅ Frontend watchlist and notification UI complete
2. ⏳ Implement backend service to monitor wallets
3. ⏳ Set up cron job (Vercel or Firebase)
4. ⏳ Add notification preferences (email, push, etc.)
5. ⏳ Add filtering options (only large trades, specific tokens, etc.)
