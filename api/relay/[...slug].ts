// Single entrypoint for relay routes (no Firebase reads here; each handler does its own if needed).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { depositQuoteHandler } from "../../lib/relay/handlers/deposit-quote";
import { swapQuoteHandler } from "../../lib/relay/handlers/swap-quote";
import { withdrawQuoteHandler } from "../../lib/relay/handlers/withdraw-quote";
import { executeStepHandler } from "../../lib/relay/handlers/execute-step";
import { evmAddressHandler } from "../../lib/relay/handlers/evm-address";
import { evmBalancesHandler } from "../../lib/relay/handlers/evm-balances";
import { currenciesHandler } from "../../lib/relay/handlers/currencies";

const ROUTES: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<void | VercelResponse>> = {
  "deposit-quote": depositQuoteHandler,
  "swap-quote": swapQuoteHandler,
  "withdraw-quote": withdrawQuoteHandler,
  "execute-step": executeStepHandler,
  "evm-address": evmAddressHandler,
  "evm-balances": evmBalancesHandler,
  "currencies": currenciesHandler,
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
