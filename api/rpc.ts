/**
 * GET /api/rpc
 * Proxies Solana RPC so API keys stay server-side.
 * Query: action=sol-balance|usdc-balance|token-accounts, address=<wallet>
 * Env: SOLANATRACKER_RPC_API_KEY, SOLANATRACKER_API_KEY, SOLANA_RPC_URL, or HELIUS_API_KEY
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";

const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

function getRpcSource(): string {
  if (process.env.SOLANATRACKER_RPC_API_KEY) return "solanatracker_rpc";
  if (process.env.SOLANATRACKER_API_KEY) return "solanatracker_api";
  if (process.env.SOLANA_RPC_URL) return "SOLANA_RPC_URL";
  if (process.env.HELIUS_API_KEY) return "helius";
  return "public";
}

function getRpcUrl(): string {
  const solanatrackerRpc = process.env.SOLANATRACKER_RPC_API_KEY;
  if (solanatrackerRpc) {
    return `https://rpc-mainnet.solanatracker.io/?api_key=${solanatrackerRpc}`;
  }
  const solanatrackerApi = process.env.SOLANATRACKER_API_KEY;
  if (solanatrackerApi) {
    return `https://rpc-mainnet.solanatracker.io/?api_key=${solanatrackerApi}`;
  }
  if (process.env.SOLANA_RPC_URL) {
    return process.env.SOLANA_RPC_URL;
  }
  if (process.env.HELIUS_API_KEY) {
    return `https://rpc.helius.xyz/?api-key=${process.env.HELIUS_API_KEY}`;
  }
  return "https://api.mainnet-beta.solana.com";
}

async function rpcRequest<T>(method: string, params: unknown[]): Promise<T> {
  const url = getRpcUrl();
  console.log("[api/rpc] request", { method, paramsCount: params.length });
  const body = {
    jsonrpc: "2.0",
    id: 1,
    method,
    params,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { result?: T; error?: { message: string } };
  if (!res.ok) {
    console.error("[api/rpc] upstream error", { method, status: res.status, message: data?.error?.message });
    throw new Error(data?.error?.message || `RPC error: ${res.status}`);
  }
  if (data.error) {
    console.error("[api/rpc] RPC error response", { method, message: data.error.message });
    throw new Error(data.error.message || "RPC error");
  }
  return data.result as T;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const action = (req.query.action ?? "").toString().toLowerCase();
  const address = (req.query.address ?? "").toString().trim();
  if (!address) {
    res.status(400).json({ error: "Missing address" });
    return;
  }

  const rpcSource = getRpcSource();
  console.log("[api/rpc] start", { action, address: `${address.slice(0, 4)}...${address.slice(-4)}`, rpcSource });

  try {
    if (action === "sol-balance") {
      const result = await rpcRequest<string>("getBalance", [address]);
      const lamports = typeof result === "number" ? result : parseInt(String(result), 10);
      const balance = Number.isFinite(lamports) ? lamports / 1e9 : 0;
      console.log("[api/rpc] ok", { action, balance });
      res.status(200).json({ balance });
      return;
    }

    if (action === "usdc-balance") {
      const result = await rpcRequest<{ value: Array<{ account: { data: unknown } }> }>(
        "getTokenAccountsByOwner",
        [address, { mint: SOLANA_USDC_MINT }, { encoding: "jsonParsed" }]
      );
      let total = 0;
      const value = result?.value ?? [];
      for (const { account } of value) {
        const parsed = (account?.data as { parsed?: { info?: { tokenAmount?: { uiAmount?: number; uiAmountString?: string; amount?: string; decimals?: number } } } })?.parsed?.info?.tokenAmount;
        if (!parsed) continue;
        let uiAmount = parsed.uiAmount ?? 0;
        if (uiAmount === 0 && parsed.uiAmountString != null) {
          const n = parseFloat(parsed.uiAmountString);
          if (Number.isFinite(n)) uiAmount = n;
        }
        if (uiAmount === 0 && parsed.amount != null && parsed.decimals != null) {
          uiAmount = Number(parsed.amount) / Math.pow(10, parsed.decimals);
        }
        total += uiAmount;
      }
      console.log("[api/rpc] ok", { action, balance: total, accountsCount: value.length });
      res.status(200).json({ balance: total });
      return;
    }

    if (action === "token-accounts") {
      const result = await rpcRequest<{ value: Array<{ account: { data: unknown } }> }>(
        "getTokenAccountsByOwner",
        [address, { programId: TOKEN_PROGRAM_ID }, { encoding: "jsonParsed" }]
      );
      const value = result?.value ?? [];
      const accounts = value.map((item) => {
        const parsedInfo = (item.account?.data as { parsed?: { info?: { tokenAmount?: { mint: string; amount: string; decimals: number; uiAmount?: number; uiAmountString?: string } } } })?.parsed?.info;
        const tokenAmount = parsedInfo?.tokenAmount ?? {};
        let uiAmount = tokenAmount.uiAmount ?? 0;
        if (uiAmount === 0 && tokenAmount.uiAmountString != null) {
          const n = parseFloat(tokenAmount.uiAmountString);
          if (Number.isFinite(n)) uiAmount = n;
        }
        if (uiAmount === 0 && tokenAmount.amount != null && tokenAmount.decimals != null) {
          uiAmount = Number(tokenAmount.amount) / Math.pow(10, tokenAmount.decimals);
        }
        return {
          mint: tokenAmount.mint ?? "",
          balance: tokenAmount.amount ?? "0",
          decimals: tokenAmount.decimals ?? 0,
          uiAmount,
        };
      });
      console.log("[api/rpc] ok", { action, accountsCount: accounts.length });
      res.status(200).json({ accounts });
      return;
    }

    res.status(400).json({
      error: "Invalid action",
      message: "Use action=sol-balance, usdc-balance, or token-accounts",
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "RPC request failed";
    console.error("[api/rpc]", action, message);
    res.status(502).json({ error: message });
  }
}
