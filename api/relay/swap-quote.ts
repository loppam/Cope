import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAuth } from "firebase-admin/auth";
import { getApps, initializeApp, cert } from "firebase-admin/app";

const RELAY_API_BASE = process.env.RELAY_API_BASE || "https://api.relay.link";

const SOLANA_CHAIN_ID = 792703809;
const CHAIN_IDS: Record<string, number> = {
  solana: 792703809,
  base: 8453,
  bnb: 56,
};
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

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
    const tradeType = body?.tradeType || "buy";
    let destinationChainId = SOLANA_CHAIN_ID;
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
    const originChainId = SOLANA_CHAIN_ID;

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
