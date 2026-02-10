import type { VercelRequest, VercelResponse } from "@vercel/node";
import { RELAY_API_BASE } from "../constants";

/**
 * Relay Get Currencies v2 - token search/list by term or by token addresses.
 * Proxies to Relay so we can test the raw output and normalize for the app.
 * See: https://docs.relay.link/references/api/get-currencies-v2
 */

const RELAY_CHAIN_IDS: Record<number, string> = {
  792703809: "solana",
  8453: "base",
  56: "bnb",
};

export async function currenciesHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const apiKey = process.env.RELAY_API_KEY;
    const body = req.method === "POST" ? req.body : {};
    const query = req.query || {};
    const term = (body.term ?? query.term ?? "").toString().trim();
    const tokensParam = body.tokens ?? query.tokens;
    const chainIdsParam = body.chainIds ?? query.chainIds;
    const limit = Math.min(
      Math.max(1, parseInt(String(body.limit ?? query.limit ?? "20"), 10) || 20),
      50,
    );
    const verified = body.verified ?? query.verified;

    const relayParams: Record<string, unknown> = { limit };
    if (term) relayParams.term = term;
    if (Array.isArray(tokensParam) && tokensParam.length > 0) relayParams.tokens = tokensParam;
    else if (typeof tokensParam === "string" && tokensParam) {
      try {
        const parsed = JSON.parse(tokensParam) as string[];
        if (Array.isArray(parsed) && parsed.length > 0) relayParams.tokens = parsed;
      } catch {
        relayParams.tokens = [tokensParam];
      }
    }
    if (Array.isArray(chainIdsParam) && chainIdsParam.length > 0) relayParams.chainIds = chainIdsParam;
    if (verified !== undefined) relayParams.verified = Boolean(verified);

    let relayRes = await fetch(`${RELAY_API_BASE}/currencies/v2`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey && { "x-api-key": apiKey }),
      },
      body: JSON.stringify(relayParams),
    });

    if (relayRes.status === 404 || relayRes.status === 405) {
      const getUrl = new URL(`${RELAY_API_BASE}/currencies/v2`);
      if (term) getUrl.searchParams.set("term", term);
      getUrl.searchParams.set("limit", String(limit));
      relayRes = await fetch(getUrl.toString(), {
        headers: apiKey ? { "x-api-key": apiKey } : {},
      });
    }

    const raw = await relayRes.text();
    if (!relayRes.ok) {
      let message = `Relay currencies failed: ${relayRes.status}`;
      try {
        const j = JSON.parse(raw);
        if (j.message) message = j.message;
        else if (j.error) message = j.error;
      } catch {
        if (raw) message = raw.slice(0, 200);
      }
      return res.status(relayRes.status >= 500 ? 502 : 400).json({ error: message });
    }

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(502).json({ error: "Invalid JSON from Relay" });
    }

    const list = Array.isArray(data)
      ? data
      : (data as { currencies?: unknown[]; data?: unknown[] })?.currencies
        ?? (data as { currencies?: unknown[]; data?: unknown[] })?.data
        ?? [];
    const normalized = (list as { chainId?: number; address?: string; symbol?: string; name?: string; decimals?: number; logoURI?: string; verified?: boolean }[]).map(
      (c) => ({
        chainId: c.chainId,
        chain: c.chainId != null ? RELAY_CHAIN_IDS[c.chainId] ?? "solana" : "solana",
        address: c.address ?? "",
        symbol: c.symbol ?? "",
        name: c.name ?? "",
        decimals: typeof c.decimals === "number" ? c.decimals : 6,
        logoURI: c.logoURI,
        verified: c.verified,
      }),
    );

    return res.status(200).json({
      raw: data,
      currencies: normalized,
    });
  } catch (e: unknown) {
    console.error("currencies error:", e);
    const message = e instanceof Error ? e.message : "Internal server error";
    return res.status(500).json({ error: message });
  }
}
