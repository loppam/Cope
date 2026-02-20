import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** API base URL for serverless routes (VITE_API_BASE_URL). */
export function getApiBase(): string {
  return import.meta.env?.VITE_API_BASE_URL ?? '';
}

/**
 * Base URL for building absolute API URLs (e.g. for new URL()).
 * When VITE_API_BASE_URL is unset, uses current origin so relative paths still work.
 */
export function getApiBaseAbsolute(): string {
  const base = getApiBase();
  if (base) return base;
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return "";
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Format wallet address
export function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

// Format numbers with K, M, B, T suffixes (decimals default 2)
export function formatNumber(num: number, decimals = 2): string {
  if (!Number.isFinite(num)) return "0.00";
  const sign = num < 0 ? "-" : "";
  const value = Math.abs(num);
  if (value >= 1_000_000_000_000) {
    return `${sign}${(value / 1_000_000_000_000).toFixed(decimals)}T`;
  }
  if (value >= 1_000_000_000) {
    return `${sign}${(value / 1_000_000_000).toFixed(decimals)}B`;
  }
  if (value >= 1_000_000) {
    return `${sign}${(value / 1_000_000).toFixed(decimals)}M`;
  }
  if (value >= 1_000) {
    return `${sign}${(value / 1_000).toFixed(decimals)}K`;
  }
  return `${sign}${value.toFixed(decimals)}`;
}

// Format currency ($ prefix, K/M/B/T for large values). Handles null/undefined.
export function formatCurrency(
  num: number | undefined | null,
  decimals = 2,
): string {
  if (num == null || !Number.isFinite(num)) return "$0.00";
  const sign = num < 0 ? "-" : "";
  return `${sign}$${formatNumber(Math.abs(num), decimals)}`;
}

// Format token/amount for notifications (no $ prefix, handles K/M/B/T, 2 decimals)
export function formatTokenAmountCompact(value: number | undefined | null): string | null {
  if (value == null || Number.isNaN(value)) return null;
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000_000) {
    return `${(value / 1_000_000_000_000).toFixed(2)}T`;
  }
  if (abs >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (abs >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2)}M`;
  }
  if (abs >= 1_000) {
    return `${(value / 1_000).toFixed(2)}K`;
  }
  return value.toFixed(2);
}

// Format percentage
export function formatPercentage(num: number, decimals = 2): string {
  return `${num > 0 ? '+' : ''}${num.toFixed(decimals)}%`;
}

/**
 * Format very small numbers without scientific notation (DexScreener-style).
 * e.g. 4.16e-6 → "0.00000416" instead of "4.16e-6"
 */
export function formatSmallNumber(num: number, maxDecimals = 12): string {
  if (!Number.isFinite(num)) return "0";
  const abs = Math.abs(num);
  const sign = num < 0 ? "-" : "";
  if (abs >= 0.0001) return sign + abs.toString();
  const fixed = num.toFixed(maxDecimals);
  return fixed.replace(/\.?0+$/, "") || "0";
}

const SUBSCRIPT_DIGITS = "₀₁₂₃₄₅₆₇₈₉";

/**
 * DexScreener-style compact price: for very small numbers, use subscript to show
 * zero count and save space. e.g. 0.00000303 → $0.0₆303 (6 zeros before 303)
 */
export function formatPriceCompact(
  val: string | number,
): { compact: true; prefix: string; zeroSub: string; significant: string } | { compact: false; str: string } {
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (!Number.isFinite(n) || n < 0) {
    return { compact: false, str: typeof val === "string" ? val : "$0" };
  }
  if (n >= 0.001) {
    if (n >= 1) return { compact: false, str: `$${n.toFixed(4)}` };
    return { compact: false, str: `$${n.toFixed(6)}` };
  }
  const s = formatSmallNumber(n);
  const match = s.match(/^0\.(0+)(\d+)$/);
  if (!match) return { compact: false, str: `$${s}` };
  const zeros = match[1];
  const sig = match[2].replace(/0+$/, "") || "0";
  const zeroCount = zeros.length;
  const zeroSub =
    zeroCount <= 9
      ? SUBSCRIPT_DIGITS[zeroCount]
      : zeroCount <= 99
        ? String(zeroCount)
            .split("")
            .map((d) => SUBSCRIPT_DIGITS[parseInt(d, 10)])
            .join("")
        : String(zeroCount);
  return { compact: true, prefix: "$0.0", zeroSub, significant: sig };
}

/**
 * Convert UI amount to raw integer string for APIs (Relay, etc).
 * Avoids scientific notation for large values (e.g. EVM 18-decimals).
 */
export function toRawAmountString(uiAmount: number, decimals: number): string {
  const [whole = "0", frac = ""] = uiAmount
    .toFixed(Math.min(decimals, 20))
    .split(".");
  const fracPadded = frac.padEnd(decimals, "0").slice(0, decimals);
  const multiplier = BigInt(10) ** BigInt(decimals);
  return (BigInt(whole) * multiplier + BigInt(fracPadded || "0")).toString();
}
