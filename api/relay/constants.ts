/** Relay API base URL. */
export const RELAY_API_BASE =
  process.env.RELAY_API_BASE || "https://api.relay.link";

/** Chain IDs. Solana: 792703809 per Relay docs. */
export const CHAIN_IDS: Record<string, number> = {
  base: 8453,
  bnb: 56,
  solana: 792703809,
};

/** Solana USDC SPL mint. */
export const SOLANA_USDC_MINT =
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** Origin USDC contract addresses (EVM, 6 decimals). */
export const ORIGIN_USDC: Record<string, string> = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  bnb: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
};

/** Destination USDC (for withdraw: base/bnb contract or Solana mint). */
export const DESTINATION_USDC: Record<string, string> = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  bnb: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  solana: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
};

export const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const BNB_USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
