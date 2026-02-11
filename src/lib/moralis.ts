/**
 * Moralis API client for EVM wallet profitability (PnL).
 * Used for Base and BNB chain positions in Profile open positions.
 * @see https://docs.moralis.com/web3-data-api/evm/reference/wallet-api/get-wallet-profitability
 */

const MORALIS_API_BASE = "https://deep-index.moralis.io/api/v2.2";

// EVM token addresses (lowercase) mapped to our mint IDs
const BASE_USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const BNB_USDC = "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d";
const NATIVE_PLACEHOLDERS = new Set([
  "",
  "0x0000000000000000000000000000000000000000",
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
]);

export interface MoralisProfitabilityToken {
  token_address: string;
  avg_buy_price_usd?: number;
  avg_sell_price_usd?: number;
  total_usd_invested?: number;
  total_tokens_sold?: number;
  total_tokens_bought?: number;
  total_sold_usd?: number;
  realized_profit_usd?: number;
  realized_profit_percentage?: number;
  name?: string;
  symbol?: string;
  decimals?: number;
  logo?: string;
}

export interface EvmPnlByMint {
  mint: string;
  pnl: number;
  pnlPercent?: number;
  realized?: number;
  unrealized?: number;
}

function getApiKey(): string | null {
  return import.meta.env.VITE_MORALIS_API_KEY || null;
}

function mintFromTokenAddress(
  tokenAddress: string,
  chain: "base" | "bsc",
): string | null {
  const addr = (tokenAddress || "").toLowerCase().trim();
  if (NATIVE_PLACEHOLDERS.has(addr)) {
    return chain === "base" ? "base-eth" : "bnb-bnb";
  }
  if (addr === BASE_USDC) return "base-usdc";
  if (addr === BNB_USDC) return "bnb-usdc";
  return null;
}

/**
 * Fetch wallet profitability from Moralis for a given EVM chain.
 * Returns PnL data keyed by our mint IDs (base-usdc, base-eth, bnb-usdc, bnb-bnb).
 */
export async function getWalletProfitability(
  evmAddress: string,
  chain: "base" | "bsc",
): Promise<EvmPnlByMint[]> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return [];
  }

  const chainParam = chain === "base" ? "base" : "bsc";
  const url = `${MORALIS_API_BASE}/wallets/${evmAddress}/profitability?chain=${chainParam}&days=all`;

  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "X-API-Key": apiKey,
      },
    });

    if (!res.ok) {
      if (res.status === 429) {
        console.warn("Moralis rate limited");
        return [];
      }
      const err = await res.json().catch(() => ({}));
      console.warn("Moralis profitability error:", res.status, err);
      return [];
    }

    const data = (await res.json()) as { result?: MoralisProfitabilityToken[] };
    const result = Array.isArray(data?.result) ? data.result : [];
    const output: EvmPnlByMint[] = [];

    for (const t of result) {
      const mint = mintFromTokenAddress(t.token_address ?? "", chain);
      if (!mint) continue;

      const realized = t.realized_profit_usd ?? 0;
      const totalInvested = t.total_usd_invested ?? 0;
      const pnlPercent = t.realized_profit_percentage;
      // Moralis gives realized; for open positions unrealized may not be in response.
      // Use realized as primary PnL; pnlPercent is the profit margin.
      const pnl = realized;

      output.push({
        mint,
        pnl,
        pnlPercent: pnlPercent != null ? Number(pnlPercent) : undefined,
        realized,
      });
    }

    return output;
  } catch (e) {
    console.warn("Moralis profitability fetch failed:", e);
    return [];
  }
}
