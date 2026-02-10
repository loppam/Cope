import type { VercelRequest, VercelResponse } from "@vercel/node";
import { RELAY_API_BASE, CHAIN_IDS, ORIGIN_USDC, SOLANA_USDC_MINT } from "../constants";
import { ensureFirebase, getAdminAuth } from "../../../lib/firebase-admin";

export async function depositQuoteHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  try {
    ensureFirebase();
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const token = authHeader.slice(7);
    await getAdminAuth().verifyIdToken(token);

    const body = req.body as { network?: string; amountUsd?: number; recipientSolAddress?: string };
    const network = (body?.network || "").toLowerCase();
    const amountUsd = typeof body?.amountUsd === "number" ? body.amountUsd : parseFloat(String(body?.amountUsd ?? ""));
    const recipientSolAddress = typeof body?.recipientSolAddress === "string" ? body.recipientSolAddress.trim() : "";

    if (network !== "base" && network !== "bnb") {
      return res.status(400).json({ error: "Invalid network; use base or bnb" });
    }
    if (!Number.isFinite(amountUsd) || amountUsd <= 0 || amountUsd > 1_000_000) {
      return res.status(400).json({ error: "Invalid amountUsd" });
    }
    if (!recipientSolAddress || recipientSolAddress.length < 32) {
      return res.status(400).json({ error: "Invalid recipientSolAddress" });
    }

    const originChainId = CHAIN_IDS[network] ?? (network === "base" ? 8453 : 56);
    const destinationChainId = CHAIN_IDS.solana;
    const originCurrency = ORIGIN_USDC[network];
    const amountRaw = Math.floor(amountUsd * 1e6).toString();

    const apiKey = process.env.RELAY_API_KEY;
    const quoteBody = {
      user: "0x0000000000000000000000000000000000000000",
      originChainId,
      destinationChainId,
      originCurrency,
      destinationCurrency: SOLANA_USDC_MINT,
      amount: amountRaw,
      tradeType: "EXACT_INPUT",
      recipient: recipientSolAddress,
      useDepositAddress: true,
      refundTo: undefined,
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
    const steps = quote?.steps || [];
    const firstStep = steps[0];
    const depositAddress = firstStep?.depositAddress || firstStep?.items?.[0]?.data?.to;
    const requestId = firstStep?.requestId || quote?.protocol?.v2?.orderId;

    const details = quote?.details;
    const currencyOut = details?.currencyOut;
    const amountFormatted = currencyOut?.amountFormatted ?? amountUsd.toFixed(2);
    const amountOut = currencyOut?.amount != null ? String(currencyOut.amount) : amountRaw;

    return res.status(200).json({
      depositAddress: depositAddress || null,
      amount: amountOut,
      amountFormatted,
      requestId: requestId || null,
      currency: "USDC",
      network,
      details: details ? { currencyIn: details.currencyIn, currencyOut: details.currencyOut, fees: quote.fees } : undefined,
    });
  } catch (e: unknown) {
    console.error("deposit-quote error:", e);
    const message = e instanceof Error ? e.message : "Internal server error";
    return res.status(500).json({ error: message });
  }
}
