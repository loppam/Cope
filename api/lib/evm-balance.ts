/**
 * Server-side EVM balance helpers (Base + BNB).
 * Used by relay and cron/evm-balance.
 */
import { JsonRpcProvider, Contract } from "ethers";

const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BNB_USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
];
const NATIVE_ETH_PLACEHOLDER = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

export async function getEvmBalances(address: string): Promise<{
  base: { usdc: number; native: number };
  bnb: { usdc: number; native: number };
}> {
  const result = { base: { usdc: 0, native: 0 }, bnb: { usdc: 0, native: 0 } };
  try {
    const baseProvider = new JsonRpcProvider(
      process.env.BASE_RPC_URL || "https://mainnet.base.org",
    );
    const [baseNative, baseUsdcRaw] = await Promise.all([
      baseProvider.getBalance(address),
      new Contract(BASE_USDC, ERC20_ABI, baseProvider).balanceOf(address),
    ]);
    result.base.native = Number(baseNative) / 1e18;
    result.base.usdc = Number(baseUsdcRaw) / 1e6;
  } catch (e) {
    console.warn("Base balance fetch failed:", e);
  }
  try {
    const bnbProvider = new JsonRpcProvider(
      process.env.BNB_RPC_URL || "https://bsc-dataseed.binance.org",
    );
    const [bnbNative, bnbUsdcRaw] = await Promise.all([
      bnbProvider.getBalance(address),
      new Contract(BNB_USDC, ERC20_ABI, bnbProvider).balanceOf(address),
    ]);
    result.bnb.native = Number(bnbNative) / 1e18;
    result.bnb.usdc = Number(bnbUsdcRaw) / 1e6;
  } catch (e) {
    console.warn("BNB balance fetch failed:", e);
  }
  return result;
}

export type EvmTokenPosition = {
  mint: string;
  symbol: string;
  name: string;
  amount: number;
  value: number;
  chain: "base" | "bnb";
  image?: string;
  decimals: number;
};

/** Fetch all ERC-20 + native token balances from Moralis for Base and BNB. */
export async function getEvmTokenPositions(address: string): Promise<EvmTokenPosition[]> {
  const apiKey = process.env.MORALIS_API_KEY;
  if (!apiKey) return [];

  const tokens: EvmTokenPosition[] = [];
  const chains: Array<{ chain: "base" | "bnb"; param: string }> = [
    { chain: "base", param: "base" },
    { chain: "bnb", param: "bsc" },
  ];

  await Promise.all(
    chains.map(async ({ chain, param }) => {
      try {
        const url = `https://deep-index.moralis.io/api/v2.2/wallets/${address}/tokens?chain=${param}&limit=100&exclude_spam=true`;
        const res = await fetch(url, {
          headers: {
            accept: "application/json",
            "X-API-Key": apiKey,
          },
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          result?: Array<{
            token_address?: string;
            name?: string;
            symbol?: string;
            logo?: string;
            decimals?: number;
            balance?: string;
            balance_formatted?: string;
            usd_value?: number;
            native_token?: boolean;
          }>;
        };
        const list = Array.isArray(data?.result) ? data.result : [];
        for (const t of list) {
          const bal = parseFloat(t.balance_formatted ?? t.balance ?? "0");
          const value = t.usd_value ?? 0;
          if (bal <= 0 && value <= 0) continue;

          const addr = (t.token_address ?? "").toLowerCase();
          const isNative =
            t.native_token || !addr || addr === NATIVE_ETH_PLACEHOLDER;
          const mint = isNative
            ? chain === "base"
              ? "base-eth"
              : "bnb-bnb"
            : addr;

          tokens.push({
            mint,
            symbol: (
              t.symbol ?? (chain === "base" ? "ETH" : "BNB")
            ).toUpperCase(),
            name: t.name ?? (chain === "base" ? "Ethereum (Base)" : "BNB"),
            amount: bal,
            value,
            chain,
            image: t.logo,
            decimals: typeof t.decimals === "number" ? t.decimals : 18,
          });
        }
      } catch (e) {
        console.warn(`Moralis token fetch failed for ${chain}:`, e);
      }
    }),
  );

  return tokens;
}
