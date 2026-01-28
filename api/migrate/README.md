# Wallet Fields Migration Script

## Purpose

This script fixes existing user documents that have `encryptedSecretKey` but are missing:

- `walletAddress` (null instead of the actual address)
- `walletConnected` (false instead of true)
- `isNew` (true instead of false)

## How It Works

1. Finds all users with `encryptedSecretKey` but `walletAddress` is null
2. Decrypts the secret key using the encryption secret
3. Derives the public key (wallet address) from the secret key
4. Updates the document with all required fields atomically

## Running the Migration

### Prerequisites

1. Deploy the migration script to Vercel
2. Set `MIGRATION_SECRET` environment variable in Vercel (use a secure random string)
3. Ensure `ENCRYPTION_SECRET` is set (should already be configured)

### Execute Migration

```bash
curl -X POST https://www.trycope.com/api/migrate/fix-wallet-fields \
  -H "Authorization: Bearer YOUR_MIGRATION_SECRET" \
  -H "Content-Type: application/json"
```

### Response

```json
{
  "success": true,
  "message": "Migration completed: X users fixed, Y errors",
  "results": {
    "processed": 10,
    "fixed": 8,
    "errors": [
      {
        "uid": "user123",
        "error": "Error message"
      }
    ]
  }
}
```

## Security

- Requires `MIGRATION_SECRET` authorization header
- Only processes users with `encryptedSecretKey` but missing `walletAddress`
- All operations are logged for audit purposes

## Notes

- This is a one-time migration script
- After running, verify the results in Firestore
- The script is idempotent - safe to run multiple times (skips already fixed users)
