/**
 * Proxy for Jupiter API - keeps API key server-side.
 * Invoked via rewrite: /api/jupiter/(.*) -> /api/jupiter-proxy?path=$1
 * Forwards GET/POST to https://api.jup.ag/{path}
 * Env: JUPITER_API_KEY
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";

const JUPITER_API_BASE = "https://api.jup.ag";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  const pathParam = req.query.path;
  const suffix =
    typeof pathParam === "string"
      ? pathParam
      : Array.isArray(pathParam)
        ? pathParam.join("/")
        : "";
  if (!suffix) {
    res.status(400).json({ error: "Missing path" });
    return;
  }

  const apiKey = process.env.JUPITER_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "JUPITER_API_KEY not configured" });
    return;
  }

  const url = new URL(`${JUPITER_API_BASE}/${suffix}`);
  for (const [key, value] of Object.entries(req.query || {})) {
    if (key === "path" || value == null) continue;
    const v = Array.isArray(value) ? value[0] : String(value);
    url.searchParams.set(key, v);
  }

  try {
    const init: RequestInit = {
      method: req.method ?? "GET",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
    };
    if ((req.method === "POST" || req.method === "PUT") && req.body) {
      init.body =
        typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    }
    const out = await fetch(url.toString(), init);
    const text = await out.text();
    res.status(out.status);
    try {
      res.json(text ? JSON.parse(text) : {});
    } catch {
      res.send(text);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Jupiter proxy error";
    console.error("[jupiter proxy]", suffix, message);
    res.status(502).json({ error: message });
  }
}
