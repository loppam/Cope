// Solana wallet utilities
import { Keypair } from '@solana/web3.js';
import { mnemonicToSeedSync, generateMnemonic, validateMnemonic } from 'bip39';
import bs58 from 'bs58';

/**
 * Generate a new Solana wallet from mnemonic.
 * The same mnemonic is stored encrypted and used server-side to derive the EVM wallet (BIP44 m/44'/60'/0'/0/0).
 * Private keys and recovery phrase are never shown to the user.
 * @returns {Object} { publicKey, secretKey, mnemonic }
 */
export function generateWallet() {
  try {
    // Generate a mnemonic phrase (12 words)
    const mnemonic = generateMnemonic();
    
    // Derive keypair from mnemonic so they're linked
    const seed = mnemonicToSeedSync(mnemonic);
    
    // Convert Buffer to Uint8Array for browser compatibility
    // Handle both Buffer and Uint8Array types
    let seedArray: Uint8Array;
    if (seed instanceof Uint8Array) {
      seedArray = seed;
    } else if (seed && typeof (seed as any).length === 'number') {
      // If it's a Buffer-like object, convert it
      seedArray = new Uint8Array(seed as any);
    } else {
      throw new Error('Invalid seed format');
    }
    
    const privateKey = seedArray.slice(0, 32);
    
    // Create keypair from seed
    const keypair = Keypair.fromSeed(privateKey);
    
    return {
      publicKey: keypair.publicKey.toBase58(),
      secretKey: Array.from(keypair.secretKey),
      mnemonic: mnemonic,
    };
  } catch (error) {
    console.error('Error generating wallet:', error);
    throw new Error('Failed to generate wallet');
  }
}

/**
 * Import wallet from private key (base58 string or array)
 * @param {string|number[]} privateKey - Private key in base58 string or byte array
 * @returns {Object} { publicKey, secretKey }
 */
export function importWalletFromPrivateKey(privateKey: string | number[]): { publicKey: string; secretKey: number[] } {
  try {
    let secretKey: Uint8Array;
    
    if (typeof privateKey === 'string') {
      const trimmed = privateKey.trim();
      
      // Try base58 first (most common format for Solana private keys from wallets like Phantom)
      try {
        const decoded = bs58.decode(trimmed);
        // Base58 decoded key should be 64 bytes (32 private + 32 public) or 32 bytes (seed)
        if (decoded.length === 64) {
          secretKey = decoded;
        } else if (decoded.length === 32) {
          // If it's 32 bytes, we need to create a keypair from seed
          const keypair = Keypair.fromSeed(decoded);
          secretKey = keypair.secretKey;
        } else {
          throw new Error(`Invalid base58 key length: ${decoded.length} bytes (expected 32 or 64)`);
        }
      } catch (base58Error: any) {
        // If base58 fails, try JSON array string (format: [1,2,3,...])
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            const arrayKey = new Uint8Array(parsed);
            if (arrayKey.length === 64) {
              secretKey = arrayKey;
            } else if (arrayKey.length === 32) {
              const keypair = Keypair.fromSeed(arrayKey);
              secretKey = keypair.secretKey;
            } else {
              throw new Error(`Invalid JSON array length: ${arrayKey.length} bytes (expected 32 or 64)`);
            }
          } else {
            throw new Error('JSON is not an array');
          }
        } catch (jsonError: any) {
          // If JSON fails, try base64
          try {
            const binaryString = atob(trimmed);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            if (bytes.length === 64) {
              secretKey = bytes;
            } else if (bytes.length === 32) {
              const keypair = Keypair.fromSeed(bytes);
              secretKey = keypair.secretKey;
            } else {
              throw new Error(`Invalid base64 key length: ${bytes.length} bytes (expected 32 or 64)`);
            }
          } catch (base64Error: any) {
            // Provide helpful error message
            const errorMsg = `Invalid private key format. Tried:
- Base58: ${base58Error?.message || 'failed'}
- JSON array: ${jsonError?.message || 'failed'}
- Base64: ${base64Error?.message || 'failed'}

Please provide your private key in one of these formats:
1. Base58 string (from Phantom/Solflare wallets)
2. JSON array: [1,2,3,...] (64 numbers)
3. Base64 string`;
            throw new Error(errorMsg);
          }
        }
      }
    } else {
      // Array of numbers
      const arrayKey = new Uint8Array(privateKey);
      if (arrayKey.length === 64) {
        secretKey = arrayKey;
      } else if (arrayKey.length === 32) {
        const keypair = Keypair.fromSeed(arrayKey);
        secretKey = keypair.secretKey;
      } else {
        throw new Error(`Invalid array length: ${arrayKey.length} bytes (expected 32 or 64)`);
      }
    }
    
    // Validate length - Solana secret keys are 64 bytes
    if (secretKey.length === 64) {
      // Perfect - 64 byte secret key
      const keypair = Keypair.fromSecretKey(secretKey);
      return {
        publicKey: keypair.publicKey.toBase58(),
        secretKey: Array.from(keypair.secretKey),
      };
    } else if (secretKey.length === 32) {
      // 32 bytes - treat as seed and derive keypair
      const keypair = Keypair.fromSeed(secretKey);
      return {
        publicKey: keypair.publicKey.toBase58(),
        secretKey: Array.from(keypair.secretKey),
      };
    } else {
      throw new Error(`Invalid private key length. Expected 32 or 64 bytes, got ${secretKey.length}`);
    }
  } catch (error: any) {
    console.error('Error importing wallet from private key:', error);
    throw new Error(error.message || 'Failed to import wallet. Please check your private key format.');
  }
}

