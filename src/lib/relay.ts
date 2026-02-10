/**
 * Relay API client helpers (client-safe: no API key; quote/execute go through backend).
 * See: https://docs.relay.link/references/api/core
 */

const RELAY_API_BASE = "https://api.relay.link";

/** Chain IDs from Relay (fallbacks when GET /chains not used). Solana: 792703809 per Relay docs. */
export const RELAY_CHAIN_IDS = {
  base: 8453,
  bnb: 56,
  solana: 792703809,
} as const;

export type RelayNetwork = "base" | "bnb" | "solana";

export interface RelayChain {
  id: number;
  name: string;
  displayName: string;
  depositEnabled?: boolean;
  disabled?: boolean;
}

let chainsCache: RelayChain[] | null = null;

/**
 * Fetch supported chains from Relay and cache. Maps by name for Base, BNB, Solana.
 */
export async function getChains(): Promise<RelayChain[]> {
  if (chainsCache) return chainsCache;
  const res = await fetch(`${RELAY_API_BASE}/chains`);
  if (!res.ok) throw new Error("Failed to fetch Relay chains");
  const data = await res.json();
  const chains = (data.chains || []).map((c: { id: number; name: string; displayName?: string; depositEnabled?: boolean; disabled?: boolean }) => ({
    id: c.id,
    name: c.name,
    displayName: c.displayName ?? c.name,
    depositEnabled: c.depositEnabled,
    disabled: c.disabled,
  }));
  chainsCache = chains;
  return chains;
}

/**
 * Get chain ID for a network (Base, BNB, Solana). Uses cache or fallback constants.
 */
export async function getChainId(network: RelayNetwork): Promise<number> {
  const chains = await getChains();
  const byName = chains.find((c) => c.name.toLowerCase() === network.toLowerCase());
  if (byName) return byName.id;
  return (RELAY_CHAIN_IDS as Record<string, number>)[network] ?? 0;
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

