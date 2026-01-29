# Webhook environment variables – how to get them

Set these in **Vercel** → your project → **Settings** → **Environment Variables** (and optionally in local `.env` for testing). Use **Production** (and Preview if you want webhooks in preview deploys).

---

## Required for webhooks to work

### HELIUS_API_KEY

- **What:** Your Helius API key (server-side; not exposed to the client).
- **How to get:**
  1. Go to [https://www.helius.dev/](https://www.helius.dev/)
  2. Sign in → **Dashboard** → **API Keys**
  3. Create or copy an API key
- **Vercel:** Add `HELIUS_API_KEY` with that value. You can use the same key as `VITE_HELIUS_API_KEY`.

---

### WEBHOOK_URL

- **What:** The full URL Helius will POST to when a watched wallet has a transaction.
- **How to get:** Use your deployed app base URL + `/api/webhook/transaction`.
  - Production: `https://www.trycope.com/api/webhook/transaction` (or your real domain)
  - Or Vercel URL: `https://your-project.vercel.app/api/webhook/transaction`
- **Vercel:** Add `WEBHOOK_URL` with that exact URL (must be HTTPS).

---

### HELIUS_WEBHOOK_ID

- **What:** The ID of the single Helius webhook your app updates (so you don’t create a new webhook every sync).
- **How to get:**
  1. Leave it **empty** the first time.
  2. Deploy with `HELIUS_API_KEY` and `WEBHOOK_URL` set.
  3. In the app, add at least one wallet to a user’s watchlist (so `/api/webhook/sync` runs).
  4. Sync will **create** a webhook and the response (or Vercel function logs) will contain `webhookId` (a UUID).
  5. Copy that UUID and set it as `HELIUS_WEBHOOK_ID` in Vercel.
  6. Redeploy or save env so future syncs **update** that webhook instead of creating new ones.

---

### SOLANATRACKER_API_KEY (recommended)

- **What:** Used by the transaction webhook to fetch token/SOL prices for notification amounts.
- **How to get:**
  1. Go to [https://solanatracker.io/](https://solanatracker.io/)
  2. Sign in → **API Keys**
  3. Create or copy an API key
- **Vercel:** Add `SOLANATRACKER_API_KEY` with that value (can be same as `VITE_SOLANATRACKER_API_KEY`). If you only set the Vite one, the server might not see it.

---

## Optional (recommended for production)

### WEBHOOK_SYNC_SECRET and VITE_WEBHOOK_SYNC_SECRET

- **What:** Protects `POST /api/webhook/sync` so only requests with the secret are accepted. The client needs the same value to call sync after add/remove watchlist.
- **How to get:** Generate a random string, e.g.:
  ```bash
  openssl rand -base64 32
  ```
- **Vercel:** Add both:
  - `WEBHOOK_SYNC_SECRET` = that value (server checks it)
  - `VITE_WEBHOOK_SYNC_SECRET` = same value (client sends it in `Authorization: Bearer <secret>`)

If you don’t set these, sync is open to anyone who knows the URL.

---

### HELIUS_WEBHOOK_SECRET

- **What:** When you set this, the transaction handler only accepts webhook POSTs whose `Authorization` header matches this value. Helius sends whatever you put in `authHeader` when creating/updating the webhook.
- **How to get:** Generate a random string, e.g.:
  ```bash
  openssl rand -base64 32
  ```
- **Vercel:** Add `HELIUS_WEBHOOK_SECRET` with that value. When sync creates/updates the webhook, it sends this as `authHeader` to Helius; Helius then echoes it in the `Authorization` header when POSTing to your `WEBHOOK_URL`.

If you don’t set it, any caller that knows your `WEBHOOK_URL` could send fake payloads (optional but recommended for production).

---

## Checklist

| Variable                   | Where to get it                            | Set in Vercel |
| -------------------------- | ------------------------------------------ | ------------- |
| `HELIUS_API_KEY`           | Helius dashboard → API Keys                | ✅            |
| `WEBHOOK_URL`              | Your base URL + `/api/webhook/transaction` | ✅            |
| `HELIUS_WEBHOOK_ID`        | After first sync (response/logs)           | ✅            |
| `SOLANATRACKER_API_KEY`    | solanatracker.io → API Keys                | ✅            |
| `WEBHOOK_SYNC_SECRET`      | `openssl rand -base64 32`                  | Optional      |
| `VITE_WEBHOOK_SYNC_SECRET` | Same as above                              | Optional      |
| `HELIUS_WEBHOOK_SECRET`    | `openssl rand -base64 32`                  | Optional      |

After changing env vars in Vercel, trigger a new deployment so the functions pick them up.
