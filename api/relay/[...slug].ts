// Single file for all relay routes (Vercel counts each api/*.ts as a function).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { Keypair, VersionedTransaction, Connection } from "@solana/web3.js";
import { HDNodeWallet, JsonRpcProvider, Contract } from "ethers";

// --- constants ---
const RELAY_API_BASE = process.env.RELAY_API_BASE || "https://api.relay.link";
const CHAIN_IDS: Record<string, number> = {
  base: 8453,
  bnb: 56,
  solana: 792703809,
};
const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const ORIGIN_USDC: Record<string, string> = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  bnb: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
};
const DESTINATION_USDC: Record<string, string> = {
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  bnb: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
  solana: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
};
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BNB_USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const ETH_DERIVATION_PATH = "m/44'/60'/0'/0/0";
const ERC20_ABI = ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"];
const RELAY_CHAIN_IDS: Record<number, string> = { 792703809: "solana", 8453: "base", 56: "bnb" };
const COINGECKO_API_BASE = "https://api.coingecko.com/api/v3/onchain";
const CHAIN_TO_NETWORK: Record<string, string> = { solana: "solana", base: "base", bnb: "bsc" };

function ensureFirebase() {
  if (getApps().length > 0) return;
  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  let projectId: string | undefined;
  let clientEmail: string | undefined;
  let privateKey: string | undefined;
  if (rawServiceAccount) {
    const sa = JSON.parse(rawServiceAccount);
    projectId = sa.project_id;
    clientEmail = sa.client_email;
    privateKey = sa.private_key?.replace(/\\n/g, "\n");
  }
  projectId = projectId || process.env.FIREBASE_ADMIN_PROJECT_ID;
  clientEmail = clientEmail || process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  if (!privateKey && process.env.FIREBASE_ADMIN_PRIVATE_KEY) {
    privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY.replace(/\\n/g, "\n");
  }
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase admin credentials are not fully configured");
  }
  initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

function getAdminAuth() {
  ensureFirebase();
  return getAuth();
}

function getAdminDb() {
  ensureFirebase();
  return getFirestore();
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(password), { name: "PBKDF2" }, false, ["deriveBits", "deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: new Uint8Array(salt), iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function decrypt(encryptedData: string, password: string): Promise<string> {
  const combined = new Uint8Array(Buffer.from(encryptedData, "base64"));
  const salt = combined.slice(0, 16);
  const iv = combined.slice(16, 28);
  const encrypted = combined.slice(28);
  const key = await deriveKey(password, salt);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);
  return new TextDecoder().decode(decrypted);
}

async function decryptWalletCredentials(
  userId: string,
  encryptedMnemonic: string | undefined,
  encryptedSecretKey: string,
  encryptionSecret: string
): Promise<{ mnemonic?: string; secretKey: Uint8Array }> {
  const key = `${userId}:${encryptionSecret}`;
  const secretKeyStr = await decrypt(encryptedSecretKey, key);
  const secretKey = new Uint8Array(JSON.parse(secretKeyStr) as number[]);
  let mnemonic: string | undefined;
  if (encryptedMnemonic) mnemonic = await decrypt(encryptedMnemonic, key);
  return { mnemonic, secretKey };
}

function getRpcUrl(): string {
  if (process.env.SOLANA_RPC_URL) return process.env.SOLANA_RPC_URL;
  const helius = process.env.HELIUS_API_KEY;
  if (helius) return `https://mainnet.helius-rpc.com/?api-key=${helius}`;
  return "https://api.mainnet-beta.solana.com";
}

