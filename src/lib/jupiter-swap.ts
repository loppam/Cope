// Jupiter Ultra Swap API - quote/execute proxied via /api/jupiter so API key stays server-side
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { getEncryptedWalletCredentials } from "./auth";
import { decryptWalletCredentials, generateEncryptionKey } from "./encryption";
import { getApiBase } from "./utils";

const SOL_MINT = "So11111111111111111111111111111111111111112";

/**
 * Get Jupiter referral configuration (referral account is not secret)
 */
function getReferralConfig(): { account: string; feeBps: number } | null {
  const account = import.meta.env.VITE_JUPITER_REFERRAL_ACCOUNT;
  const feeBps = import.meta.env.VITE_JUPITER_REFERRAL_FEE_BPS;

  if (!account || !feeBps) {
    console.warn(
      "Jupiter referral not configured - swaps will proceed without platform fees",
    );
    return null;
  }

  return {
    account,
    feeBps: parseInt(feeBps, 10),
  };
}

/**
 * Swap Quote Interface
 */
export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inputAmount: number;
  outputAmount: number;
  inputAmountUi: number;
  outputAmountUi: number;
  /** USD value of input (from API inUsdValue) */
  inUsdValue?: number;
  /** USD value of output (from API outUsdValue) */
  outUsdValue?: number;
  priceImpact: number;
  feeBps: number;
  feeMint: string;
  requestId: string;
  transaction: string; // base64 encoded transaction
  slippage: number;
}

/**
 * Swap Result Interface
 */
export interface SwapResult {
  signature: string;
  status: "Success" | "Failed";
  error?: string;
}

/**
 * Get swap quote from Jupiter Ultra API
 * API returns inAmount, outAmount (strings); priceImpact (number); feeBps, feeMint, requestId, transaction.
 * Optional inputDecimals/outputDecimals let caller pass token decimals for correct UI amounts.
 */
export async function getSwapQuote(
  inputMint: string,
  outputMint: string,
  amount: number, // in lamports/smallest unit
  userWallet: string,
  slippage: number = 100, // basis points (100 = 1%)
  inputDecimals?: number,
  outputDecimals?: number,
): Promise<SwapQuote> {
  try {
    const base = getApiBase();
    const referralConfig = getReferralConfig();

    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount: amount.toString(),
      taker: userWallet,
      slippageBps: slippage.toString(),
    });
    if (referralConfig) {
      params.append("referralAccount", referralConfig.account);
      params.append("referralFee", referralConfig.feeBps.toString());
    }

    const response = await fetch(
      `${base}/api/jupiter/ultra/v1/order?${params.toString()}`,
      { method: "GET", headers: { "Content-Type": "application/json" } },
    );

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: "Unknown error" }));
      throw new Error(
        error.message || `Failed to get swap quote: ${response.status}`,
      );
    }

    const data = await response.json();

    // Jupiter API returns inAmount, outAmount (strings); optional priceImpactPct (string)
    const inAmountStr = data.inAmount ?? data.inputAmount ?? String(amount);
    const outAmountStr = data.outAmount ?? data.outputAmount ?? "0";
    const inAmountNum = parseInt(inAmountStr, 10);
    const outAmountNum = parseInt(outAmountStr, 10);

    const inDecimals = inputDecimals ?? (inputMint === SOL_MINT ? 9 : 6);
    const outDecimals = outputDecimals ?? (outputMint === SOL_MINT ? 9 : 6);

    const inputAmountUi =
      data.inputAmountUi != null
        ? parseFloat(data.inputAmountUi)
        : inAmountNum / Math.pow(10, inDecimals);
    const outputAmountUi =
      data.outputAmountUi != null
        ? parseFloat(data.outputAmountUi)
        : outAmountNum / Math.pow(10, outDecimals);

    const priceImpact =
      data.priceImpact != null
        ? parseFloat(data.priceImpact)
        : data.priceImpactPct != null
          ? parseFloat(data.priceImpactPct) * 100
          : 0;

    const inUsdValue =
      data.inUsdValue != null ? parseFloat(data.inUsdValue) : undefined;
    const outUsdValue =
      data.outUsdValue != null ? parseFloat(data.outUsdValue) : undefined;

    return {
      inputMint: data.inputMint ?? inputMint,
      outputMint: data.outputMint ?? outputMint,
      inputAmount: inAmountNum,
      outputAmount: outAmountNum,
      inputAmountUi,
      outputAmountUi,
      inUsdValue,
      outUsdValue,
      priceImpact,
      feeBps: parseInt(data.feeBps ?? data.platformFee?.feeBps ?? "0", 10),
      feeMint: data.feeMint ?? data.platformFee?.feeMint ?? inputMint,
      requestId: data.requestId,
      transaction: data.transaction,
      slippage,
    };
  } catch (error: any) {
    console.error("Error getting swap quote:", error);
    throw new Error(error.message || "Failed to get swap quote");
  }
}

