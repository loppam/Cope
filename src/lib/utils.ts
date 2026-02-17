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

// Format currency ($ prefix, K/M/B/T for large values)
export function formatCurrency(num: number, decimals = 2): string {
  return `$${formatNumber(Math.abs(num), decimals)}`;
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
