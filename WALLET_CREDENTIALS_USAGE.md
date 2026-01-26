# Wallet Credentials Storage and Usage

## Storage Location

The encrypted wallet credentials are stored in **Firebase Firestore** in the `users` collection:

- **Collection**: `users`
- **Document ID**: User's Firebase UID
- **Fields**:
  - `encryptedMnemonic` (optional) - Encrypted mnemonic phrase (only if wallet was generated or imported with mnemonic)
  - `encryptedSecretKey` (required) - Encrypted private key/secret key

## How to Retrieve and Use Credentials

### Client-Side (Not Recommended for Production)

For client-side operations, you can retrieve and decrypt credentials:

```typescript
import { getEncryptedWalletCredentials } from '@/lib/auth';
import { decryptWalletCredentials, generateEncryptionKey } from '@/lib/encryption';
import { Keypair } from '@solana/web3.js';

// Get encrypted credentials from Firestore
const encrypted = await getEncryptedWalletCredentials(userId);
if (!encrypted?.encryptedSecretKey) {
  throw new Error('No wallet found');
}

// Generate encryption key (same as used during encryption)
const encryptionKey = generateEncryptionKey(userId);

// Decrypt the secret key
const decryptedSecretKeyStr = await decrypt(encrypted.encryptedSecretKey, encryptionKey);
const secretKey = new Uint8Array(JSON.parse(decryptedSecretKeyStr));

// Create keypair for signing transactions
const keypair = Keypair.fromSecretKey(secretKey);
```

### Server-Side (Recommended for Production)

For serverless functions (Vercel, etc.), use the server-side decryption:

```typescript
// api/sign-transaction.ts (Vercel serverless function)
import { decryptWalletCredentials } from '@/lib/encryption';
import { Keypair, Connection, Transaction } from '@solana/web3.js';
import admin from 'firebase-admin';

// Initialize Firebase Admin (server-side only)
const adminDb = admin.firestore();

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { userId, transactionData } = req.body;
    
    // Verify user authentication (add your auth logic here)
    
    // Get encrypted credentials from Firestore
    const userDoc = await adminDb.collection('users').doc(userId).get();
    const userData = userDoc.data();
    
    if (!userData?.encryptedSecretKey) {
      return res.status(404).json({ error: 'Wallet secret not found' });
    }

    // Decrypt credentials using server-side secret
    const { secretKey } = await decryptWalletCredentials(
      userId,
      userData.encryptedMnemonic,
      userData.encryptedSecretKey,
      process.env.ENCRYPTION_SECRET! // Server-side secret
    );

    // Create keypair
    const keypair = Keypair.fromSecretKey(secretKey);

    // Build and sign transaction
    const connection = new Connection(process.env.SOLANA_RPC_URL!);
    const transaction = Transaction.from(Buffer.from(transactionData, 'base64'));
    transaction.sign(keypair);

    // Serialize and return
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

## Security Notes

1. **Never decrypt credentials client-side in production** - Always use serverless functions
2. **Store encryption secret server-side** - Use environment variables (`ENCRYPTION_SECRET`) in your serverless function
3. **Verify user authentication** - Always verify the user owns the wallet before decrypting
4. **Use HTTPS only** - All API calls must be over HTTPS
5. **Implement rate limiting** - Prevent abuse of your signing endpoints

## Data Structure in Firestore

```json
{
  "users": {
    "user_uid_123": {
      "walletAddress": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
      "encryptedMnemonic": "base64_encrypted_string...",
      "encryptedSecretKey": "base64_encrypted_string...",
      "balance": 0,
      "walletConnected": true,
      "updatedAt": "2026-01-24T..."
    }
  }
}
```

## Available Functions

### `getEncryptedWalletCredentials(uid: string)`
Retrieves encrypted credentials from Firestore.

**Location**: `src/lib/auth.ts`

### `decryptWalletCredentials(userId, encryptedMnemonic, encryptedSecretKey, encryptionSecret)`
Decrypts wallet credentials for use in serverless functions.

**Location**: `src/lib/encryption.ts`

### `decrypt(encryptedData, password)`
Low-level decryption function using Web Crypto API.

**Location**: `src/lib/encryption.ts`
