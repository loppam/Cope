/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FIREBASE_API_KEY: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN: string;
  readonly VITE_FIREBASE_PROJECT_ID: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID: string;
  readonly VITE_FIREBASE_APP_ID: string;
  readonly VITE_FIREBASE_MEASUREMENT_ID?: string;
  readonly VITE_FIREBASE_VAPID_KEY: string;
  readonly VITE_USE_FIREBASE_EMULATOR?: string;
  /** Server-side only now (JUPITER_API_KEY); client uses /api/jupiter proxy */
  readonly VITE_JUPITER_API_KEY?: string;
  readonly VITE_JUPITER_REFERRAL_ACCOUNT?: string;
  readonly VITE_JUPITER_REFERRAL_FEE_BPS?: string;
  /** Deprecated; app uses Birdeye for wallet/PnL/scanner */
  readonly VITE_SOLANATRACKER_API_KEY?: string;
  readonly VITE_SOLANATRACKER_RPC_API_KEY?: string;
  /** Server-side only now; client uses /api/birdeye proxy */
  readonly VITE_BIRDEYE_API_KEY?: string;
  readonly VITE_HELIUS_API_KEY?: string;
  readonly VITE_SOLANA_RPC_URL?: string;
  /** Optional; when unset, client uses relative /api/* or window.location.origin */
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_ENCRYPTION_SECRET: string;
  readonly VITE_WEBHOOK_SYNC_URL?: string;
  readonly VITE_WEBHOOK_SYNC_SECRET?: string;
}