/**
 * Import wallet from mnemonic phrase
 * @param {string} mnemonic - 12 or 24 word mnemonic phrase
 * @returns {Object} { publicKey, secretKey }
 */
export function importWalletFromMnemonic(mnemonic: string): { publicKey: string; secretKey: number[] } {
  try {
    // Validate mnemonic
    if (!validateMnemonic(mnemonic)) {
      throw new Error('Invalid mnemonic phrase');
    }
    
    // Derive seed from mnemonic
    const seed = mnemonicToSeedSync(mnemonic);
    
    // Use first 32 bytes of seed as private key
    // Note: In production, you should use proper HD wallet derivation (BIP44)
    // Convert Buffer to Uint8Array for browser compatibility
    // Handle both Buffer and Uint8Array types
    let seedArray: Uint8Array;
    if (seed instanceof Uint8Array) {
      seedArray = seed;
    } else if (seed && typeof (seed as any).length === 'number') {
      // If it's a Buffer-like object, convert it
      seedArray = new Uint8Array(seed as any);
    } else {
      throw new Error('Invalid seed format');
    }
    
    const privateKey = seedArray.slice(0, 32);
    
    // For Solana, we need 64 bytes (32 private + 32 public)
    // We'll use the seed to derive a proper keypair
    // This is a simplified approach - in production use @solana/web3.js with proper derivation
    const keypair = Keypair.fromSeed(privateKey);
    
    return {
      publicKey: keypair.publicKey.toBase58(),
      secretKey: Array.from(keypair.secretKey),
    };
  } catch (error) {
    console.error('Error importing wallet from mnemonic:', error);
    throw new Error('Failed to import wallet. Please check your mnemonic phrase.');
  }
}

/**
 * Detect if input is a mnemonic phrase or private key
 * @param {string} input - User input
 * @returns {'mnemonic' | 'privateKey' | 'unknown'}
 */
export function detectInputType(input: string): 'mnemonic' | 'privateKey' | 'unknown' {
  const trimmed = input.trim();
  
  // Check if it's a mnemonic (12 or 24 words)
  const words = trimmed.split(/\s+/);
  if (words.length === 12 || words.length === 24) {
    // Check if all words are valid (basic check)
    if (words.every(word => /^[a-z]+$/.test(word.toLowerCase()))) {
      return 'mnemonic';
    }
  }
  
  // Check if it looks like a private key (base58 string or JSON array)
  if (trimmed.length > 40) {
    return 'privateKey';
  }
  
  return 'unknown';
}

/**
 * Format secret key for storage (encrypted in production)
 * @param {number[]} secretKey - Secret key as array
 * @returns {string} Formatted string (base64 encoded)
 */
export function formatSecretKeyForStorage(secretKey: number[]): string {
  // In production, this should be encrypted before storing
  // For now, we'll base64 encode it using browser's btoa
  const uint8Array = new Uint8Array(secretKey);
  // Convert Uint8Array to binary string for btoa
  let binary = '';
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i]);
  }
  return btoa(binary);
}

/**
 * Parse secret key from storage format
 * @param {string} storedKey - Stored secret key
 * @returns {number[]} Secret key as array
 */
export function parseSecretKeyFromStorage(storedKey: string): number[] {
  try {
    // Use browser's atob for base64 decoding
    const binaryString = atob(storedKey);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return Array.from(bytes);
  } catch (error) {
    throw new Error('Failed to parse stored secret key');
  }
}
