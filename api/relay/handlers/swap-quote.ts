import type { VercelRequest, VercelResponse } from "@vercel/node";
import { RELAY_API_BASE, CHAIN_IDS } from "../constants";
import { ensureFirebase, getAdminAuth } from "../../../lib/firebase-admin";

export async function swapQuoteHandler(req: VercelRequest, res: VercelResponse) {
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
      inputMint?: string;
      outputMint?: string;
      amount?: string;
      slippageBps?: number;
      userWallet?: string;
      tradeType?: "buy" | "sell";
      outputChainId?: number;
      outputChain?: string;
    };
    const inputMint = (body?.inputMint || "").trim();
    const outputMint = (body?.outputMint || "").trim();
    const amount = body?.amount ?? "";
    const slippageBps = typeof body?.slippageBps === "number" ? body.slippageBps : 100;
    const userWallet = (body?.userWallet || "").trim();
    let destinationChainId = CHAIN_IDS.solana;
    if (typeof body?.outputChainId === "number") {
      destinationChainId = body.outputChainId;
    } else if (body?.outputChain) {
      const name = (body.outputChain as string).toLowerCase();
      destinationChainId = CHAIN_IDS[name] ?? destinationChainId;
    }

    if (!inputMint || !outputMint || !amount || !userWallet) {
      return res.status(400).json({ error: "Missing inputMint, outputMint, amount, or userWallet" });
    }

    const apiKey = process.env.RELAY_API_KEY;
    const originChainId = CHAIN_IDS.solana;

    const recipient = (body as { recipient?: string }).recipient?.trim() || userWallet;
    const quoteBody = {
      user: userWallet,
      originChainId,
      destinationChainId,
      originCurrency: inputMint,
      destinationCurrency: outputMint,
      amount,
      tradeType: "EXACT_INPUT",
      recipient,
      slippageTolerance: String(slippageBps),
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
    console.error("swap-quote error:", e);
    const message = e instanceof Error ? e.message : "Internal server error";
    return res.status(500).json({ error: message });
  }
}
