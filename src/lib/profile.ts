/**
 * Profile-related API helpers
 */

import { getApiBase } from "./utils";

export async function getFollowersCount(idToken: string): Promise<number> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/profile/followers-count`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  if (!res.ok) {
    throw new Error("Failed to fetch followers count");
  }
  const data = await res.json();
  return data.count ?? 0;
}

export interface FollowerEntry {
  uid: string;
}

export interface PublicProfileByHandle {
  uid: string;
  xHandle: string | null;
  displayName: string | null;
  avatar: string | null;
  walletAddress: string;
  evmAddress: string | null;
  followersCount: number;
  followingCount: number;
  watchlistCount: number;
  /** From walletStats (synced by cron). All-time win rate 0-100. */
  winRate?: number;
  totalTrades?: number;
  realizedPnL?: number;
}

export async function getPublicProfileByHandle(
  handle: string,
): Promise<PublicProfileByHandle> {
  const base = getApiBase();
  const normalized = encodeURIComponent(handle.trim().replace(/^@/, ""));
  const res = await fetch(`${base}/api/profile/by-handle?handle=${normalized}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || "Profile not found or private");
  }
  return res.json();
}

export async function getFollowersList(
  idToken: string,
): Promise<FollowerEntry[]> {
  const base = getApiBase();
  const res = await fetch(`${base}/api/profile/followers-list`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });
  if (!res.ok) {
    throw new Error("Failed to fetch followers list");
  }
  const data = await res.json();
  return data.followers ?? [];
}
