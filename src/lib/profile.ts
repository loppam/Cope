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
