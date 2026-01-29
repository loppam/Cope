# COPE a Wallet – How It Works

## Page flow

1. **CopeWallet** (`/cope/wallet`) – User enters a wallet address or X (Twitter) handle.
2. **Type detection** – Input is treated as:
   - **X Account** if it starts with `@`, or is short and doesn’t look like a base58 wallet (no 32–44 alphanumeric).
   - **Wallet** otherwise (long alphanumeric string).
3. **Two ways to search**
   - **As-you-type (dropdown)** – Only in “X Account” mode, after **≥ 2 characters**. Calls `searchUsersByHandle(query)` every 300ms (debounced). Results show in a dropdown; picking one goes to Wallet Found.
   - **Search button** – Runs `handleSearch()`:
     - **X Account** → `findUserByXHandle(query)`.
     - **Wallet** → `findUserByWalletAddress(query, true)` (public only).
4. **Outcomes**
   - User found (public, has wallet) → navigate to **Wallet Found** with `address` and `userData`.
   - Not found / private → toast “User not found or their wallet is private” (X) or go to **Wallet Not on COPE** (wallet).
   - Error → toast “Failed to search…”.

## Backend (Firestore)

- **Collection:** `users` (one doc per user, id = Firebase Auth `uid`).
- **Search uses:**
  - **By handle:** `xHandle` (prefix range + `orderBy("xHandle")`).
  - **By wallet:** `walletAddress` (equality).
- **Who is “findable”:**
  - **Public:** `isPublic` absent → treated as public; if present, use the boolean (`isUserPublic()` in code).
  - Must have **`walletAddress`** set (not null).

So “no users found” means either no Firestore user docs match the query, or every match is filtered out (no wallet or not public).

## Why you might see “No users found”

1. **No users in Firestore** – No docs in `users`, or none with a wallet.
2. **`xHandle` case** – Prefix search is **case-sensitive**. Handles are stored **lowercase** on save (new logins). If existing docs have mixed case (e.g. `@LopamEth`), a search for `@lopam` won’t match until `xHandle` is updated to lowercase (e.g. re-login or migration).
3. **Missing Firestore index** – The handle search uses a range + `orderBy("xHandle")`. If the composite index doesn’t exist, the query throws; the app catches it and shows “No users found”. Check the browser console for the Firestore error and use the link in it to create the index.
4. **All matches filtered out** – Users have no `walletAddress`, or `isPublic === false`.

## Quick checks

- **Firebase Console → Firestore → `users`:** Do you have docs with `xHandle` (e.g. `@someone`) and `walletAddress` set?
- **Console (F12):** Any red errors when you type in the search box? “The query requires an index” → create the index from the link.
- **Existing handles:** If `xHandle` was saved with capital letters, re-save the profile (e.g. user logs in again; `saveUserProfile` now stores `xHandle` in lowercase) or run a one-time migration to set `xHandle` to lowercase.
