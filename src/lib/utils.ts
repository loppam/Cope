import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** API base URL for serverless routes (VITE_API_BASE_URL). */
export function getApiBase(): string {
  return import.meta.env?.VITE_API_BASE_URL ?? '';
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Format wallet address
export function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

// Format numbers
export function formatNumber(num: number, decimals = 2): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(decimals)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(decimals)}K`;
  }
  return num.toFixed(decimals);
}

// Format currency
export function formatCurrency(num: number, decimals = 2): string {
  return `$${formatNumber(num, decimals)}`;
}

// Format percentage
export function formatPercentage(num: number, decimals = 2): string {
  return `${num > 0 ? '+' : ''}${num.toFixed(decimals)}%`;
}
