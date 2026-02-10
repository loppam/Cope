import { createHash } from "crypto";

/** SHA-256 hex digest of token (e.g. for push token document ID). */
export function pushTokenDocId(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