/**
 * Execute swap transaction
 * This function:
 * 1. Retrieves encrypted wallet credentials from Firestore
 * 2. Decrypts the wallet
 * 3. Signs the transaction
 * 4. Submits to Jupiter for execution
 */
export async function executeSwap(
  quote: SwapQuote,
  userId: string,
): Promise<SwapResult> {
  try {
    // 1. Get encrypted credentials from Firestore
    const credentials = await getEncryptedWalletCredentials(userId);
    if (!credentials || !credentials.encryptedSecretKey) {
      throw new Error(
        "Wallet credentials not found. Please set up your wallet first.",
      );
    }

    // 2. Decrypt wallet
    const encryptionSecret = import.meta.env.VITE_ENCRYPTION_SECRET;
    if (!encryptionSecret) {
      throw new Error("Encryption secret not configured");
    }

    const { secretKey } = await decryptWalletCredentials(
      userId,
      credentials.encryptedMnemonic,
      credentials.encryptedSecretKey,
      encryptionSecret,
    );

    // 3. Create keypair from decrypted secret key
    const wallet = Keypair.fromSecretKey(secretKey);

    // 4. Deserialize transaction from base64
    const transactionBuffer = Buffer.from(quote.transaction, "base64");
    const transaction = VersionedTransaction.deserialize(transactionBuffer);

    // 5. Sign transaction
    transaction.sign([wallet]);

    // 6. Serialize signed transaction back to base64
    const signedTransaction = Buffer.from(transaction.serialize()).toString(
      "base64",
    );

    // 7. Execute via Jupiter proxy (key server-side)
    const base = getApiBase();
    const response = await fetch(`${base}/api/jupiter/ultra/v1/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        signedTransaction,
        requestId: quote.requestId,
      }),
    });

    if (!response.ok) {
      const error = await response
        .json()
        .catch(() => ({ message: "Unknown error" }));
      throw new Error(
        error.message || `Swap execution failed: ${response.status}`,
      );
    }

    const result = await response.json();

    return {
      signature: result.signature,
      status: result.status || "Success",
      error: result.error,
    };
  } catch (error: any) {
    console.error("Error executing swap:", error);
    return {
      signature: "",
      status: "Failed",
      error: error.message || "Swap execution failed",
    };
  }
}

/**
 * Format token amount for display
 */
export function formatTokenAmount(amount: number, decimals: number): string {
  const value = amount / Math.pow(10, decimals);

  if (value === 0) return "0";
  if (value < 0.000001) return value.toExponential(2);
  if (value < 0.01) return value.toFixed(6);
  if (value < 1) return value.toFixed(4);
  if (value < 1000) return value.toFixed(2);
  if (value < 1000000) return `${(value / 1000).toFixed(2)}K`;
  return `${(value / 1000000).toFixed(2)}M`;
}

/**
 * Calculate price impact color for UI
 */
export function getPriceImpactColor(priceImpact: number): string {
  const impact = Math.abs(priceImpact);
  if (impact < 1) return "text-green-500";
  if (impact < 3) return "text-yellow-500";
  if (impact < 5) return "text-orange-500";
  return "text-red-500";
}

/**
 * Format price impact for display
 */
export function formatPriceImpact(priceImpact: number): string {
  return `${priceImpact > 0 ? "+" : ""}${priceImpact.toFixed(2)}%`;
}
