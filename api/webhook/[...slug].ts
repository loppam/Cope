// Single entrypoint for webhook routes (stays under Vercel Hobby 12-function limit).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHandler } from "./handlers/create";
import { syncHandler } from "./handlers/sync";
import { transactionHandler } from "./handlers/transaction";

const ROUTES: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<void | VercelResponse>> = {
  create: createHandler,
  sync: syncHandler,
  transaction: transactionHandler,
};

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const path = (req.url ?? "").split("?")[0];
  const segments = path.split("/").filter(Boolean);
  const action = segments[segments.length - 1];
  const routeHandler = action ? ROUTES[action] : undefined;

  if (!routeHandler) {
    res.status(404).json({
      error: "Not found",
      message: `Webhook action '${action || ""}' not found. Use one of: ${Object.keys(ROUTES).join(", ")}`,
    });
    return;
  }

  await routeHandler(req, res);
}
