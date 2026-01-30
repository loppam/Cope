# Jupiter Integration - Implementation Complete

## Overview

The Jupiter Full Integration has been successfully implemented. This includes:

1. **Phase 1: Data APIs** - Token search, token info, and SOL price now use Jupiter APIs
2. **Phase 2: Swap Integration** - Real buy/sell functionality with 1% referral fees

## What Was Implemented

### Phase 1: Data APIs Migration ✅

- **Created `src/lib/jupiter.ts`** - Jupiter Data API client with adapters
- **Updated `src/lib/solanatracker.ts`** - Re-exports Jupiter functions for backward compatibility
- **Updated `src/vite-env.d.ts`** - Added TypeScript definitions for Jupiter env vars
- **Updated `.env.example`** - Added Jupiter API key configuration

**Benefits:**

- Free API calls (60 requests/minute on free tier)
- No changes needed in existing components (TokenSearch, Trade page work as-is)
- SolanaTracker still used for wallet positions and PnL data

### Phase 2: Swap Integration ✅

- **Created `src/lib/jupiter-swap.ts`** - Swap quote and execution logic
- **Updated `src/pages/Trade.tsx`** - Added:
  - Buy button with swap functionality
  - Slippage settings (0.5%, 1%, 2%, custom)
  - Quote preview modal with transaction details
  - Loading states and error handling
- **Updated `.env.example`** - Added referral account configuration

**Features:**

- Get real-time swap quotes
- Show price impact, fees, and slippage
- Decrypt user wallet securely (client-side only)
- Sign and execute transactions via Jupiter
- Success/error notifications with Solscan links

## Setup Required

### 1. Get Jupiter API Key (Required)

1. Visit https://portal.jup.ag
2. Sign up / Log in
3. Create an API key
4. Add to your `.env` file:

```bash
VITE_JUPITER_API_KEY=your_actual_api_key_here
```

### 2. Set Up Referral Program (Optional - For Earning Fees)

If you want to earn 0.8% on all swaps:

1. **Visit https://referral.jup.ag**
2. **Connect your dev wallet** (the wallet that will receive fees)
3. **Create a referral account** under Jupiter Ultra Referral Project
4. **Create referral token accounts** for:
   - SOL (required)
   - USDC (recommended)
   - USDT, JupSOL, mSOL (optional)
5. **Copy your referral account public key**
6. **Add to `.env`:**

```bash
VITE_JUPITER_REFERRAL_ACCOUNT=your_referral_account_pubkey
VITE_JUPITER_REFERRAL_FEE_BPS=100  # 1% fee (you get 0.8%, Jupiter gets 0.2%)
```

**Note:** If you skip this step, swaps will still work but without platform fees.

## Fee Structure

With 1% referral fee (100 basis points):

- **User pays:** Jupiter base fee (5-10 bps) + 100 bps = ~110 bps total (~1.1%)
- **You receive:** 80 bps (0.8%)
- **Jupiter takes:** 20 bps (0.2%)

Fees are collected in the `feeMint` (usually SOL or USDC based on Jupiter's priority).

## Testing

### Test Phase 1 (Data APIs)

1. Add `VITE_JUPITER_API_KEY` to `.env`
2. Start dev server: `npm run dev`
3. Go to Trade page
4. Search for a token (e.g., "BONK")
5. Verify token info displays correctly

### Test Phase 2 (Swaps)

1. Ensure you have a wallet set up in the app
2. Go to Trade page
3. Search for a token
4. Enter a small amount (e.g., 0.01 SOL)
5. Click "Buy"
6. Review the quote modal
7. Click "Confirm Swap"
8. Check transaction on Solscan

**Important:** Start with small amounts (0.01-0.05 SOL) for testing!

## Claiming Fees

After swaps accumulate fees in your referral token accounts, use the included claim script.

1. Install dependencies (includes `@jup-ag/referral-sdk`):

```bash
pnpm install
```

2. Set environment variables (use a local `.env.claim` file—do not commit; it’s in `.gitignore`):

- `JUPITER_REFERRAL_ACCOUNT` – your referral account public key (same as `VITE_JUPITER_REFERRAL_ACCOUNT`)
- `SOLANA_RPC_URL` – RPC endpoint (e.g. `https://api.mainnet-beta.solana.com` or Helius/SolanaTracker RPC)
- `KEYPAIR_PATH` – path to the keypair file that pays for claim txns (e.g. `~/.config/solana/id.json`), or `KEYPAIR_JSON` – JSON array of secret key bytes

3. Run the script:

```bash
node --env-file=.env.claim scripts/claim-jupiter-referral-fees.mjs
# or: pnpm run claim-jupiter-fees  (after exporting the env vars)
```

The script uses `ReferralProvider.claimAllV2()` from `@jup-ag/referral-sdk`, builds claim transactions, signs with your keypair, and sends them. It supports both legacy and versioned transactions.

## Architecture

```
User → Trade Page → Jupiter Data API → Token Info
                 ↓
                 → Jupiter Swap API → Get Quote
                 ↓
                 → Firestore → Encrypted Wallet
                 ↓
                 → Decrypt (client-side)
                 ↓
                 → Sign Transaction
                 ↓
                 → Jupiter Execute → Solana Network
```

## Files Modified

- `src/lib/jupiter.ts` (new)
- `src/lib/jupiter-swap.ts` (new)
- `src/lib/solanatracker.ts` (updated)
- `src/pages/Trade.tsx` (updated)
- `src/vite-env.d.ts` (updated)
- `scripts/claim-jupiter-referral-fees.mjs` (new – claim referral fees)
- `.env.example` (updated)
- `.gitignore` (added `.env.claim`)

## Security Notes

1. **Wallet Decryption** - Only happens client-side, never sent to server
2. **Private Key** - Exists in memory only during signing, immediately cleared
3. **Referral Account** - Only store public key, never private key
4. **API Keys** - Use environment variables, never commit to git
5. **Transaction Verification** - Always show quote before execution

## Migration Benefits

1. **Cost Savings** - Jupiter data APIs are free (vs paid SolanaTracker)
2. **Revenue** - Earn 0.8% on all swaps
3. **Better UX** - Real trading functionality vs placeholder buttons
4. **Single Provider** - Jupiter for both data + swaps (cleaner architecture)

## Troubleshooting

### "Jupiter API key not configured"

- Add `VITE_JUPITER_API_KEY` to `.env`
- Restart dev server

### "Wallet credentials not found"

- User needs to set up wallet in app first
- Check that wallet is properly encrypted in Firestore

### "Failed to get swap quote"

- Check API key is valid
- Check token has liquidity on Jupiter
- Try increasing slippage tolerance

### Swaps work but no fees collected

- Check `VITE_JUPITER_REFERRAL_ACCOUNT` is set
- Verify referral token accounts are created for the fee mint
- Check `feeBps` in quote response matches your setting

## Next Steps

1. Add `VITE_JUPITER_API_KEY` to your `.env` file
2. Test token search and info display
3. (Optional) Set up referral program for fees
4. Test small swaps
5. Monitor referral account balance
6. Claim fees periodically

## Support

- Jupiter Docs: https://dev.jup.ag
- Jupiter Discord: https://discord.gg/jup
- Referral Dashboard: https://referral.jup.ag
- API Status: https://status.jup.ag
