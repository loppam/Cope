/**
 * Relay API client helpers (client-safe: no API key; quote/execute go through backend).
 * See: https://docs.relay.link/references/api/core
 */

const RELAY_API_BASE = "https://api.relay.link";

/** Chain IDs from Relay. Solana: 792703809 per Relay docs. */
export const RELAY_CHAIN_IDS = {
  base: 8453,
  bnb: 56,
  solana: 792703809,
} as const;

export type RelayNetwork = "base" | "bnb" | "solana";

/** Get chain ID for a network (hardcoded; no API call). */
export function getChainId(network: RelayNetwork): number {
  return RELAY_CHAIN_IDS[network];
}

/**
 * Poll Relay intent status (for deposit/withdraw/swap). Call from client; no API key.
 */
export async function getIntentStatus(requestId: string): Promise<{
  status?: string;
  requestId?: string;
  [key: string]: unknown;
}> {
  const res = await fetch(
    `${RELAY_API_BASE}/intents/status/v3?requestId=${encodeURIComponent(requestId)}`
  );
  if (!res.ok) throw new Error("Failed to fetch Relay status");
  return res.json();
}

/** Chain ID to network name for Relay currencies. */
export const RELAY_CHAIN_ID_TO_NETWORK: Record<number, RelayNetwork> = {
  792703809: "solana",
  8453: "base",
  56: "bnb",
};

export interface RelayCurrency {
  chainId: number;
  chain: string;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;
  verified?: boolean;
}

/** Base58 alphabet; Solana addresses use this. */
const BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]+$/;

/** Heuristic: looks like a Solana mint/account (32–44 base58 chars). */
function looksLikeSolanaAddress(q: string): boolean {
  const t = q.trim();
  return t.length >= 32 && t.length <= 44 && BASE58_REGEX.test(t);
}

/**
 * Search tokens via Relay currencies API (proxied through our backend).
 * One search for all chains; response includes chain so UI can show Solana / Base / BNB.
 * If the query looks like a Solana address, sends an `address` param for exact lookup.
 */
export async function searchRelayTokens(
  term: string,
  limit = 20,
  apiBase: string
): Promise<{ raw: unknown; currencies: RelayCurrency[] }> {
  const params = new URLSearchParams({ limit: String(limit) });
  const trimmed = term.trim();
  if (looksLikeSolanaAddress(trimmed)) {
    params.set("address", trimmed);
  } else if (trimmed) {
    params.set("term", trimmed);
  }
  const res = await fetch(`${apiBase}/api/relay/currencies?${params.toString()}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `Relay search failed: ${res.status}`);
  }
  return res.json();
}

