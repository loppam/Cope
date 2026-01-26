// Browser-compatible encryption using Web Crypto API
// Uses AES-GCM for encryption and PBKDF2 for key derivation

/**
 * Derive an encryption key from a password using PBKDF2
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits', 'deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt text using AES-GCM
 * Returns base64 encoded string: salt + iv + encrypted data
 */
export async function encrypt(text: string, password: string): Promise<string> {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);

    // Generate random salt and IV
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Derive key from password
    const key = await deriveKey(password, salt);

    // Encrypt data
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      data
    );

    // Combine salt + iv + encrypted data
    const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(encrypted), salt.length + iv.length);

    // Convert to base64
    const binary = Array.from(combined, (byte) => String.fromCharCode(byte)).join('');
    return btoa(binary);
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypt data encrypted with encrypt()
 */
export async function decrypt(encryptedData: string, password: string): Promise<string> {
  try {
    // Decode from base64
    const binary = atob(encryptedData);
    const combined = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      combined[i] = binary.charCodeAt(i);
    }

    // Extract salt, IV, and encrypted data
    const salt = combined.slice(0, 16);
    const iv = combined.slice(16, 28);
    const encrypted = combined.slice(28);

    // Derive key from password
    const key = await deriveKey(password, salt);

    // Decrypt data
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      encrypted
    );

    const decoder = new TextDecoder();
    return decoder.decode(decrypted);
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Failed to decrypt data');
  }
}

/**
 * Generate an encryption key for a user
 * Combines user ID with a secret from environment variables
 * 
 * NOTE: In production, this secret should be stored server-side
 * and the encryption/decryption should happen on the server
 */
export function generateEncryptionKey(userId: string): string {
  const secret = import.meta.env.VITE_ENCRYPTION_SECRET;
  
  if (!secret || secret === 'your-strong-random-secret-here-change-in-production') {
    console.warn('VITE_ENCRYPTION_SECRET is not set or using default value. This is insecure for production!');
  }

  // Combine user ID with secret for user-specific encryption
  return `${userId}:${secret || 'default-secret-change-in-production'}`;
}

/**
 * Decrypt wallet credentials for use in serverless functions
 * This should be called server-side with the encryption secret
 * 
 * @param userId - The user's Firebase UID
 * @param encryptedMnemonic - Encrypted mnemonic phrase (optional)
 * @param encryptedSecretKey - Encrypted secret key (required)
 * @param encryptionSecret - The encryption secret (should come from server-side env)
 * 
 * @returns Decrypted wallet credentials: { mnemonic?: string, secretKey: Uint8Array }
 */
export async function decryptWalletCredentials(
  userId: string,
  encryptedMnemonic: string | undefined,
  encryptedSecretKey: string,
  encryptionSecret: string
): Promise<{ mnemonic?: string; secretKey: Uint8Array }> {
  try {
    // Generate the same encryption key used during encryption
    const encryptionKey = `${userId}:${encryptionSecret}`;

    // Decrypt secret key (always required)
    const decryptedSecretKeyStr = await decrypt(encryptedSecretKey, encryptionKey);
    const secretKey = new Uint8Array(JSON.parse(decryptedSecretKeyStr));

    // Decrypt mnemonic if available
    let mnemonic: string | undefined;
    if (encryptedMnemonic) {
      mnemonic = await decrypt(encryptedMnemonic, encryptionKey);
    }

    return { mnemonic, secretKey };
  } catch (error) {
    console.error('Error decrypting wallet credentials:', error);
    throw new Error('Failed to decrypt wallet credentials');
  }
}
