# Birdeye API Setup Guide

This guide explains how to set up Birdeye API for the COPE Scanner functionality.

## What is Birdeye?

Birdeye is a comprehensive Solana analytics platform that provides:
- Wallet transaction history
- Token holder data
- Wallet analytics (win rate, trades, etc.)
- Token price data
- Balance change tracking

## Getting Your API Key

1. **Sign up for Birdeye**
   - Visit [https://birdeye.so/](https://birdeye.so/)
   - Click "Sign Up" or "Get Started"
   - Create an account

2. **Get API Access**
   - Navigate to the API section in your dashboard
   - Or visit [Birdeye API Documentation](https://docs.birdeye.so/)
   - Choose a plan that fits your needs:
     - **Starter**: Free tier with limited requests
     - **Standard**: Basic usage
     - **Premium**: Higher rate limits
     - **Business/Enterprise**: For production apps

3. **Copy Your API Key**
   - Once you have access, copy your API key
   - It should look like: `abc123def456...`

## Configuration

1. **Add to Environment Variables**

   Add your Birdeye API key to `.env`:
   ```env
   VITE_BIRDEYE_API_KEY=your_api_key_here
   ```

   Also update `.env.example` (already done):
   ```env
   VITE_BIRDEYE_API_KEY=your_birdeye_api_key_here
   ```

2. **Restart Development Server**

   After adding the API key, restart your dev server:
   ```bash
   npm run dev
   ```

## How It Works

The COPE Scanner uses Birdeye to:

1. **Find Token Holders**
   - For each token mint address you provide, Birdeye returns all wallets that hold/traded that token

2. **Identify Matching Wallets**
   - Wallets that appear in multiple token holder lists are identified as "matching"
   - These are wallets that traded multiple tokens you're scanning for

3. **Calculate Analytics**
   - Win rate: Percentage of profitable trades
   - Trade count: Total number of transactions
   - Confidence: High/Med/Low based on win rate and match count

4. **Rank Results**
   - Wallets are sorted by confidence and win rate
   - Best performers appear first

## API Endpoints Used

The scanner uses these Birdeye endpoints:

- `/defi/token_holders` - Get all wallets that hold a specific token
- `/defi/transaction_list` - Get wallet transaction history
- `/defi/wallet_token_list` - Get all tokens a wallet holds
- `/v2/wallet/balance_change` - Get wallet balance changes over time

## Rate Limits

Birdeye has rate limits based on your plan:

- **Free/Starter**: ~10-50 requests/minute
- **Standard**: ~100 requests/minute
- **Premium+**: Higher limits

The scanner makes multiple API calls per scan, so consider:
- Caching results when possible
- Implementing request throttling
- Using a higher tier plan for production

## Testing

1. **Start the Scanner**
   - Navigate to `/scanner` in your app
   - Add at least 2 token mint addresses
   - Click "Scan Wallets"

2. **Check Console**
   - Open browser DevTools
   - Check for any API errors
   - Verify API key is being used

3. **Verify Results**
   - Results should show real wallet addresses
   - Win rates and trade counts should be calculated from actual data
   - Click on a wallet to see detailed analytics

## Troubleshooting

### "Birdeye API key not configured"
- Make sure `VITE_BIRDEYE_API_KEY` is in your `.env` file
- Restart the dev server after adding the key
- Check that the key doesn't have extra spaces

### "Failed to scan wallets"
- Check your API key is valid
- Verify you have API access in your Birdeye account
- Check rate limits - you might be hitting the limit
- Check browser console for detailed error messages

### "No wallets found"
- Try different token addresses
- Lower the minimum matches/trades requirements
- Some tokens might not have many traders
- Try popular tokens like BONK, WIF, etc.

### Rate Limit Errors
- Upgrade your Birdeye plan
- Implement caching (store results temporarily)
- Add delays between API calls
- Reduce the number of tokens scanned at once

## Production Considerations

1. **API Key Security**
   - Never commit API keys to git
   - Use environment variables
   - Consider using Vercel serverless functions to proxy API calls (hide API key from frontend)

2. **Error Handling**
   - Implement retry logic for failed requests
   - Show user-friendly error messages
   - Log errors for debugging

3. **Performance**
   - Cache results when possible
   - Implement pagination for large result sets
   - Consider background job processing for long scans

4. **Cost Management**
   - Monitor API usage
   - Set up alerts for high usage
   - Optimize queries to reduce API calls

## Example Usage

```typescript
import { scanWalletsForTokens, getWalletAnalytics } from '@/lib/birdeye';

// Scan for wallets
const wallets = await scanWalletsForTokens(
  ['token1...', 'token2...', 'token3...'],
  30, // lookback days
  2,  // min matches
  10  // min trades
);

// Get detailed analytics
const analytics = await getWalletAnalytics('wallet_address...');
```

## Support

- [Birdeye Documentation](https://docs.birdeye.so/)
- [Birdeye API Reference](https://docs.birdeye.so/reference)
- [Birdeye Support](https://birdeye.so/contact)






G1HebpFP5J7HLynzrJfwKurQwsi817hkGL4ogjtUBAGS

73iDnLaQDL84PDDubzTFSa2awyHFQYHbBRU9tfTopump