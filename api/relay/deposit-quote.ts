import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAuth } from "firebase-admin/auth";
import { getApps, initializeApp, cert } from "firebase-admin/app";

const RELAY_API_BASE = process.env.RELAY_API_BASE || "https://api.relay.link";

// Known chain IDs. Solana: 792703809 per Relay docs.
const CHAIN_IDS: Record<string, number> = {
  base: 8453,
  bnb: 56,
  solana: 792703809,
};

// Origin USDC contract addresses (6 decimals)
const ORIGIN_USDC: Record<string, string> = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  bnb: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
};

// Solana USDC mint (destination)
const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function initFirebase() {
  if (getApps().length > 0) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  let projectId: string | undefined;
  let clientEmail: string | undefined;
  let privateKey: string | undefined;
  if (raw) {
    const sa = JSON.parse(raw);
    projectId = sa.project_id;
    clientEmail = sa.client_email;
    privateKey = sa.private_key?.replace(/\\n/g, "\n");
  }
  projectId = projectId || process.env.FIREBASE_ADMIN_PROJECT_ID;
  clientEmail = clientEmail || process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  privateKey = privateKey || process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase admin credentials not configured");
  }
  initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    initFirebase();
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const token = authHeader.slice(7);
    const decoded = await getAuth().verifyIdToken(token);
    const uid = decoded.uid;

    const body = req.body as { network?: string; amountUsd?: number; recipientSolAddress?: string };
    const network = (body?.network || "").toLowerCase();
    const amountUsd = typeof body?.amountUsd === "number" ? body.amountUsd : parseFloat(body?.amountUsd);
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
