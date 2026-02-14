/**
 * Dispatcher for Birdeye API - invoked via rewrite: /api/birdeye/(.*) -> /api/birdeye-proxy?path=$1
 * Dispatches to the same handlers as api/birdeye/[...slug].ts (path = action, e.g. pnl-summary, token-txs).
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ROUTES } from "./birdeye/[...slug]";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  const pathParam = req.query.path;
  const action =
    typeof pathParam === "string"
      ? pathParam
      : Array.isArray(pathParam)
        ? pathParam[0]
        : "";
  const routeHandler = action ? ROUTES[action] : undefined;
  if (!routeHandler) {
    res.status(404).json({
      error: "Not found",
      message: `Birdeye action '${action || ""}' not found. Use: search, token-overview, wallet-token-balance, ohlcv, history-price, pnl-summary, token-txs`,
    });
    return;
  }
  await routeHandler(req, res);
}
