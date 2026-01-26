# Helius Webhook Setup for Real-Time Transaction Notifications

## Overview

This setup uses Helius webhooks to receive real-time notifications when watched wallets make transactions. No cron jobs needed - notifications arrive instantly!

## Prerequisites

1. Helius API key (already in `.env` as `VITE_HELIUS_API_KEY`)
2. Vercel deployment (for serverless functions)
3. Firebase Admin SDK credentials

## Setup Steps

### 1. Environment Variables

Add these to your `.env` file (and Vercel environment variables):

```bash
# Helius
HELIUS_API_KEY=your_helius_api_key
HELIUS_WEBHOOK_ID=  # Will be set after first webhook creation

# Webhook Configuration
WEBHOOK_URL=https://your-domain.vercel.app/api/webhook/transaction
WEBHOOK_SYNC_SECRET=your_random_secret_here  # For securing webhook sync endpoint
HELIUS_WEBHOOK_SECRET=your_random_secret_here  # Optional: for verifying Helius webhooks

# Firebase Admin (for serverless functions)
FIREBASE_SERVICE_ACCOUNT={"project_id":"...","client_email":"...","private_key":"..."}
```

### 2. Deploy to Vercel

1. Push your code to GitHub
2. Connect your repo to Vercel
3. Vercel will automatically detect the `api/` folder and deploy serverless functions

### 3. Create Initial Webhook

After deployment, call the sync endpoint to create the webhook:

```bash
curl -X POST https://your-domain.vercel.app/api/webhook/sync \
  -H "Authorization: Bearer your_webhook_sync_secret" \
  -H "Content-Type: application/json"
```

This will:
- Collect all watched wallets from all users
- Create a Helius webhook monitoring those addresses
- Return the `webhookID` - save this to `HELIUS_WEBHOOK_ID` in Vercel environment variables

### 4. How It Works

1. **User adds wallet to watchlist** → Frontend calls `addWalletToWatchlist()`
2. **Background sync** → Frontend calls `/api/webhook/sync` to update Helius webhook
3. **Wallet makes transaction** → Helius sends webhook to `/api/webhook/transaction`
4. **Serverless function processes** → Creates notifications in Firestore
5. **User sees notification** → Alerts page displays new notifications

## API Endpoints

### `/api/webhook/transaction` (POST)
- **Purpose**: Receives webhook notifications from Helius
- **Auth**: Optional `X-Helius-Webhook-Secret` header
- **Payload**: Helius enhanced webhook format

### `/api/webhook/sync` (POST)
- **Purpose**: Syncs all watched wallets to Helius webhook
- **Auth**: `Authorization: Bearer {WEBHOOK_SYNC_SECRET}`
- **When to call**: After adding/removing wallets (automatic from frontend)

## Webhook Payload Structure

Helius sends enhanced webhooks with this structure:

```json
{
  "accountData": [...],
  "description": "...",
  "fee": 5000,
  "feePayer": "wallet_address",
  "nativeTransfers": [...],
  "signature": "tx_signature",
  "tokenTransfers": [...],
  "timestamp": 1234567890,
  "type": "TRANSFER",
  "webhookId": "webhook_id"
}
```

## Notification Types

- **`transaction`**: General transaction
- **`token_swap`**: Token swap detected
- **`large_trade`**: Transaction > $10,000 USD

## Cost Considerations

- Creating/updating webhook: 100 credits per request
- Each webhook notification: 1 credit
- You're charged even if your endpoint fails

## Troubleshooting

### Webhook not receiving notifications

1. Check Helius dashboard → Webhooks → Verify webhook is active
2. Check Vercel function logs for errors
3. Verify `WEBHOOK_URL` matches your deployed URL
4. Ensure wallet addresses are correctly formatted (base58)

### Notifications not appearing

1. Check Firestore `notifications` collection
2. Verify user has wallet in watchlist
3. Check Vercel function logs for processing errors

### Webhook sync failing

1. Verify `WEBHOOK_SYNC_SECRET` matches in frontend and backend
2. Check Helius API key is valid
3. Verify webhook URL is accessible (not localhost)

## Alternative: Solscan Webhooks

If you prefer Solscan, they also offer webhook services. However, Helius is more feature-rich and widely used in the Solana ecosystem.

## Next Steps

1. ✅ Deploy to Vercel
2. ✅ Set environment variables
3. ✅ Create initial webhook
4. ⏳ Test with a wallet transaction
5. ⏳ Monitor Vercel logs for any issues
