# EVM deposit webhook setup (Base/BNB USDC → Solana USDC)

This doc covers how to set up the **Alchemy webhook** so that when a user's custodial Base or BNB wallet receives USDC, your app automatically bridges it to their Solana wallet. Together with deposit, trading, and withdraw, this gives a full **cross-chain flow**.

---

## 1. Cross-chain flow: Deposit → Trading → Withdraw

| Step | Chain(s) | What happens |
|------|----------|--------------|
| **Deposit** | Base/BNB → Solana | User (or someone) sends USDC to the user's **custodial EVM address** (shown in-app). Alchemy detects the transfer and POSTs to your `/api/webhook/evm-deposit`. Your backend gets a Relay quote and executes the bridge (signing with the user's key). USDC lands in their **Solana wallet**. |
| **Trading** | Solana | All trading uses the **same Solana wallet** (buy/sell SPL tokens, cross-chain buys to EVM if you support it). Balance is the Solana USDC (+ positions) from deposits. |
| **Withdraw** | Solana → Base/BNB | User chooses amount and destination chain. Your app gets a withdraw quote from Relay (Sol USDC → Base/BNB USDC) and executes. User receives USDC on their chosen EVM network. |

So: **deposit** and **withdraw** are cross-chain via Relay; **trading** is on Solana. The webhook is what makes **deposit** automatic when funds hit the custodial EVM address.

---

## 2. API keys and env vars

Put these in your `.env` (and in Vercel → Project → Settings → Environment Variables). Copy from `.env.example` for the exact variable names.

