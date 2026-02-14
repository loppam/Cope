/**
 * Dispatcher for Moralis API - invoked via rewrite: /api/moralis/(.*) -> /api/moralis-proxy?path=$1
 * Dispatches to the same handlers as api/moralis/[...slug].ts (path = action, e.g. profitability, token-overview).
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ROUTES } from "./moralis/[...slug]";

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
      message: `Moralis action '${action || ""}' not found. Use: token-overview, search, profitability`,
    });
    return;
  }
  await routeHandler(req, res);
}