async function getEvmBalances(address: string): Promise<{ base: { usdc: number; native: number }; bnb: { usdc: number; native: number } }> {
  const result = { base: { usdc: 0, native: 0 }, bnb: { usdc: 0, native: 0 } };
  try {
    const baseProvider = new JsonRpcProvider(process.env.BASE_RPC_URL || "https://mainnet.base.org");
    const [baseNative, baseUsdcRaw] = await Promise.all([
      baseProvider.getBalance(address),
      new Contract(BASE_USDC, ERC20_ABI, baseProvider).balanceOf(address),
    ]);
    result.base.native = Number(baseNative) / 1e18;
    result.base.usdc = Number(baseUsdcRaw) / 1e6;
  } catch (e) {
    console.warn("Base balance fetch failed:", e);
  }
  try {
    const bnbProvider = new JsonRpcProvider(process.env.BNB_RPC_URL || "https://bsc-dataseed.binance.org");
    const [bnbNative, bnbUsdcRaw] = await Promise.all([
      bnbProvider.getBalance(address),
      new Contract(BNB_USDC, ERC20_ABI, bnbProvider).balanceOf(address),
    ]);
    result.bnb.native = Number(bnbNative) / 1e18;
    result.bnb.usdc = Number(bnbUsdcRaw) / 1e6;
  } catch (e) {
    console.warn("BNB balance fetch failed:", e);
  }
  return result;
}

async function depositQuoteHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    ensureFirebase();
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
    await getAdminAuth().verifyIdToken(authHeader.slice(7));
    const body = req.body as { network?: string; amountUsd?: number; recipientSolAddress?: string };
    const network = (body?.network || "").toLowerCase();
    const amountUsd = typeof body?.amountUsd === "number" ? body.amountUsd : parseFloat(String(body?.amountUsd ?? ""));
    const recipientSolAddress = typeof body?.recipientSolAddress === "string" ? body.recipientSolAddress.trim() : "";
    if (network !== "base" && network !== "bnb") return res.status(400).json({ error: "Invalid network; use base or bnb" });
    if (!Number.isFinite(amountUsd) || amountUsd <= 0 || amountUsd > 1_000_000) return res.status(400).json({ error: "Invalid amountUsd" });
    if (!recipientSolAddress || recipientSolAddress.length < 32) return res.status(400).json({ error: "Invalid recipientSolAddress" });
    const originChainId = CHAIN_IDS[network] ?? (network === "base" ? 8453 : 56);
    const amountRaw = Math.floor(amountUsd * 1e6).toString();
    const apiKey = process.env.RELAY_API_KEY;
    const quoteRes = await fetch(`${RELAY_API_BASE}/quote/v2`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey && { "x-api-key": apiKey }) },
      body: JSON.stringify({
        user: "0x0000000000000000000000000000000000000000",
        originChainId,
        destinationChainId: CHAIN_IDS.solana,
        originCurrency: ORIGIN_USDC[network],
        destinationCurrency: SOLANA_USDC_MINT,
        amount: amountRaw,
        tradeType: "EXACT_INPUT",
        recipient: recipientSolAddress,
        useDepositAddress: true,
        refundTo: undefined,
      }),
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
    return res.status(500).json({ error: e instanceof Error ? e.message : "Internal server error" });
  }
}

async function swapQuoteHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    ensureFirebase();
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
    await getAdminAuth().verifyIdToken(authHeader.slice(7));
    const body = req.body as { inputMint?: string; outputMint?: string; amount?: string; slippageBps?: number; userWallet?: string; outputChainId?: number; outputChain?: string; recipient?: string };
    const inputMint = (body?.inputMint || "").trim();
    const outputMint = (body?.outputMint || "").trim();
    const amount = body?.amount ?? "";
    const slippageBps = typeof body?.slippageBps === "number" ? body.slippageBps : 100;
    const userWallet = (body?.userWallet || "").trim();
    let destinationChainId = CHAIN_IDS.solana;
    if (typeof body?.outputChainId === "number") destinationChainId = body.outputChainId;
    else if (body?.outputChain) destinationChainId = CHAIN_IDS[(body.outputChain as string).toLowerCase()] ?? destinationChainId;
    if (!inputMint || !outputMint || !amount || !userWallet) return res.status(400).json({ error: "Missing inputMint, outputMint, amount, or userWallet" });
    const apiKey = process.env.RELAY_API_KEY;
    const recipient = body?.recipient?.trim() || userWallet;
    const quoteRes = await fetch(`${RELAY_API_BASE}/quote/v2`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey && { "x-api-key": apiKey }) },
      body: JSON.stringify({
        user: userWallet,
        originChainId: CHAIN_IDS.solana,
        destinationChainId,
        originCurrency: inputMint,
        destinationCurrency: outputMint,
        amount,
        tradeType: "EXACT_INPUT",
        recipient,
        slippageTolerance: String(slippageBps),
      }),
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
    return res.status(500).json({ error: e instanceof Error ? e.message : "Internal server error" });
  }
}

