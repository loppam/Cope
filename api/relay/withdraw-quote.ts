import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAuth } from "firebase-admin/auth";
import { getApps, initializeApp, cert } from "firebase-admin/app";

const RELAY_API_BASE = process.env.RELAY_API_BASE || "https://api.relay.link";

const CHAIN_IDS: Record<string, number> = {
  base: 8453,
  bnb: 56,
  solana: 792703809,
};

const DESTINATION_USDC: Record<string, string> = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  bnb: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
};

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
    await getAuth().verifyIdToken(authHeader.slice(7));

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
