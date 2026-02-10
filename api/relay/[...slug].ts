// Single entrypoint for relay routes (no Firebase reads here; each handler does its own if needed).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { depositQuoteHandler } from "./handlers/deposit-quote";
import { swapQuoteHandler } from "./handlers/swap-quote";
import { withdrawQuoteHandler } from "./handlers/withdraw-quote";
import { executeStepHandler } from "./handlers/execute-step";
import { evmAddressHandler } from "./handlers/evm-address";
import { evmBalancesHandler } from "./handlers/evm-balances";
import { currenciesHandler } from "./handlers/currencies";
import { coingeckoTokensHandler } from "./handlers/coingecko-tokens";

const ROUTES: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<void | VercelResponse>> = {
  "deposit-quote": depositQuoteHandler,
  "swap-quote": swapQuoteHandler,
  "withdraw-quote": withdrawQuoteHandler,
  "execute-step": executeStepHandler,
  "evm-address": evmAddressHandler,
  "evm-balances": evmBalancesHandler,
  "currencies": currenciesHandler,
  "coingecko-tokens": coingeckoTokensHandler,
};

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const path = (req.url ?? "").split("?")[0];
  const segments = path.split("/").filter(Boolean);
  const action = segments[segments.length - 1];
  const routeHandler = action ? ROUTES[action] : undefined;

  if (!routeHandler) {
    res.status(404).json({
      error: "Not found",
      message: `Relay action '${action || ""}' not found. Use one of: ${Object.keys(ROUTES).join(", ")}`,
    });
    return;
  }

  await routeHandler(req, res);
}