async function withdrawQuoteHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    ensureFirebase();
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
    await getAdminAuth().verifyIdToken(authHeader.slice(7));
    const body = req.body as { destinationNetwork?: string; amount?: number; destinationAddress?: string; originAddress?: string };
    const destinationNetwork = (body?.destinationNetwork || "").toLowerCase();
    const amount = typeof body?.amount === "number" ? body.amount : parseFloat(String(body?.amount || "0"));
    const destinationAddress = (body?.destinationAddress || "").trim();
    const originAddress = (body?.originAddress || "").trim();
    if (destinationNetwork !== "base" && destinationNetwork !== "bnb" && destinationNetwork !== "solana") return res.status(400).json({ error: "Invalid destinationNetwork; use base, bnb, or solana" });
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "Invalid amount" });
    if (!destinationAddress || destinationAddress.length < 20) return res.status(400).json({ error: "Invalid destinationAddress" });
    const apiKey = process.env.RELAY_API_KEY;
    const destinationChainId = CHAIN_IDS[destinationNetwork] ?? CHAIN_IDS.base;
    const destinationCurrency = destinationNetwork === "solana" ? SOLANA_USDC_MINT : (DESTINATION_USDC[destinationNetwork] || DESTINATION_USDC.base);
    const amountRaw = Math.floor(amount * 1e6).toString();
    const quoteRes = await fetch(`${RELAY_API_BASE}/quote/v2`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(apiKey && { "x-api-key": apiKey }) },
      body: JSON.stringify({
        user: originAddress || "0x0000000000000000000000000000000000000000",
        originChainId: CHAIN_IDS.solana,
        destinationChainId,
        originCurrency: SOLANA_USDC_MINT,
        destinationCurrency,
        amount: amountRaw,
        tradeType: "EXACT_INPUT",
        recipient: destinationAddress,
      }),
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
    return res.status(500).json({ error: e instanceof Error ? e.message : "Internal server error" });
  }
}

async function executeStepHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    ensureFirebase();
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
    const decoded = await getAdminAuth().verifyIdToken(authHeader.slice(7));
    const userId = decoded.uid;
    const body = req.body as { quoteResponse?: unknown; stepIndex?: number };
    const quoteResponse = body?.quoteResponse;
    const stepIndex = typeof body?.stepIndex === "number" ? body.stepIndex : 0;
    if (!quoteResponse || typeof quoteResponse !== "object") return res.status(400).json({ error: "Missing quoteResponse" });
    const quote = quoteResponse as { steps?: Array<{ items?: Array<{ data?: unknown }> }> };
    const steps = quote?.steps;
    if (!Array.isArray(steps) || !steps[stepIndex]) return res.status(400).json({ error: "Invalid step index or steps" });
    const firstItem = steps[stepIndex]?.items?.[0];
    const data = firstItem?.data;
    if (!data) return res.status(400).json({ error: "No step data to execute" });
    const encryptionSecret = process.env.ENCRYPTION_SECRET;
    if (!encryptionSecret) return res.status(503).json({ error: "ENCRYPTION_SECRET not configured" });
    const db = getAdminDb();
    const userSnap = await db.collection("users").doc(userId).get();
    const userData = userSnap.data();
    const encryptedSecretKey = userData?.encryptedSecretKey;
    const encryptedMnemonic = userData?.encryptedMnemonic;
    if (!encryptedSecretKey) return res.status(400).json({ error: "Wallet credentials not found" });
    const { secretKey } = await decryptWalletCredentials(userId, encryptedMnemonic, encryptedSecretKey, encryptionSecret);
    const wallet = Keypair.fromSecretKey(secretKey);
    let serializedTx: string | null = null;
    if (typeof data === "string") serializedTx = data;
    else if (data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      if (typeof d.serializedTransaction === "string") serializedTx = d.serializedTransaction;
      else if (typeof d.transaction === "string") serializedTx = d.transaction;
      else if (typeof d.payload === "string") serializedTx = d.payload;
      else if (typeof d.transactionBytes === "string") serializedTx = d.transactionBytes;
    }
    if (!serializedTx) return res.status(400).json({ error: "Step data does not contain Solana transaction" });
    const txBuffer = Buffer.from(serializedTx, "base64");
    const transaction = VersionedTransaction.deserialize(txBuffer);
    transaction.sign([wallet]);
    const signedSerialized = Buffer.from(transaction.serialize()).toString("base64");
    const connection = new Connection(getRpcUrl());
    const sig = await connection.sendRawTransaction(Buffer.from(signedSerialized, "base64"), { skipPreflight: false, preflightCommitment: "confirmed" });
    return res.status(200).json({ signature: sig, status: "Success" });
  } catch (e: unknown) {
    console.error("execute-step error:", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : "Internal server error", signature: "", status: "Failed" });
  }
}

