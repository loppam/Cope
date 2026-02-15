/**
 * Server-side decryption for wallet credentials.
 * Used by relay and cron (evm-balance).
 */
async function deriveKey(
  password: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new Uint8Array(salt),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function decrypt(
  encryptedData: string,
  password: string,
): Promise<string> {
  const combined = new Uint8Array(Buffer.from(encryptedData, "base64"));
  const salt = combined.slice(0, 16);
  const iv = combined.slice(16, 28);
  const encrypted = combined.slice(28);
  const key = await deriveKey(password, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    encrypted,
  );
  return new TextDecoder().decode(decrypted);
}

export async function decryptWalletCredentials(
  userId: string,
  encryptedMnemonic: string | undefined,
  encryptedSecretKey: string,
  encryptionSecret: string,
): Promise<{ mnemonic?: string; secretKey: Uint8Array }> {
  const key = `${userId}:${encryptionSecret}`;
  const secretKeyStr = await decrypt(encryptedSecretKey, key);
  const secretKey = new Uint8Array(JSON.parse(secretKeyStr) as number[]);
  let mnemonic: string | undefined;
  if (encryptedMnemonic) mnemonic = await decrypt(encryptedMnemonic, key);
  return { mnemonic, secretKey };
}
