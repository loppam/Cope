import type { VercelRequest, VercelResponse } from "@vercel/node";

const COINGECKO_API_BASE = "https://api.coingecko.com/api/v3/onchain";

/** Map our chain names to CoinGecko onchain network IDs. */
const CHAIN_TO_NETWORK: Record<string, string> = {
  solana: "solana",
  base: "base",
  bnb: "bsc",
};

/**
 * Proxy to CoinGecko On-Chain "Tokens Data by Token Addresses".
 * GET /api/relay/coingecko-tokens?network=solana&addresses=addr1,addr2
 * Keeps API key server-side; does not add a new Vercel function (lives in relay catch-all).
 */
export async function coingeckoTokensHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    const apiKey = process.env.COINGECKO_API_KEY;
    const query = req.query || {};
    const networkParam = (query.network ?? "").toString().trim().toLowerCase();
    const addressesParam = (query.addresses ?? "").toString().trim();

    const network = (CHAIN_TO_NETWORK[networkParam] ?? networkParam) || "solana";
    if (!addressesParam) {
      return res.status(400).json({ error: "Missing addresses (comma-separated token addresses)" });
    }

    const addresses = addressesParam.split(",").map((a) => a.trim()).filter(Boolean);
    if (addresses.length === 0) {
      return res.status(400).json({ error: "At least one token address is required" });
    }
    if (addresses.length > 30) {
      return res.status(400).json({ error: "Maximum 30 addresses per request" });
    }

    const url = new URL(
      `${COINGECKO_API_BASE}/networks/${network}/tokens/multi/${addresses.join(",")}`
    );
    url.searchParams.set("include", "top_pools");
    url.searchParams.set("include_composition", "true");
    url.searchParams.set("include_inactive_source", "true");

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["x-cg-demo-api-key"] = apiKey;
    }

    const coinRes = await fetch(url.toString(), { method: "GET", headers });
    const raw = await coinRes.text();

    if (!coinRes.ok) {
      let message = `CoinGecko onchain failed: ${coinRes.status}`;
      try {
        const j = JSON.parse(raw);
        if (j.error) message = j.error;
        else if (j.message) message = j.message;
      } catch {
        if (raw) message = raw.slice(0, 200);
      }
      return res.status(coinRes.status >= 500 ? 502 : 400).json({ error: message });
    }

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(502).json({ error: "Invalid JSON from CoinGecko" });
    }

    return res.status(200).json(data);
  } catch (e: unknown) {
    console.error("coingecko-tokens error:", e);
    const message = e instanceof Error ? e.message : "Internal server error";
    return res.status(500).json({ error: message });
  }
}
