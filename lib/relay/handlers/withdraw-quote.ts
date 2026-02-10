import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  RELAY_API_BASE,
  CHAIN_IDS,
  SOLANA_USDC_MINT,
  DESTINATION_USDC,
} from "../constants";
import { ensureFirebase, getAdminAuth } from "../../firebase-admin";

export async function withdrawQuoteHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    ensureFirebase();
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    await getAdminAuth().verifyIdToken(authHeader.slice(7));

    const body = req.body as {
      destinationNetwork?: string;
      amount?: number;
      destinationAddress?: string;
      originAddress?: string;
    };
    const destinationNetwork = (body?.destinationNetwork || "").toLowerCase();
    const amount = typeof body?.amount === "number" ? body.amount : parseFloat(String(body?.amount || "0"));
    const destinationAddress = (body?.destinationAddress || "").trim();
    const originAddress = (body?.originAddress || "").trim();

    if (destinationNetwork !== "base" && destinationNetwork !== "bnb" && destinationNetwork !== "solana") {
      return res.status(400).json({ error: "Invalid destinationNetwork; use base, bnb, or solana" });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }
    if (!destinationAddress || destinationAddress.length < 20) {
      return res.status(400).json({ error: "Invalid destinationAddress" });
    }

    const apiKey = process.env.RELAY_API_KEY;
    const originChainId = CHAIN_IDS.solana;
    const destinationChainId = CHAIN_IDS[destinationNetwork] ?? CHAIN_IDS.base;
    const originCurrency = SOLANA_USDC_MINT;
    const destinationCurrency =
      destinationNetwork === "solana"
        ? SOLANA_USDC_MINT
        : DESTINATION_USDC[destinationNetwork] || DESTINATION_USDC.base;
    const amountRaw = Math.floor(amount * 1e6).toString();

    const user = originAddress || "0x0000000000000000000000000000000000000000";

    const quoteBody = {
      user,
      originChainId,
      destinationChainId,
      originCurrency,
      destinationCurrency,
      amount: amountRaw,
      tradeType: "EXACT_INPUT",
      recipient: destinationAddress,
    };

    const quoteRes = await fetch(`${RELAY_API_BASE}/quote/v2`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey && { "x-api-key": apiKey }),
      },
      body: JSON.stringify(quoteBody),
    });

    if (!quoteRes.ok) {
      const errBody = await quoteRes.text();
      let message = `Relay quote failed: ${quoteRes.status}`;
      try {
        const j = JSON.parse(errBody);
        if (j.message) message = j.message;
        else if (j.error) message = j.error;
      } catch {
        if (errBody) message = errBody.slice(0, 200);
      }
      return res.status(quoteRes.status >= 500 ? 502 : 400).json({ error: message });
    }

    const quote = await quoteRes.json();
    return res.status(200).json(quote);
  } catch (e: unknown) {
    console.error("withdraw-quote error:", e);
    const message = e instanceof Error ? e.message : "Internal server error";
    return res.status(500).json({ error: message });
  }
}
