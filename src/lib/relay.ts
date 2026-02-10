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

