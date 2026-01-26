// Solana wallet utilities
import { Keypair } from '@solana/web3.js';
import { mnemonicToSeedSync, generateMnemonic, validateMnemonic } from 'bip39';

/**
 * Generate a new Solana wallet from mnemonic
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
      // Try to parse as base64
      try {
        // Use browser's atob for base64 decoding
        const binaryString = atob(privateKey);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        secretKey = bytes;
      } catch {
        // If base64 fails, try as JSON array string
        try {
          const parsed = JSON.parse(privateKey);
          secretKey = new Uint8Array(parsed);
        } catch {
          throw new Error('Invalid private key format');
        }
      }
    } else {
      secretKey = new Uint8Array(privateKey);
    }
    
    if (secretKey.length !== 64) {
      throw new Error('Invalid private key length. Expected 64 bytes');
    }
    
    const keypair = Keypair.fromSecretKey(secretKey);
    
    return {
      publicKey: keypair.publicKey.toBase58(),
      secretKey: Array.from(keypair.secretKey),
    };
  } catch (error) {
    console.error('Error importing wallet from private key:', error);
    throw new Error('Failed to import wallet. Please check your private key.');
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