| Purpose | Env var | Where to get it |
|--------|---------|------------------|
| **Authenticate incoming webhook** | `WEBHOOK_EVM_DEPOSIT_SECRET` | You generate this (e.g. `openssl rand -hex 32`). Set the same value when configuring the Alchemy webhook (see below). |
| **Alchemy: create/update webhook & add addresses** | `ALCHEMY_API_KEY` | [Alchemy Dashboard](https://dashboard.alchemy.com/) → your app → API Key. |
| **Alchemy: add addresses to webhooks (PATCH API)** | `ALCHEMY_NOTIFY_AUTH_TOKEN` | **Required for update-webhook-addresses.** Dashboard → **Data** → **Webhooks** → **AUTH TOKEN** (copy). If you get 401, you're likely using the app API Key; use this token and set it in `.env` as `ALCHEMY_NOTIFY_AUTH_TOKEN`. |
| **Alchemy: webhook ID (Base)** | `ALCHEMY_EVM_DEPOSIT_WEBHOOK_ID_BASE` | Set **after** creating the Address Activity webhook for Base (step 4 below). |
| **Alchemy: webhook ID (BSC/BNB)** | `ALCHEMY_EVM_DEPOSIT_WEBHOOK_ID_BNB` | Set **after** creating the Address Activity webhook for BSC (step 4 below). |
| **Relay: bridge & execute** | `RELAY_API_KEY` | [Relay Link](https://docs.relay.link/) – required for deposit quote + execute and for withdraw. |
| **Decrypt user wallets** | `ENCRYPTION_SECRET` | Your existing app secret (must match client). |
| **Server-to-self calls** | `API_BASE_URL` | Optional. Defaults to `https://${VERCEL_URL}` on Vercel. |
| **EVM RPC (optional)** | `BASE_RPC_URL`, `BNB_RPC_URL` | Optional. Defaults to public RPCs. Prefer Alchemy RPC URLs for reliability. |

---

## 3. How to set up the Alchemy webhook

### Step 1: Generate the webhook secret

```bash
openssl rand -hex 32
```

Add it to `.env` as `WEBHOOK_EVM_DEPOSIT_SECRET`. You will use this same value when configuring the webhook URL in Alchemy (see Step 3). Your app rejects requests that don’t send this secret.

### Step 2: Get your Alchemy API key

1. Go to [dashboard.alchemy.com](https://dashboard.alchemy.com).
2. Create or select an app (you can use one app for both RPC and Notify).
3. Open **API Key** and copy it. Set it in `.env` as `ALCHEMY_API_KEY`.

### Step 3: Create two Address Activity webhooks in Alchemy (one per chain)

Alchemy allows **only one chain per webhook**. Create **two** webhooks that both point to the same URL:

**Webhook A – Base**

1. In the Alchemy dashboard, open **Notify** (or **Webhooks**) from the sidebar or app menu.
2. Click **Create webhook** (or **Add webhook**).
3. Choose **Address Activity** (not “Custom” or “GraphQL”).
4. **Network:** Select **Base** only.
5. **Webhook URL:**  
   `https://<your-production-domain>/api/webhook/evm-deposit`  
   Example: `https://yourapp.vercel.app/api/webhook/evm-deposit`  
   Use your real deployment URL.
6. **Addresses:** Leave empty at first, or add test custodial addresses. You will add addresses via the API when users sign up (see Step 5).
7. **Authentication (if Alchemy offers it):** Set the same value as `WEBHOOK_EVM_DEPOSIT_SECRET` (e.g. header `x-webhook-secret` or `Authorization: Bearer <secret>`).
8. Save the webhook and copy its **Webhook ID** (you’ll need it for Step 4).

**Webhook B – BSC (BNB Chain)**

1. Create a **second** webhook the same way.
2. **Network:** Select **BSC** (BNB Chain) only.
3. **Webhook URL:** Same as above: `https://<your-production-domain>/api/webhook/evm-deposit`.
4. **Addresses** and **Authentication:** Same as Webhook A.
5. Save and copy this webhook’s **Webhook ID**.

Both webhooks send to the same endpoint; your handler already identifies the chain from the payload (`chainId` or `chain`).

### Step 4: Save both webhook IDs

- Set **Webhook A’s ID** in `.env` as `ALCHEMY_EVM_DEPOSIT_WEBHOOK_ID_BASE`.
- Set **Webhook B’s ID** in `.env` as `ALCHEMY_EVM_DEPOSIT_WEBHOOK_ID_BNB`.

You need both IDs to add or remove addresses per chain via the Alchemy API.

### Step 5: Adding new users’ addresses (dynamic)

**New users:** The app derives and stores `evmAddress` immediately after generating the Solana wallet (in onboarding `WalletSetup`), and the relay adds it to both webhooks when that happens. No extra step needed for new signups.

**Existing users (one-time backfill):** For users who had a wallet before this flow existed, run `npm run backfill-evm-addresses` (optionally with `--dry-run` first), then `npm run sync-evm-deposit-webhook-addresses` to add their addresses to the webhooks.

When any new custodial EVM address is persisted, add it to **both** webhooks so deposits on Base and on BSC trigger the bridge.

Use Alchemy’s **Update webhook addresses** API **twice** (once per webhook):

- **Endpoint:** `PATCH` to the URL in [Alchemy’s Notify API docs](https://www.alchemy.com/docs/data/webhooks/webhooks-api-endpoints/notify-api-endpoints/update-webhook-addresses).
- **Headers:** `X-Alchemy-Token` must be the **Notify Auth Token** (Dashboard → Data → Webhooks → AUTH TOKEN). Set it as `ALCHEMY_NOTIFY_AUTH_TOKEN` in `.env`. The app API Key often returns 401 for this endpoint.
- **Body:** `webhook_id` (use `ALCHEMY_EVM_DEPOSIT_WEBHOOK_ID_BASE` for the first call, `ALCHEMY_EVM_DEPOSIT_WEBHOOK_ID_BNB` for the second) and `addresses_to_add` (array with the new custodial address). Use `addresses_to_remove` when a user is deleted (again, call once per webhook ID).

Call both updates from your backend whenever you persist a new `evmAddress` (e.g. after writing to Firestore in your `evm-address` or `evm-balances` handler). Limits: typically up to 500 addresses per request and up to 100,000 addresses per webhook; see Alchemy’s current docs.

---

## 4. What your endpoint expects

- **URL:** `https://<your-domain>/api/webhook/evm-deposit`
- **Method:** POST.
- **Headers (recommended):**  
  `x-webhook-secret: <WEBHOOK_EVM_DEPOSIT_SECRET>`  
  or  
  `Authorization: Bearer <WEBHOOK_EVM_DEPOSIT_SECRET>`

The handler accepts two payload shapes.

**Generic (e.g. custom indexer):**
```json
{
  "to": "0x...",
  "value": "1000000",
  "token": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "chainId": 8453
}
```
- `to`: receiver (custodial EVM address).
- `value`: raw USDC amount (6 decimals).
- `token` / `tokenAddress`: USDC contract (validated for Base/BNB).
- `chainId` / `chain`: `8453` or `"base"` for Base; `56` or `"bnb"` / `"bsc"` for BNB.

**Activity array (e.g. Alchemy):**
```json
{
  "activity": [
    {
      "to": "0x...",
      "value": "1000000",
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "chain": "BASE"
    }
  ]
}
```
The first entry in `activity` is used; field names may vary (`to` / `toAddress`, `value` / `rawContract.value`, `asset` / `contract` / `tokenAddress`, `chain` / `network`).

---

## 5. Checklist

- [ ] Set `WEBHOOK_EVM_DEPOSIT_SECRET`, `ALCHEMY_API_KEY`, `RELAY_API_KEY`, `ENCRYPTION_SECRET` in `.env` and Vercel.
- [ ] Create the Address Activity webhook in Alchemy (URL, Base + BSC, optional initial addresses).
- [ ] Set `ALCHEMY_EVM_DEPOSIT_WEBHOOK_ID_BASE` and `ALCHEMY_EVM_DEPOSIT_WEBHOOK_ID_BNB` after creating the two webhooks.
- [ ] (Optional) Set `API_BASE_URL`, `BASE_RPC_URL`, `BNB_RPC_URL` if needed.
- [ ] New users get `evmAddress` at wallet setup (WalletSetup calls relay `evm-address` after saving Solana). Existing users: run `npm run backfill-evm-addresses` then `npm run sync-evm-deposit-webhook-addresses`.
- [ ] When new users get an `evmAddress`, add it to **both** webhooks (Base and BNB) via Alchemy’s update-webhook-addresses API so **deposit → trading → withdraw** works cross-chain for them. (The relay does this when persisting `evmAddress`.)
