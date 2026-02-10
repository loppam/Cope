/**
 * Server-side decrypt for wallet credentials. Matches client encryption (AES-GCM + PBKDF2).
 * Uses Node's globalThis.crypto (Web Crypto API).
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function decrypt(encryptedData: string, password: string): Promise<string> {
  const binary = Buffer.from(encryptedData, "base64");
  const combined = new Uint8Array(binary);
  const salt = combined.slice(0, 16);
  const iv = combined.slice(16, 28);
  const encrypted = combined.slice(28);
  const key = await deriveKey(password, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    encrypted
  );
  return new TextDecoder().decode(decrypted);
}

export async function decryptWalletCredentials(
  userId: string,
  encryptedMnemonic: string | undefined,
  encryptedSecretKey: string,
  encryptionSecret: string
): Promise<{ mnemonic?: string; secretKey: Uint8Array }> {
  const encryptionKey = `${userId}:${encryptionSecret}`;
  const decryptedSecretKeyStr = await decrypt(encryptedSecretKey, encryptionKey);
  const secretKey = new Uint8Array(JSON.parse(decryptedSecretKeyStr) as number[]);
  let mnemonic: string | undefined;
  if (encryptedMnemonic) {
    mnemonic = await decrypt(encryptedMnemonic, encryptionKey);
  }
  return { mnemonic, secretKey };
}