async function evmAddressHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    ensureFirebase();
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
    const decoded = await getAdminAuth().verifyIdToken(authHeader.slice(7));
    const userId = decoded.uid;
    const encryptionSecret = process.env.ENCRYPTION_SECRET;
    if (!encryptionSecret) return res.status(503).json({ error: "ENCRYPTION_SECRET not configured" });
    const db = getAdminDb();
    const userSnap = await db.collection("users").doc(userId).get();
    const userData = userSnap.data();
    const encryptedSecretKey = userData?.encryptedSecretKey;
    const encryptedMnemonic = userData?.encryptedMnemonic;
    if (!encryptedSecretKey) return res.status(400).json({ error: "Wallet credentials not found" });
    const { mnemonic } = await decryptWalletCredentials(userId, encryptedMnemonic, encryptedSecretKey, encryptionSecret);
    if (!mnemonic || !mnemonic.trim()) return res.status(200).json({ evmAddress: null });
    const wallet = HDNodeWallet.fromPhrase(mnemonic.trim(), undefined, ETH_DERIVATION_PATH);
    return res.status(200).json({ evmAddress: wallet.address });
  } catch (e: unknown) {
    console.error("evm-address error:", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : "Internal server error" });
  }
}

async function evmBalancesHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    ensureFirebase();
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Unauthorized" });
    const decoded = await getAdminAuth().verifyIdToken(authHeader.slice(7));
    const userId = decoded.uid;
    const encryptionSecret = process.env.ENCRYPTION_SECRET;
    if (!encryptionSecret) return res.status(503).json({ error: "ENCRYPTION_SECRET not configured" });
    const db = getAdminDb();
    const userSnap = await db.collection("users").doc(userId).get();
    const userData = userSnap.data();
    const encryptedSecretKey = userData?.encryptedSecretKey;
    const encryptedMnemonic = userData?.encryptedMnemonic;
    if (!encryptedSecretKey) return res.status(200).json({ evmAddress: null, base: { usdc: 0, native: 0 }, bnb: { usdc: 0, native: 0 } });
    const { mnemonic } = await decryptWalletCredentials(userId, encryptedMnemonic, encryptedSecretKey, encryptionSecret);
    if (!mnemonic || !mnemonic.trim()) return res.status(200).json({ evmAddress: null, base: { usdc: 0, native: 0 }, bnb: { usdc: 0, native: 0 } });
    const wallet = HDNodeWallet.fromPhrase(mnemonic.trim(), undefined, ETH_DERIVATION_PATH);
    const balances = await getEvmBalances(wallet.address);
    return res.status(200).json({ evmAddress: wallet.address, base: balances.base, bnb: balances.bnb });
  } catch (e: unknown) {
    console.error("evm-balances error:", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : "Internal server error" });
  }
}

