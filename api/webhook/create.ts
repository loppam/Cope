// Vercel Serverless Function: Create/Update Helius webhook for watched wallets
import type { VercelRequest, VercelResponse } from "@vercel/node";

// Helius webhook API (documented: https://docs.helius.dev/api-reference/webhooks)
const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const HELIUS_API_URL = "https://api-mainnet.helius-rpc.com/v0/webhooks";

/** Transaction types we subscribe to: BUY, SELL, SWAP only. */
const WEBHOOK_TRANSACTION_TYPES = ["BUY", "SELL", "SWAP"] as const;

/**
 * Create or update a Helius webhook for monitoring wallet addresses
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { accountAddresses, webhookId } = req.body;

    if (
      !accountAddresses ||
      !Array.isArray(accountAddresses) ||
      accountAddresses.length === 0
    ) {
      return res
        .status(400)
        .json({ error: "accountAddresses array is required" });
    }

    if (!HELIUS_API_KEY) {
      return res.status(500).json({ error: "HELIUS_API_KEY not configured" });
    }

    // Get webhook URL (your Vercel function URL)
    const webhookURL =
      process.env.WEBHOOK_URL ||
      `${req.headers.origin || "https://your-domain.vercel.app"}/api/webhook/transaction`;

    // If webhookId is provided, update existing webhook (PUT /v0/webhooks/{webhookID} per Helius docs)
    if (webhookId) {
      const updateResponse = await fetch(
        `${HELIUS_API_URL}/${webhookId}?api-key=${HELIUS_API_KEY}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            webhookURL:
              process.env.WEBHOOK_URL ||
              `${req.headers.origin || "https://your-domain.vercel.app"}/api/webhook/transaction`,
            transactionTypes: WEBHOOK_TRANSACTION_TYPES,
            accountAddresses,
            webhookType: "enhanced",
            ...(process.env.HELIUS_WEBHOOK_SECRET && {
              authHeader: process.env.HELIUS_WEBHOOK_SECRET,
            }),
          }),
        },
      );

      if (!updateResponse.ok) {
        const error = await updateResponse.text();
        throw new Error(`Failed to update webhook: ${error}`);
      }

      const data = await updateResponse.json();
      return res.status(200).json({ success: true, webhookId: data.webhookID });
    }

    // Create new webhook
    const createResponse = await fetch(
      `${HELIUS_API_URL}?api-key=${HELIUS_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          webhookURL,
          transactionTypes: WEBHOOK_TRANSACTION_TYPES,
          accountAddresses,
          webhookType: "enhanced",
          ...(process.env.HELIUS_WEBHOOK_SECRET && {
            authHeader: process.env.HELIUS_WEBHOOK_SECRET,
          }),
        }),
      },
    );

    if (!createResponse.ok) {
      const error = await createResponse.text();
      throw new Error(`Failed to create webhook: ${error}`);
    }

    const data = await createResponse.json();
    return res.status(200).json({ success: true, webhookId: data.webhookID });
  } catch (error: any) {
    console.error("Webhook creation error:", error);
    return res
      .status(500)
      .json({ error: error.message || "Internal server error" });
  }
}
