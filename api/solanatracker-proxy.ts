/**
 * Proxy for SolanaTracker Data API - keeps API key server-side.
 * Invoked via rewrite: /api/solanatracker/(.*) -> /api/solanatracker-proxy?path=$1
 * Forwards GET/POST to https://data.solanatracker.io/{path}
 * Env: SOLANATRACKER_API_KEY
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";

const SOLANATRACKER_API_BASE = "https://data.solanatracker.io";

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

  const apiKey = process.env.SOLANATRACKER_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "SOLANATRACKER_API_KEY not configured" });
    return;
  }

  const url = new URL(`${SOLANATRACKER_API_BASE}/${suffix}`);
  for (const [key, value] of Object.entries(req.query || {})) {
    if (key === "path" || value == null) continue;
    const v = Array.isArray(value) ? value[0] : String(value);
    url.searchParams.set(key, v);
  }

  try {
    const headers: Record<string, string> = {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    };
    const init: RequestInit = {
      method: req.method ?? "GET",
      headers,
    };
    if ((req.method === "POST" || req.method === "PUT") && req.body) {
      init.body =
        typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    }
    const out = await fetch(url.toString(), init);
    const text = await out.text();
    const contentType = out.headers.get("content-type") ?? "application/json";
    res.setHeader("Content-Type", contentType);
    res.status(out.status);
    try {
      res.send(text ? JSON.parse(text) : {});
    } catch {
      res.send(text);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Proxy error";
    console.error("[solanatracker proxy]", suffix, message);
    res.status(502).json({ error: message });
  }
}