async function currenciesHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const apiKey = process.env.RELAY_API_KEY;
    const body = req.method === "POST" ? req.body : {};
    const query = req.query || {};
    const term = (body.term ?? query.term ?? "").toString().trim();
    const tokensParam = body.tokens ?? query.tokens;
    const chainIdsParam = body.chainIds ?? query.chainIds;
    const limit = Math.min(Math.max(1, parseInt(String(body.limit ?? query.limit ?? "20"), 10) || 20), 50);
    const verified = body.verified ?? query.verified;
    const relayParams: Record<string, unknown> = { limit, useExternalSearch: true };
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
      headers: { "Content-Type": "application/json", ...(apiKey && { "x-api-key": apiKey }) },
      body: JSON.stringify(relayParams),
    });
    if (relayRes.status === 404 || relayRes.status === 405) {
      const getUrl = new URL(`${RELAY_API_BASE}/currencies/v2`);
      if (term) getUrl.searchParams.set("term", term);
      getUrl.searchParams.set("limit", String(limit));
      relayRes = await fetch(getUrl.toString(), { headers: apiKey ? { "x-api-key": apiKey } : {} });
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
    const list = Array.isArray(data) ? data : (data as { currencies?: unknown[]; data?: unknown[] })?.currencies ?? (data as { currencies?: unknown[]; data?: unknown[] })?.data ?? [];
    const SUPPORTED_CHAIN_IDS = new Set([792703809, 8453, 56]);
    type RelayItem = { chainId?: number; address?: string; symbol?: string; name?: string; decimals?: number; metadata?: { logoURI?: string; verified?: boolean } };
    const normalized = (list as RelayItem[])
      .filter((c) => c.chainId != null && SUPPORTED_CHAIN_IDS.has(c.chainId))
      .map((c) => ({
        chainId: c.chainId!,
        chain: RELAY_CHAIN_IDS[c.chainId!] ?? "solana",
        address: c.address ?? "",
        symbol: c.symbol ?? "",
        name: c.name ?? "",
        decimals: typeof c.decimals === "number" ? c.decimals : 6,
        logoURI: c.metadata?.logoURI,
        verified: c.metadata?.verified,
      }));
    return res.status(200).json({ raw: data, currencies: normalized });
  } catch (e: unknown) {
    console.error("currencies error:", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : "Internal server error" });
  }
}

async function coingeckoTokensHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const apiKey = process.env.COINGECKO_API_KEY;
    const query = req.query || {};
    const networkParam = (query.network ?? "").toString().trim().toLowerCase();
    const addressesParam = (query.addresses ?? "").toString().trim();
    const network = (CHAIN_TO_NETWORK[networkParam] ?? networkParam) || "solana";
    if (!addressesParam) return res.status(400).json({ error: "Missing addresses (comma-separated token addresses)" });
    const addresses = addressesParam.split(",").map((a) => a.trim()).filter(Boolean);
    if (addresses.length === 0) return res.status(400).json({ error: "At least one token address is required" });
    if (addresses.length > 30) return res.status(400).json({ error: "Maximum 30 addresses per request" });
    const url = new URL(`${COINGECKO_API_BASE}/networks/${network}/tokens/multi/${addresses.join(",")}`);
    url.searchParams.set("include", "top_pools");
    url.searchParams.set("include_composition", "true");
    url.searchParams.set("include_inactive_source", "true");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["x-cg-demo-api-key"] = apiKey;
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
    return res.status(500).json({ error: e instanceof Error ? e.message : "Internal server error" });
  }
}

const ROUTES: Record<string, (req: VercelRequest, res: VercelResponse) => Promise<void | VercelResponse>> = {
  "deposit-quote": depositQuoteHandler,
  "swap-quote": swapQuoteHandler,
  "withdraw-quote": withdrawQuoteHandler,
  "execute-step": executeStepHandler,
  "evm-address": evmAddressHandler,
  "evm-balances": evmBalancesHandler,
  currencies: currenciesHandler,
  "coingecko-tokens": coingeckoTokensHandler,
};

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const path = (req.url ?? "").split("?")[0];
  const segments = path.split("/").filter(Boolean);
  const action = segments[segments.length - 1];
  const routeHandler = action ? ROUTES[action] : undefined;
  if (!routeHandler) {
    res.status(404).json({
      error: "Not found",
      message: `Relay action '${action || ""}' not found. Use one of: ${Object.keys(ROUTES).join(", ")}`,
    });
    return;
  }
  await routeHandler(req, res);
}
