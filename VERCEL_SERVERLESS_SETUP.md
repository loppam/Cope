# Vercel Serverless Functions Setup for Wallet Operations

This document explains how to set up Vercel serverless functions to securely handle Solana wallet operations.

## Overview

For security reasons, wallet private keys should never be stored in the frontend or sent to the client. Instead, we'll use Vercel serverless functions to:

1. Store encrypted private keys securely
2. Sign transactions on the server
3. Execute trades and other wallet operations

## Project Structure

```
/
├── api/
│   ├── wallet/
│   │   ├── sign-transaction.ts
│   │   ├── get-balance.ts
│   │   └── send-transaction.ts
│   └── ...
└── ...
```

## Environment Variables

Add these to your Vercel project settings:

```env
# Encryption key for wallet secrets (generate a secure random string)
WALLET_ENCRYPTION_KEY=your-encryption-key-here

# Solana RPC endpoint
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Firebase Admin SDK (for accessing Firestore)
FIREBASE_ADMIN_PROJECT_ID=your-project-id
FIREBASE_ADMIN_CLIENT_EMAIL=your-client-email
FIREBASE_ADMIN_PRIVATE_KEY_ID=your-private-key-id
FIREBASE_ADMIN_PRIVATE_KEY=your-private-key
```

## Example Serverless Function

### `api/wallet/get-balance.ts`

```typescript
import { Connection, PublicKey } from '@solana/web3.js';
import { adminDb } from '@/lib/firebase-admin';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID required' });
    }

    // Get user's wallet address from Firestore
    const userDoc = await adminDb.collection('users').doc(userId).get();
    const userData = userDoc.data();
    
    if (!userData?.walletAddress) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

    // Get balance from Solana
    const connection = new Connection(process.env.SOLANA_RPC_URL!);
    const publicKey = new PublicKey(userData.walletAddress);
    const balance = await connection.getBalance(publicKey);
    
    // Convert lamports to SOL
    const solBalance = balance / 1e9;

    // Update balance in Firestore
    await adminDb.collection('users').doc(userId).update({
      balance: solBalance,
      updatedAt: new Date(),
    });

    return res.status(200).json({ balance: solBalance });
  } catch (error: any) {
    console.error('Error getting balance:', error);
    return res.status(500).json({ error: error.message });
  }
}
```

### `api/wallet/sign-transaction.ts`

```typescript
import { Connection, Keypair, Transaction, PublicKey } from '@solana/web3.js';
import { decrypt } from '@/lib/encryption';
import { adminDb } from '@/lib/firebase-admin';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, transactionData } = req.body;
    
    if (!userId || !transactionData) {
      return res.status(400).json({ error: 'User ID and transaction data required' });
    }

    // Get user's encrypted secret key from Firestore
    const userDoc = await adminDb.collection('users').doc(userId).get();
    const userData = userDoc.data();
    
    if (!userData?.encryptedSecretKey) {
      return res.status(404).json({ error: 'Wallet secret not found' });
    }

    // Decrypt the secret key
    const secretKey = decrypt(userData.encryptedSecretKey, process.env.WALLET_ENCRYPTION_KEY!);
    const keypair = Keypair.fromSecretKey(new Uint8Array(JSON.parse(secretKey)));

    // Build and sign transaction
    const connection = new Connection(process.env.SOLANA_RPC_URL!);
    const transaction = Transaction.from(Buffer.from(transactionData, 'base64'));
    
    // Sign the transaction
    transaction.sign(keypair);

    // Serialize the signed transaction
    const serialized = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    return res.status(200).json({ 
      signedTransaction: serialized.toString('base64') 
    });
  } catch (error: any) {
    console.error('Error signing transaction:', error);
    return res.status(500).json({ error: error.message });
  }
}
```

## Storing Encrypted Private Keys

When a wallet is generated or imported, encrypt the secret key before storing:

```typescript
// In your wallet setup flow
import { encrypt } from '@/lib/encryption';

const encryptedSecretKey = encrypt(
  JSON.stringify(wallet.secretKey),
  process.env.WALLET_ENCRYPTION_KEY!
);

// Store in Firestore (users collection)
await updateDoc(doc(db, 'users', userId), {
  walletAddress: wallet.publicKey,
  encryptedSecretKey: encryptedSecretKey, // Encrypted!
  walletConnected: true,
});
```

## Encryption Utility

Create `lib/encryption.ts`:

```typescript
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const TAG_POSITION = SALT_LENGTH + IV_LENGTH;
const ENCRYPTED_POSITION = TAG_POSITION + TAG_LENGTH;

export function encrypt(text: string, masterKey: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const salt = crypto.randomBytes(SALT_LENGTH);
  
  const key = crypto.pbkdf2Sync(masterKey, salt, 100000, 32, 'sha512');
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final(),
  ]);
  
  const tag = cipher.getAuthTag();
  
  return Buffer.concat([salt, iv, tag, encrypted]).toString('base64');
}

export function decrypt(encryptedData: string, masterKey: string): string {
  const data = Buffer.from(encryptedData, 'base64');
  
  const salt = data.slice(0, SALT_LENGTH);
  const iv = data.slice(SALT_LENGTH, TAG_POSITION);
  const tag = data.slice(TAG_POSITION, ENCRYPTED_POSITION);
  const encrypted = data.slice(ENCRYPTED_POSITION);
  
  const key = crypto.pbkdf2Sync(masterKey, salt, 100000, 32, 'sha512');
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  
  return decipher.update(encrypted) + decipher.final('utf8');
}
```

## Security Best Practices

1. **Never store unencrypted private keys** in Firestore or any client-accessible storage
2. **Use environment variables** for encryption keys - never commit them to git
3. **Implement rate limiting** on serverless functions to prevent abuse
4. **Add authentication** - verify the user owns the wallet before signing transactions
5. **Use HTTPS only** - all API calls must be over HTTPS
6. **Log all operations** - but never log private keys or secrets
7. **Implement transaction validation** - verify transaction details before signing

## Frontend Integration

```typescript
// Example: Get wallet balance
const response = await fetch('/api/wallet/get-balance', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userId: user.uid }),
});

const { balance } = await response.json();
```

## Next Steps

1. Set up Vercel project and configure environment variables
2. Create the encryption utility (`lib/encryption.ts`)
3. Create serverless functions in `/api/wallet/`
4. Update wallet setup flow to encrypt and store secret keys
5. Implement transaction signing and sending functions
6. Add authentication middleware to verify user ownership

## Notes

- Private keys are only decrypted on the server when needed for signing
- The frontend never has access to private keys
- All wallet operations go through serverless functions
- Consider using a hardware security module (HSM) for production
