# Webhooks and Alerts

## Helius webhooks (factual)

Helius webhooks are **real** and documented at:

- **Webhooks API overview:** https://docs.helius.dev/api-reference/webhooks
- **Create webhook:** https://docs.helius.dev/api-reference/webhooks/create-webhook
- **Update webhook:** https://docs.helius.dev/api-reference/webhooks/update-webhook

**Base URL:** `https://api-mainnet.helius-rpc.com/v0/webhooks`  
(Not `api.helius.xyz` — the official docs use `api-mainnet.helius-rpc.com`.)

- **Create:** `POST /v0/webhooks?api-key=YOUR_API_KEY`  
  Body: `webhookURL`, `transactionTypes: ["ANY"]`, `accountAddresses: string[]`, `webhookType: "enhanced"`.
- **Update:** `PUT /v0/webhooks/{webhookID}?api-key=YOUR_API_KEY`  
  Body: same fields (no `webhookID` in body; it goes in the path).

When you use `webhookType: "enhanced"`, Helius sends parsed transaction payloads to your `webhookURL` (e.g. `/api/webhook/transaction`). The payload includes fields such as `signature`, `feePayer`, `nativeTransfers`, `tokenTransfers`, `accountData`, `type`, `webhookId`, etc., which our transaction handler uses.

## Notifications → Alerts page

1. **Creation:** The transaction webhook (`api/webhook/transaction.ts`) writes to Firestore `notifications` with `userId`, so each notification is tied to the user who is watching that wallet.
2. **Delivery:** Push is sent to that user’s devices via FCM/Web Push; the same event is stored as a document in `notifications`.
3. **Viewing:** The **Alerts** page (`src/pages/Alerts.tsx`) subscribes in real time to `notifications` where `userId == user.uid`, so each user only sees their own alerts (buy/sell activity for wallets they watch).
4. **Actions:** From Alerts, users can mark as read, mark all read, and delete; these use `markNotificationAsRead`, `markAllNotificationsAsRead`, and `deleteNotification` in `src/lib/notifications.ts`, which update/delete only their own notification docs.

So notifications are **per-user** and are meant to be viewed and managed on the Alerts page.

## Firestore rules (RLS)

See `firestore.rules` in the project root:

- **users:** Read/write only own doc (`request.auth.uid == userId`).
- **notifications:** Read/update/delete only docs where `resource.data.userId == request.auth.uid`; create is disallowed for clients (only the webhook/Admin SDK creates).
- **users/{uid}/pushTokens:** Read/write only for own user.
- **watchedWallets:** No client access (server-only index).

Deploy rules with: `firebase deploy --only firestore:rules`.

## Composite index for Alerts

The Alerts page queries `notifications` with `where('userId', '==', uid)` and `orderBy('createdAt', 'desc')`. Firestore may require a composite index on `(userId, createdAt)`. If the index is missing, the app falls back to a query without `orderBy` and sorts in memory. To add the index, use the link in the Firestore error in the console or create it in Firebase Console → Firestore → Indexes.
