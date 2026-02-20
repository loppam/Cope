/**
 * Maps technical error messages to simple, user-friendly messages.
 * Never expose internal details (API names, config, stack traces) to users.
 */

/** Known technical phrases to replace with user-friendly text */
const FRIENDLY_MAP: Array<[RegExp | string, string]> = [
  // Auth
  [/invalid-credential|not configured|firebase console|authentication/i, "Sign-in isn't set up yet. Please try again later."],
  [/blocked|suspicious|prevented/i, "Sign-in was blocked. Try again in 24 hours."],
  [/popup-closed|redirect-cancelled|cancelled/i, "Sign-in was cancelled."],
  [/account.*exists.*different.*credential/i, "This account is already linked to another sign-in method."],
  [/operation-not-allowed/i, "Sign-in isn't available. Please try again later."],
  [/unauthorized|401|forbidden|403/i, "Please sign in and try again."],
  // Network / generic
  [/failed to fetch|network error|networkrequestfailed/i, "Connection failed. Check your internet and try again."],
  [/timeout|timed out/i, "Request took too long. Please try again."],
  [/429|rate limit|too many requests/i, "Too many attempts. Please wait a moment and try again."],
  [/500|502|503|internal server error/i, "Something went wrong on our end. Please try again."],
  // Swap / trading
  [/quote expired|failed to refresh|NO_SWAP_ROUTES|no routes found/i, "Quote expired or no routes found. Please get a new quote and try again."],
  [/insufficient|not enough|balance/i, "Not enough balance for this transaction."],
  [/price may have moved|slippage/i, "Price changed. Please try again with a new quote."],
  [/reverted|revert/i, "Transaction failed. Price may have changed—try again."],
  [/SOL_TX_TOO_LARGE|tx too large/i, "Transaction is too complex. Try a smaller amount."],
  // Wallet
  [/encryption|decrypt|secret.*key|invalid.*key/i, "Something went wrong with your wallet. Please try again."],
  [/document not found|profile not found|verification failed/i, "Something went wrong. Please try again."],
  [/invalid.*mnemonic|invalid.*private.*key/i, "Invalid recovery phrase or private key. Please check and try again."],
  // Scanner / analysis
  [/birdeye|api.*key|anthropic|token not found/i, "We couldn't load this token. Please try again."],
  [/analysis failed/i, "Analysis unavailable. Please try again later."],
];

const FALLBACK = "Something went wrong. Please try again.";

/**
 * Converts a technical error to a user-friendly message.
 * Use for toast.error, form validation, and any user-facing error display.
 */
export function toUserMessage(error: unknown, fallback: string = FALLBACK): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (!raw || raw === "[object Object]") return fallback;

  const lower = raw.toLowerCase();
  for (const [pattern, friendly] of FRIENDLY_MAP) {
    if (typeof pattern === "string") {
      if (lower.includes(pattern.toLowerCase())) return friendly;
    } else if (pattern.test(raw)) {
      return friendly;
    }
  }

  // If already short and doesn't look technical, use as-is (capped)
  if (raw.length <= 80 && !raw.includes("Error:") && !raw.includes("failed:")) {
    return raw;
  }

  return fallback;
}
