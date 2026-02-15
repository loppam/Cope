// Single file for all relay routes (Vercel counts each api/*.ts as a function).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { initializeApp, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  Contract,
  HDNodeWallet,
  JsonRpcProvider,
  Wallet,
  type TransactionRequest,
} from "ethers";
import bs58 from "bs58";

// Inlined to avoid Vercel ERR_MODULE_NOT_FOUND for api/lib/evm-balance
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BNB_USDC = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
] as const;
const NATIVE_ETH_PLACEHOLDER = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

async function getEvmBalances(address: string): Promise<{
  base: { usdc: number; native: number };
  bnb: { usdc: number; native: number };
}> {
  const result = { base: { usdc: 0, native: 0 }, bnb: { usdc: 0, native: 0 } };
  try {
    const baseProvider = new JsonRpcProvider(
      process.env.BASE_RPC_URL || "https://mainnet.base.org",
    );
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
    const bnbProvider = new JsonRpcProvider(
      process.env.BNB_RPC_URL || "https://bsc-dataseed.binance.org",
    );
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

type EvmTokenPosition = {
  mint: string;
  symbol: string;
  name: string;
  amount: number;
  value: number;
  chain: "base" | "bnb";
  image?: string;
  decimals: number;
};

async function getEvmTokenPositions(address: string): Promise<EvmTokenPosition[]> {
  const apiKey = process.env.MORALIS_API_KEY;
  if (!apiKey) return [];

  const tokens: EvmTokenPosition[] = [];
  const chains: Array<{ chain: "base" | "bnb"; param: string }> = [
    { chain: "base", param: "base" },
    { chain: "bnb", param: "bsc" },
  ];

  await Promise.all(
    chains.map(async ({ chain, param }) => {
      try {
        const url = `https://deep-index.moralis.io/api/v2.2/wallets/${address}/tokens?chain=${param}&limit=100&exclude_spam=true`;
        const res = await fetch(url, {
          headers: { accept: "application/json", "X-API-Key": apiKey },
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          result?: Array<{
            token_address?: string;
            name?: string;
            symbol?: string;
            logo?: string;
            decimals?: number;
            balance?: string;
            balance_formatted?: string;
            usd_value?: number;
            native_token?: boolean;
          }>;
        };
        const list = Array.isArray(data?.result) ? data.result : [];
        for (const t of list) {
          const bal = parseFloat(t.balance_formatted ?? t.balance ?? "0");
          const value = t.usd_value ?? 0;
          if (bal <= 0 && value <= 0) continue;

          const addr = (t.token_address ?? "").toLowerCase();
          const isNative = t.native_token || !addr || addr === NATIVE_ETH_PLACEHOLDER;
          const mint = isNative ? (chain === "base" ? "base-eth" : "bnb-bnb") : addr;

          tokens.push({
            mint,
            symbol: (t.symbol ?? (chain === "base" ? "ETH" : "BNB")).toUpperCase(),
            name: t.name ?? (chain === "base" ? "Ethereum (Base)" : "BNB"),
            amount: bal,
            value,
            chain,
            image: t.logo,
            decimals: typeof t.decimals === "number" ? t.decimals : 18,
          });
        }
      } catch (e) {
        console.warn(`Moralis token fetch failed for ${chain}:`, e);
      }
    }),
  );

  return tokens;
}

// Inlined to avoid Vercel ERR_MODULE_NOT_FOUND for api/lib/decrypt
async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: new Uint8Array(salt), iterations: 100000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
async function decryptAes(encryptedData: string, password: string): Promise<string> {
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
  encryptionSecret: string,
): Promise<{ mnemonic?: string; secretKey: Uint8Array }> {
  const key = `${userId}:${encryptionSecret}`;
  const secretKeyStr = await decryptAes(encryptedSecretKey, key);
  const secretKey = new Uint8Array(JSON.parse(secretKeyStr) as number[]);
  let mnemonic: string | undefined;
  if (encryptedMnemonic) mnemonic = await decryptAes(encryptedMnemonic, key);
  return { mnemonic, secretKey };
}

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
const ETH_DERIVATION_PATH = "m/44'/60'/0'/0/0";
const RELAY_CHAIN_IDS: Record<number, string> = {
  792703809: "solana",
  8453: "base",
  56: "bnb",
};
const COINGECKO_API_BASE = "https://api.coingecko.com/api/v3/onchain";
const CHAIN_TO_NETWORK: Record<string, string> = {
  solana: "solana",
  base: "base",
  bnb: "bsc",
};

const APP_FEE_BPS = "100";
const DEFAULT_APP_FEE_RECIPIENT = "0x90554A05862879c77e64d154e0A4Eb92e48eC384";

const SOL_FUNDER_AMOUNT_LAMPORTS = 5_000_000; // 0.005 SOL for new wallets and top-ups

function getAppFees(): { recipient: string; fee: string }[] {
  const env = process.env.RELAY_APP_FEE_RECIPIENT?.trim();
  const recipient =
    env && /^0x[a-fA-F0-9]{40}$/.test(env) ? env : DEFAULT_APP_FEE_RECIPIENT;
  return [{ recipient, fee: APP_FEE_BPS }];
}

const ALCHEMY_UPDATE_WEBHOOK_URL =
  "https://dashboard.alchemy.com/api/update-webhook-addresses";

/** Fire-and-forget: add custodial evm address to both Alchemy webhooks (Base + BNB) so deposits trigger evm-deposit. */
function addEvmAddressToAlchemyWebhooks(addr: string): void {
  // Notify API requires Auth Token from Dashboard → Data → Webhooks → AUTH TOKEN (app API Key can 401)
  const apiKey =
    process.env.ALCHEMY_NOTIFY_AUTH_TOKEN || process.env.ALCHEMY_API_KEY;
  const webhookIdBase = process.env.ALCHEMY_EVM_DEPOSIT_WEBHOOK_ID_BASE;
  const webhookIdBnb = process.env.ALCHEMY_EVM_DEPOSIT_WEBHOOK_ID_BNB;
  if (!apiKey || !webhookIdBase || !webhookIdBnb) return;
  const low = addr.toLowerCase();
  const body = (id: string) =>
    JSON.stringify({
      webhook_id: id,
      addresses_to_add: [low],
      addresses_to_remove: [],
    });
  const opts = {
    method: "PATCH" as const,
    headers: { "Content-Type": "application/json", "X-Alchemy-Token": apiKey },
  };
  Promise.all([
    fetch(ALCHEMY_UPDATE_WEBHOOK_URL, { ...opts, body: body(webhookIdBase) }),
    fetch(ALCHEMY_UPDATE_WEBHOOK_URL, { ...opts, body: body(webhookIdBnb) }),
  ]).catch((e) => console.warn("Alchemy webhook address add failed:", e));
}

/** Fire-and-forget: remove custodial evm address from both Alchemy webhooks (e.g. when user removes wallet or deletes account). */
function removeEvmAddressFromAlchemyWebhooks(addr: string): void {
  const apiKey =
    process.env.ALCHEMY_NOTIFY_AUTH_TOKEN || process.env.ALCHEMY_API_KEY;
  const webhookIdBase = process.env.ALCHEMY_EVM_DEPOSIT_WEBHOOK_ID_BASE;
  const webhookIdBnb = process.env.ALCHEMY_EVM_DEPOSIT_WEBHOOK_ID_BNB;
  if (!apiKey || !webhookIdBase || !webhookIdBnb) return;
  const low = addr.toLowerCase();
  const body = (id: string) =>
    JSON.stringify({
      webhook_id: id,
      addresses_to_add: [],
      addresses_to_remove: [low],
    });
  const opts = {
    method: "PATCH" as const,
    headers: { "Content-Type": "application/json", "X-Alchemy-Token": apiKey },
  };
  Promise.all([
    fetch(ALCHEMY_UPDATE_WEBHOOK_URL, { ...opts, body: body(webhookIdBase) }),
    fetch(ALCHEMY_UPDATE_WEBHOOK_URL, { ...opts, body: body(webhookIdBnb) }),
  ]).catch((e) => console.warn("Alchemy webhook address remove failed:", e));
}

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

function getRpcUrl(): string {
  if (process.env.SOLANA_RPC_URL) return process.env.SOLANA_RPC_URL;
  const helius = process.env.HELIUS_API_KEY;
  if (helius) return `https://mainnet.helius-rpc.com/?api-key=${helius}`;
  return "https://api.mainnet-beta.solana.com";
}

function getFunderKeypair(): Keypair | null {
  const raw = process.env.FUNDER_PRIVATE_KEY;
  if (!raw || typeof raw !== "string" || raw.trim() === "") return null;
  try {
    const secret = bs58.decode(raw.trim());
    return Keypair.fromSecretKey(secret);
  } catch {
    return null;
  }
}

async function sendSolFromFunder(
  destination: string,
  lamports: number,
): Promise<string | null> {
  const funder = getFunderKeypair();
  if (!funder) return null;
  const connection = new Connection(getRpcUrl(), "confirmed");
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: funder.publicKey,
      toPubkey: new PublicKey(destination),
      lamports,
    }),
  );
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = funder.publicKey;
  tx.sign(funder);
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction({
    signature: sig,
    blockhash,
    lastValidBlockHeight,
  });
  return sig;
}

// EVM funder: top-up amounts per chain (gas reserve)
const EVM_FUNDER_BASE_WEI = BigInt(5e14);  // 0.0005 ETH
const EVM_FUNDER_BNB_WEI = BigInt(1e15);   // 0.001 BNB

function getEvmFunderWallet(chainId: number): Wallet | null {
  const raw = process.env.EVM_FUNDER_PRIVATE_KEY;
  if (!raw || typeof raw !== "string" || raw.trim() === "") return null;
  try {
    const key = raw.trim().startsWith("0x") ? raw.trim() : `0x${raw.trim()}`;
    const provider = getEvmProvider(chainId);
    return new Wallet(key, provider);
  } catch {
    return null;
  }
}

async function sendNativeFromEvmFunder(
  toAddress: string,
  amountWei: bigint,
  chainId: number,
): Promise<string | null> {
  const funder = getEvmFunderWallet(chainId);
  if (!funder) return null;
  try {
    const tx = await funder.sendTransaction({
      to: toAddress,
      value: amountWei,
      chainId,
    });
    await tx.wait();
    return tx.hash;
  } catch (e) {
    console.warn("[sendNativeFromEvmFunder]", e);
    return null;
  }
}

async function depositQuoteHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });
  try {
    ensureFirebase();
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer "))
      return res.status(401).json({ error: "Unauthorized" });
    await getAdminAuth().verifyIdToken(authHeader.slice(7));
    const body = req.body as {
      network?: string;
      amountUsd?: number;
      recipientSolAddress?: string;
    };
    const network = (body?.network || "").toLowerCase();
    const amountUsd =
      typeof body?.amountUsd === "number"
        ? body.amountUsd
        : parseFloat(String(body?.amountUsd ?? ""));
    const recipientSolAddress =
      typeof body?.recipientSolAddress === "string"
        ? body.recipientSolAddress.trim()
        : "";
    if (network !== "base" && network !== "bnb")
      return res
        .status(400)
        .json({ error: "Invalid network; use base or bnb" });
    if (!Number.isFinite(amountUsd) || amountUsd <= 0 || amountUsd > 1_000_000)
      return res.status(400).json({ error: "Invalid amountUsd" });
    if (!recipientSolAddress || recipientSolAddress.length < 32)
      return res.status(400).json({ error: "Invalid recipientSolAddress" });
    const originChainId =
      CHAIN_IDS[network] ?? (network === "base" ? 8453 : 56);
    const amountRaw = Math.floor(amountUsd * 1e6).toString();
    const apiKey = process.env.RELAY_API_KEY;
    const quoteRes = await fetch(`${RELAY_API_BASE}/quote/v2`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey && { "x-api-key": apiKey }),
      },
      body: JSON.stringify({
        user: "0x03508bb71268bba25ecacc8f620e01866650532c",
        originChainId,
        destinationChainId: CHAIN_IDS.solana,
        originCurrency: ORIGIN_USDC[network],
        destinationCurrency: SOLANA_USDC_MINT,
        amount: amountRaw,
        tradeType: "EXACT_INPUT",
        recipient: recipientSolAddress,
        useDepositAddress: true,
        refundTo: undefined,
        appFees: getAppFees(),
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
      return res
        .status(quoteRes.status >= 500 ? 502 : 400)
        .json({ error: message });
    }
    const quote = await quoteRes.json();
    const steps = quote?.steps || [];
    const firstStep = steps[0];
    const depositAddress =
      firstStep?.depositAddress || firstStep?.items?.[0]?.data?.to;
    const requestId = firstStep?.requestId || quote?.protocol?.v2?.orderId;
    const details = quote?.details;
    const currencyOut = details?.currencyOut;
    const amountFormatted =
      currencyOut?.amountFormatted ?? amountUsd.toFixed(2);
    const amountOut =
      currencyOut?.amount != null ? String(currencyOut.amount) : amountRaw;
    return res.status(200).json({
      depositAddress: depositAddress || null,
      amount: amountOut,
      amountFormatted,
      requestId: requestId || null,
      currency: "USDC",
      network,
      details: details
        ? {
            currencyIn: details.currencyIn,
            currencyOut: details.currencyOut,
            fees: quote.fees,
          }
        : undefined,
    });
  } catch (e: unknown) {
    console.error("deposit-quote error:", e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : "Internal server error",
    });
  }
}

async function swapQuoteHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });
  try {
    ensureFirebase();
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer "))
      return res.status(401).json({ error: "Unauthorized" });
    const decoded = await getAdminAuth().verifyIdToken(authHeader.slice(7));
    const userId = decoded?.uid ?? "unknown";
    const body = req.body as {
      inputMint?: string;
      outputMint?: string;
      amount?: string;
      slippageBps?: number;
      userWallet?: string;
      outputChainId?: number;
      outputChain?: string;
      inputChainId?: number;
      inputChain?: string;
      recipient?: string;
    };
    const inputMint = (body?.inputMint || "").trim();
    const outputMint = (body?.outputMint || "").trim();
    const amount = body?.amount ?? "";
    const slippageBps =
      typeof body?.slippageBps === "number" ? body.slippageBps : 100;
    const userWallet = (body?.userWallet || "").trim();
    // Trade Terminal: BUY = SOL USDC (Solana) → any token; SELL = any token → SOL USDC (Solana).
    // So: BUY → origin Solana, destination = token chain; SELL → origin = token chain, destination Solana.
    const tradeDir = outputMint === SOLANA_USDC_MINT ? "sell" : "buy";
    // Resolve chain IDs by direction (client may pass outputChainId for buy, inputChainId/inputChain for sell).
    let originChainId: number;
    let destinationChainId: number;
    if (tradeDir === "buy") {
      originChainId = CHAIN_IDS.solana;
      destinationChainId = CHAIN_IDS.solana;
      if (typeof body?.outputChainId === "number")
        destinationChainId = body.outputChainId;
      else if (body?.outputChain)
        destinationChainId =
          CHAIN_IDS[(body.outputChain as string).toLowerCase()] ??
          destinationChainId;
    } else {
      destinationChainId = CHAIN_IDS.solana;
      originChainId = CHAIN_IDS.solana;
      if (typeof body?.inputChainId === "number")
        originChainId = body.inputChainId;
      else if (body?.inputChain)
        originChainId =
          CHAIN_IDS[(body.inputChain as string).toLowerCase()] ?? originChainId;
    }
    if (!inputMint || !outputMint || !amount || !userWallet) {
      console.warn("[swap-quote] missing params", {
        userId,
        inputMint: !!inputMint,
        outputMint: !!outputMint,
        amount: !!amount,
        userWallet: !!userWallet,
      });
      return res.status(400).json({
        error: "Missing inputMint, outputMint, amount, or userWallet",
      });
    }
    const NATIVE_ADDRESS = "0x0000000000000000000000000000000000000000";
    const originCurrency =
      inputMint === "base-eth" || inputMint === "bnb-bnb"
        ? NATIVE_ADDRESS
        : inputMint;
    console.log("[swap-quote] start", {
      userId,
      tradeDir,
      originChainId,
      destinationChainId,
      inputMint: inputMint.slice(0, 8) + "…",
      outputMint: outputMint.slice(0, 8) + "…",
      amount,
      slippageBps,
      userWallet: userWallet.slice(0, 8) + "…",
    });
    const apiKey = process.env.RELAY_API_KEY;
    const recipient = body?.recipient?.trim() || userWallet;
    const quoteRes = await fetch(`${RELAY_API_BASE}/quote/v2`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey && { "x-api-key": apiKey }),
      },
      body: JSON.stringify({
        user: userWallet,
        originChainId,
        destinationChainId,
        originCurrency,
        destinationCurrency: outputMint,
        amount,
        tradeType: "EXACT_INPUT",
        recipient,
        slippageTolerance: String(slippageBps),
        appFees: getAppFees(),
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
      console.warn("[swap-quote] Relay quote failed", {
        userId,
        status: quoteRes.status,
        message: message.slice(0, 200),
      });
      return res
        .status(quoteRes.status >= 500 ? 502 : 400)
        .json({ error: message });
    }
    const quote = await quoteRes.json();
    const stepCount = Array.isArray(quote?.steps) ? quote.steps.length : 0;
    console.log("[swap-quote] success", { userId, tradeDir, stepCount });
    return res.status(200).json(quote);
  } catch (e: unknown) {
    console.error("[swap-quote] error", e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : "Internal server error",
    });
  }
}

async function withdrawQuoteHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });
  try {
    ensureFirebase();
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer "))
      return res.status(401).json({ error: "Unauthorized" });
    await getAdminAuth().verifyIdToken(authHeader.slice(7));
    const body = req.body as {
      destinationNetwork?: string;
      amount?: number;
      destinationAddress?: string;
      originAddress?: string;
    };
    const destinationNetwork = (body?.destinationNetwork || "").toLowerCase();
    const amount =
      typeof body?.amount === "number"
        ? body.amount
        : parseFloat(String(body?.amount || "0"));
    const destinationAddress = (body?.destinationAddress || "").trim();
    const originAddress = (body?.originAddress || "").trim();
    if (
      destinationNetwork !== "base" &&
      destinationNetwork !== "bnb" &&
      destinationNetwork !== "solana"
    )
      return res.status(400).json({
        error: "Invalid destinationNetwork; use base, bnb, or solana",
      });
    if (!Number.isFinite(amount) || amount <= 0)
      return res.status(400).json({ error: "Invalid amount" });
    if (!destinationAddress || destinationAddress.length < 20)
      return res.status(400).json({ error: "Invalid destinationAddress" });
    const apiKey = process.env.RELAY_API_KEY;
    const destinationChainId = CHAIN_IDS[destinationNetwork] ?? CHAIN_IDS.base;
    const destinationCurrency =
      destinationNetwork === "solana"
        ? SOLANA_USDC_MINT
        : DESTINATION_USDC[destinationNetwork] || DESTINATION_USDC.base;
    const amountRaw = Math.floor(amount * 1e6).toString();
    const quoteRes = await fetch(`${RELAY_API_BASE}/quote/v2`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey && { "x-api-key": apiKey }),
      },
      body: JSON.stringify({
        user: originAddress || "0x0000000000000000000000000000000000000000",
        originChainId: CHAIN_IDS.solana,
        destinationChainId,
        originCurrency: SOLANA_USDC_MINT,
        destinationCurrency,
        amount: amountRaw,
        tradeType: "EXACT_INPUT",
        recipient: destinationAddress,
        appFees: getAppFees(),
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
      return res
        .status(quoteRes.status >= 500 ? 502 : 400)
        .json({ error: message });
    }
    const quote = await quoteRes.json();
    return res.status(200).json(quote);
  } catch (e: unknown) {
    console.error("withdraw-quote error:", e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : "Internal server error",
    });
  }
}

type RelaySolanaAccountMeta = {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
};
type RelaySolanaInstruction = {
  programId: string;
  keys: RelaySolanaAccountMeta[];
  data: string;
};
type RelaySolanaTxData = {
  instructions: RelaySolanaInstruction[];
  addressLookupTableAddresses?: string[];
};

function isRelaySolanaTxData(x: unknown): x is RelaySolanaTxData {
  if (!x || typeof x !== "object") return false;
  const obj = x as Record<string, unknown>;
  if (!Array.isArray(obj.instructions)) return false;
  // light validation; Relay provides full structure
  return true;
}

function isHexLike(s: string): boolean {
  const v = s.startsWith("0x") ? s.slice(2) : s;
  return v.length > 0 && v.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(v);
}

function isBase64Like(s: string): boolean {
  // quick heuristic: base64 charset + correct padding/length
  if (!s || s.length % 4 !== 0) return false;
  return /^[A-Za-z0-9+/]+={0,2}$/.test(s);
}

/** Base58 uses [1-9A-HJ-NP-Za-km-z] - no 0, O, I, l */
function isBase58Like(s: string): boolean {
  if (!s || s.length === 0) return false;
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(s);
}

/** Max reasonable instruction data size (Solana tx limit ~1232 bytes total) */
const MAX_INSTRUCTION_DATA_BYTES = 2048;

/** Fetch address lookup tables in parallel; report successes and failures. */
async function fetchLuts(
  connection: Connection,
  addrs: string[],
): Promise<{
  ok: AddressLookupTableAccount[];
  fail: Array<{ addr: string; reason: string }>;
}> {
  if (addrs.length === 0) return { ok: [], fail: [] };
  const settled = await Promise.allSettled(
    addrs.map(async (a) => {
      const pk = new PublicKey(a);
      const res = await connection.getAddressLookupTable(pk);
      if (!res.value) throw new Error("LUT_NOT_FOUND");
      return res.value as AddressLookupTableAccount;
    }),
  );
  const ok: AddressLookupTableAccount[] = [];
  const fail: Array<{ addr: string; reason: string }> = [];
  settled.forEach((r, i) => {
    const addr = addrs[i];
    if (r.status === "fulfilled") ok.push(r.value);
    else fail.push({ addr, reason: String(r.reason) });
  });
  return { ok, fail };
}

/** Measure raw and base64 serialized size of a transaction. */
function measureTransaction(tx: VersionedTransaction): {
  rawLen: number;
  b64Len: number;
} {
  const raw = tx.serialize();
  const b64 = Buffer.from(raw).toString("base64");
  return { rawLen: raw.length, b64Len: b64.length };
}

/**
 * Decode Relay instruction data for Solana.
 * Relay's official Solana adapter uses hex exclusively (Buffer.from(i.data, 'hex')).
 * We try hex first, then base64 as fallback for alternate solvers.
 */
function decodeRelayInstructionData(data: string): Buffer {
  if (!data || typeof data !== "string") return Buffer.alloc(0);
  const s = data.trim();
  if (s.length === 0) return Buffer.alloc(0);

  // 1. Hex - Relay's Solana adapter uses hex only. Try first to match canonical format.
  if (isHexLike(s)) {
    const hex = s.startsWith("0x") ? s.slice(2) : s;
    const buf = Buffer.from(hex, "hex");
    if (buf.length <= MAX_INSTRUCTION_DATA_BYTES) return buf;
  }

  // 2. Base64 - fallback for alternate backends that may send base64
  if (isBase64Like(s)) {
    try {
      const buf = Buffer.from(s, "base64");
      if (buf.length > 0 && buf.length <= MAX_INSTRUCTION_DATA_BYTES)
        return buf;
    } catch {
      // fall through
    }
  }

  // 3. Base64 fallback (padding quirks)
  try {
    const buf = Buffer.from(s, "base64");
    if (buf.length > 0 && buf.length <= MAX_INSTRUCTION_DATA_BYTES) return buf;
  } catch {
    // fall through
  }

  // 4. Base58 - last resort for Solana-style encoding
  if (isBase58Like(s)) {
    try {
      const decoded = bs58.decode(s);
      const buf = Buffer.from(decoded);
      if (buf.length > 0 && buf.length <= MAX_INSTRUCTION_DATA_BYTES)
        return buf;
    } catch {
      // fall through
    }
  }

  throw new Error(
    `[relay] Failed to decode instruction data. Len=${s.length} preview=${s.slice(0, 32)}. Expected hex (Relay canonical) or base64.`,
  );
}

async function buildVersionedTxFromRelayInstructions(
  data: RelaySolanaTxData,
  payerKey: PublicKey,
  connection: Connection,
): Promise<VersionedTransaction> {
  const ixs: TransactionInstruction[] = data.instructions.map((ix, idx) => {
    const keys = (ix.keys ?? []).map((k) => ({
      pubkey: new PublicKey(k.pubkey),
      isSigner: !!k.isSigner,
      isWritable: !!k.isWritable,
    }));
    const raw = ix.data ?? "";
    const decoded = decodeRelayInstructionData(raw);
    const discriminator = decoded.slice(0, 8).toString("hex");
    const head = decoded.slice(0, 16).toString("hex");
    const tail =
      decoded.length > 16
        ? decoded.slice(-16).toString("hex")
        : decoded.toString("hex");
    console.log("[relay] instruction decode", {
      idx,
      programId: ix.programId,
      rawLen: raw.length,
      decodedLen: decoded.length,
      isHexLike: isHexLike(raw),
      isBase64Like: isBase64Like(raw),
      discriminator,
      head,
      tail,
    });
    return new TransactionInstruction({
      programId: new PublicKey(ix.programId),
      keys,
      data: decoded,
    });
  });

  const lookupAddrs = Array.isArray(data.addressLookupTableAddresses)
    ? data.addressLookupTableAddresses
    : [];
  const { ok: lookupAccounts, fail: lutFails } = await fetchLuts(
    connection,
    lookupAddrs,
  );

  console.log(
    "[ALT] relaySent",
    lookupAddrs.length,
    "loaded",
    lookupAccounts.length,
  );
  if (lutFails.length) console.warn("[ALT] loadFails", lutFails);

  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  const messageV0 = new TransactionMessage({
    payerKey,
    recentBlockhash: blockhash,
    instructions: ixs,
  }).compileToV0Message(lookupAccounts);

  const staticKeyCount = messageV0.staticAccountKeys.length;
  const lutTotalAccounts = messageV0.addressTableLookups.reduce(
    (sum, lut) => sum + lut.writableIndexes.length + lut.readonlyIndexes.length,
    0,
  );
  const totalIxDataBytes = ixs.reduce((sum, ix) => sum + ix.data.length, 0);
  console.log("[relay] message shape", {
    instructionCount: ixs.length,
    staticKeyCount,
    lutCount: messageV0.addressTableLookups.length,
    lutTotalAccounts,
    totalIxDataBytes,
  });

  console.log("[ALT] lookupsUsed", messageV0.addressTableLookups.length);
  messageV0.addressTableLookups.forEach((l, i) => {
    console.log(
      `[ALT] LUT#${i}`,
      l.accountKey.toBase58(),
      "writableIdx",
      l.writableIndexes.length,
      "readonlyIdx",
      l.readonlyIndexes.length,
    );
  });

  let unsignedSerializedLength: number | null = null;
  try {
    const txUnsigned = new VersionedTransaction(messageV0);
    unsignedSerializedLength = txUnsigned.serialize().length;
    console.log(
      "[relay] unsigned tx serialized length",
      unsignedSerializedLength,
    );
  } catch (serialErr) {
    console.error(
      "[relay] unsigned serialize failed (likely encoding overrun)",
      {
        error:
          serialErr instanceof Error ? serialErr.message : String(serialErr),
      },
    );
  }

  return new VersionedTransaction(messageV0);
}

async function executeStepHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });
  let userId: string | undefined;
  let stepIndex = 0;
  let transaction: VersionedTransaction | null = null;
  let connection: Connection | null = null;
  try {
    ensureFirebase();
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer "))
      return res.status(401).json({ error: "Unauthorized" });
    const decoded = await getAdminAuth().verifyIdToken(authHeader.slice(7));
    userId = decoded.uid;
    const body = req.body as { quoteResponse?: unknown; stepIndex?: number };
    const quoteResponse = body?.quoteResponse;
    stepIndex = typeof body?.stepIndex === "number" ? body.stepIndex : 0;
    console.log("[execute-step] start", { userId, stepIndex });
    if (!quoteResponse || typeof quoteResponse !== "object") {
      console.warn("[execute-step] missing quoteResponse", { userId });
      return res.status(400).json({ error: "Missing quoteResponse" });
    }
    const quote = quoteResponse as {
      steps?: Array<{ items?: Array<{ data?: unknown }> }>;
    };
    const steps = quote?.steps;
    if (!Array.isArray(steps) || !steps[stepIndex]) {
      console.warn("[execute-step] invalid step index or steps", {
        userId,
        stepIndex,
        stepCount: steps?.length,
      });
      return res.status(400).json({ error: "Invalid step index or steps" });
    }
    const firstItem = steps[stepIndex]?.items?.[0];
    const data = firstItem?.data;
    if (!data) {
      console.warn("[execute-step] no step data", { userId, stepIndex });
      return res.status(400).json({ error: "No step data to execute" });
    }

    // Inspect raw step data to diagnose encoding (hex vs base64)
    if (data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      const dataKeys = Object.keys(d);
      if (Array.isArray(d.instructions)) {
        (
          d.instructions as Array<{ data?: string; programId?: string }>
        ).forEach((ix, idx) => {
          const raw = ix.data ?? "";
          const trimmed = raw.startsWith("0x") ? raw.slice(2) : raw;
          const isHexLike =
            trimmed.length > 0 &&
            trimmed.length % 2 === 0 &&
            /^[0-9a-fA-F]+$/.test(trimmed);
          const isBase64Like =
            raw.length > 0 &&
            raw.length % 4 === 0 &&
            /^[A-Za-z0-9+/]+=*$/.test(raw);
          const hasBase64Chars = /[+/=]/.test(raw);
          console.log(`[execute-step] instruction ${idx} data inspect`, {
            programId: ix.programId,
            dataLength: raw.length,
            preview: raw.slice(0, 64),
            isHexLike,
            isBase64Like,
            hasBase64Chars,
          });
        });
      }
      const serializedKeys = [
        "serializedTransaction",
        "transaction",
        "payload",
        "transactionBytes",
      ];
      serializedKeys.forEach((k) => {
        if (typeof d[k] === "string") {
          const v = (d[k] as string).slice(0, 48);
          console.log(`[execute-step] serialized tx key "${k}"`, {
            length: (d[k] as string).length,
            preview: v,
            isBase64Like: /^[A-Za-z0-9+/]+=*$/.test(
              (d[k] as string).slice(0, 64),
            ),
          });
        }
      });
      console.log("[execute-step] step data keys", { dataKeys });
    }

    const encryptionSecret = process.env.ENCRYPTION_SECRET;
    if (!encryptionSecret) {
      console.warn("[execute-step] ENCRYPTION_SECRET not configured");
      return res
        .status(503)
        .json({ error: "ENCRYPTION_SECRET not configured" });
    }
    const db = getAdminDb();
    const userSnap = await db.collection("users").doc(userId).get();
    const userData = userSnap.data();
    const encryptedSecretKey = userData?.encryptedSecretKey;
    const encryptedMnemonic = userData?.encryptedMnemonic;
    if (!encryptedSecretKey) {
      console.warn("[execute-step] wallet credentials not found", { userId });
      return res.status(400).json({ error: "Wallet credentials not found" });
    }
    const { secretKey, mnemonic } = await decryptWalletCredentials(
      userId,
      encryptedMnemonic,
      encryptedSecretKey,
      encryptionSecret,
    );
    const wallet = Keypair.fromSecretKey(secretKey);
    const storedWalletAddress = userData?.walletAddress as string | undefined;

    // EVM step: chainId 8453 (Base) or 56 (BNB)
    const d = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
    const chainId = typeof d?.chainId === "number" ? d.chainId : undefined;
    if (chainId === 8453 || chainId === 56) {
      if (!mnemonic?.trim()) {
        console.warn("[execute-step] EVM step but no mnemonic", { userId, stepIndex });
        return res.status(400).json({ error: "EVM step requires mnemonic backup" });
      }
      const evmWallet = HDNodeWallet.fromPhrase(
        mnemonic.trim(),
        undefined,
        ETH_DERIVATION_PATH,
      );
      const txRequest: TransactionRequest = {
        from: d?.from as string,
        to: d?.to as string,
        data: d?.data as string,
        value: typeof d?.value === "string" ? BigInt(d.value) : undefined,
        gasLimit:
          typeof d?.gas === "string"
            ? BigInt(d.gas)
            : typeof d?.gas === "number"
              ? BigInt(d.gas)
              : undefined,
        maxFeePerGas:
          typeof d?.maxFeePerGas === "string"
            ? BigInt(d.maxFeePerGas)
            : undefined,
        maxPriorityFeePerGas:
          typeof d?.maxPriorityFeePerGas === "string"
            ? BigInt(d.maxPriorityFeePerGas)
            : undefined,
        chainId,
      };
      const provider = getEvmProvider(chainId);
      const connected = evmWallet.connect(provider);
      const userAddress = (d?.from as string) || "";

      // Retry loop: on INSUFFICIENT_FUNDS, fund from EVM funder, wait, retry (like Solana)
      const maxAttempts = 10;
      let attempt = 0;

      while (attempt < maxAttempts) {
        try {
          const tx = await connected.sendTransaction(txRequest);
          console.log("[execute-step] EVM tx sent", {
            userId,
            stepIndex,
            chainId,
            hash: tx.hash,
            attempt: attempt + 1,
          });
          await tx.wait();
          return res.status(200).json({
            signature: tx.hash,
            chainId,
            status: "Success",
          });
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          const errCode = (err as { code?: string })?.code;
          const isInsufficientFunds =
            /insufficient funds|INSUFFICIENT_FUNDS/i.test(errMsg) ||
            errCode === "INSUFFICIENT_FUNDS";

          if (
            !isInsufficientFunds ||
            !getEvmFunderWallet(chainId) ||
            !userAddress ||
            userAddress.length < 20
          ) {
            console.warn("[execute-step] EVM send failed (no retry)", {
              errMsg: errMsg.slice(0, 120),
              hasFunder: !!getEvmFunderWallet(chainId),
            });
            return res.status(500).json({
              error: errMsg.slice(0, 200) || "Transaction failed. Please try again.",
              signature: "",
              status: "Failed",
            });
          }

          const amountWei = chainId === 8453 ? EVM_FUNDER_BASE_WEI : EVM_FUNDER_BNB_WEI;
          const fundHash = await sendNativeFromEvmFunder(
            userAddress,
            amountWei,
            chainId,
          );
          if (!fundHash) {
            console.warn("[execute-step] EVM funder top-up failed on attempt", attempt + 1);
            return res.status(500).json({
              error: "Insufficient funds. Top-up failed. Please try again.",
              signature: "",
              status: "Failed",
            });
          }
          console.log("[execute-step] EVM funded for retry", {
            userId,
            userAddress,
            fundHash,
            amountWei: amountWei.toString(),
            attempt: attempt + 1,
          });

          await new Promise((r) => setTimeout(r, 3000));
          attempt++;
        }
      }

      return res.status(500).json({
        error: "Transaction failed after retries. Please try again.",
        signature: "",
        status: "Failed",
      });
    }

    console.log("[execute-step] wallet loaded, signing", {
      userId,
      stepIndex,
      signerPublicKey: wallet.publicKey.toBase58(),
      storedWalletAddress: storedWalletAddress ?? null,
      signerMatchesStored: storedWalletAddress
        ? wallet.publicKey.toBase58() === storedWalletAddress
        : "no stored address",
    });
    connection = new Connection(getRpcUrl());

    let serializedTx: string | null = null;
    if (typeof data === "string") serializedTx = data;
    else if (data && typeof data === "object") {
      const d = data as Record<string, unknown>;
      if (typeof d.serializedTransaction === "string")
        serializedTx = d.serializedTransaction;
      else if (typeof d.transaction === "string") serializedTx = d.transaction;
      else if (typeof d.payload === "string") serializedTx = d.payload;
      else if (typeof d.transactionBytes === "string")
        serializedTx = d.transactionBytes;
    }

    if (serializedTx) {
      const txBuffer = Buffer.from(serializedTx, "base64");
      transaction = VersionedTransaction.deserialize(txBuffer);
    } else if (isRelaySolanaTxData(data)) {
      // Relay can return Solana steps as { instructions, addressLookupTableAddresses } instead of a serialized tx.
      // User pays for their own gas. Funder only top-ups on insufficient SOL (see catch block).
      transaction = await buildVersionedTxFromRelayInstructions(
        data,
        wallet.publicKey,
        connection,
      );
    }

    if (!transaction) {
      console.warn("[execute-step] step data has no Solana transaction", {
        userId,
        stepIndex,
      });
      return res
        .status(400)
        .json({ error: "Step data does not contain Solana transaction" });
    }

    const txAccountKeys = transaction.message.staticAccountKeys.map((pk) =>
      pk.toBase58(),
    );
    const msgPreSign = transaction.message;
    const staticCountPre =
      "staticAccountKeys" in msgPreSign
        ? msgPreSign.staticAccountKeys.length
        : 0;
    const lookupCountPre =
      "addressTableLookups" in msgPreSign
        ? msgPreSign.addressTableLookups.length
        : 0;
    console.log("[execute-step] tx accounts (static)", {
      userId,
      stepIndex,
      accountCount: txAccountKeys.length,
      accountKeys: txAccountKeys,
    });
    console.log("[execute-step] pre-sign message stats", {
      staticKeyCount: staticCountPre,
      lookupCount: lookupCountPre,
      instructionCount:
        "instructions" in msgPreSign
          ? ((msgPreSign as { instructions?: unknown[] }).instructions
              ?.length ?? null)
          : null,
    });

    transaction.sign([wallet]);

    const { rawLen, b64Len } = measureTransaction(transaction);
    const msg = transaction.message;
    const staticCount =
      "staticAccountKeys" in msg ? msg.staticAccountKeys.length : 0;
    const lookupCount =
      "addressTableLookups" in msg ? msg.addressTableLookups.length : 0;
    console.log(
      "[TX] staticKeys",
      staticCount,
      "lookupsUsed",
      lookupCount,
      "rawLen",
      rawLen,
      "b64Len",
      b64Len,
    );

    if (rawLen > 1232) {
      throw new Error(`SOL_TX_TOO_LARGE:${rawLen}`);
    }

    let serialized: Uint8Array;
    try {
      serialized = transaction.serialize();
    } catch (serErr) {
      const msg = serErr instanceof Error ? serErr.message : String(serErr);
      console.error("[execute-step] serialize failed", {
        userId,
        stepIndex,
        error: msg,
        hasSerializedTx: !!serializedTx,
        builtFromInstructions: !serializedTx && isRelaySolanaTxData(data),
      });
      throw serErr;
    }

    const sig = await connection.sendRawTransaction(serialized, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });
    console.log("[execute-step] success", {
      userId,
      stepIndex,
      signature: sig,
    });
    return res.status(200).json({ signature: sig, status: "Success" });
  } catch (e: unknown) {
    const err = e as Error & { logs?: string[] };
    const logs = err.logs ?? undefined;
    const errMsg = e instanceof Error ? e.message : String(e);
    console.error("[execute-step] error", {
      error: errMsg,
      logs: logs ?? null,
    });

    // Jupiter program 0x1788 (6024) = InsufficientFunds (swap amount, fees, or rent)
    const isJupiterInsufficientFunds = /0x1788|6024/i.test(errMsg);
    const isEncodingOverrun = /encoding overruns Uint8Array/i.test(errMsg);
    const isInvalidInstructionData = /InvalidInstructionData|0x3e7f/i.test(
      errMsg,
    );
    if (isEncodingOverrun || isInvalidInstructionData) {
      const body = (req as any)?.body as {
        quoteResponse?: {
          steps?: Array<{ items?: Array<{ data?: unknown }> }>;
        };
      };
      const steps = body?.quoteResponse?.steps;
      const firstItem = steps?.[stepIndex]?.items?.[0];
      const stepData = firstItem?.data;
      const dataKeys =
        stepData && typeof stepData === "object"
          ? Object.keys(stepData as object)
          : [];
      const usedSerializedTx = !!(
        stepData &&
        typeof stepData === "object" &&
        (stepData as Record<string, unknown>).serializedTransaction
      );
      const usedInstructions = !!(
        stepData &&
        typeof stepData === "object" &&
        Array.isArray((stepData as Record<string, unknown>).instructions)
      );
      const firstIxDataPreview =
        usedInstructions &&
        Array.isArray(
          (stepData as { instructions?: Array<{ data?: string }> })
            ?.instructions,
        )
          ? (
              stepData as { instructions: Array<{ data?: string }> }
            ).instructions[0]?.data?.slice(0, 48)
          : null;
      const instructionCount =
        usedInstructions &&
        typeof stepData === "object" &&
        Array.isArray((stepData as { instructions?: unknown[] }).instructions)
          ? (stepData as { instructions: unknown[] }).instructions.length
          : null;
      const lutCount =
        stepData &&
        typeof stepData === "object" &&
        Array.isArray(
          (stepData as { addressLookupTableAddresses?: unknown[] })
            .addressLookupTableAddresses,
        )
          ? (stepData as { addressLookupTableAddresses: unknown[] })
              .addressLookupTableAddresses.length
          : null;
      const txMsgStats =
        transaction && "message" in transaction
          ? {
              staticKeyCount:
                "staticAccountKeys" in transaction.message
                  ? transaction.message.staticAccountKeys.length
                  : null,
              lookupCount:
                "addressTableLookups" in transaction.message
                  ? transaction.message.addressTableLookups.length
                  : null,
            }
          : null;
      console.error(
        "[execute-step] encoding/instruction error - Relay step data diagnostic",
        {
          userId,
          stepIndex,
          errMsg: errMsg.slice(0, 120),
          dataKeys,
          usedSerializedTx,
          usedInstructions,
          firstIxDataPreview: firstIxDataPreview ?? "(none)",
          instructionCountFromStep: instructionCount,
          lutCountFromStep: lutCount,
          txMessageStats: txMsgStats,
        },
      );
    }

    const isInsufficientSol =
      /insufficient lamports|Transfer: insufficient/i.test(errMsg) ||
      (Array.isArray(logs) &&
        logs.some((l) => /insufficient lamports|need \d+/.test(String(l))));

    // Also retry on Jupiter 0x1788 (InsufficientFunds) - may be SOL for fees
    const shouldRetryWithFunder =
      (isInsufficientSol || isJupiterInsufficientFunds) &&
      getFunderKeypair() &&
      userId &&
      transaction &&
      connection;

    // Backend retry loop: fund (×2), wait 3s, retry send until success or max attempts
    if (shouldRetryWithFunder && userId && transaction && connection) {
      const db = getAdminDb();
      const snap = await db.collection("users").doc(userId).get();
      const walletAddress = snap.data()?.walletAddress as string | undefined;
      const maxAttempts = 10;
      let attempt = 0;

      while (walletAddress && walletAddress.length >= 32 && attempt < maxAttempts) {
        // Compute funding amount: dynamic fee ×2, or fixed 0.005 ×2, capped
        let lamportsToSend = SOL_FUNDER_AMOUNT_LAMPORTS * 2;
        try {
          const feeResult = await connection.getFeeForMessage(
            transaction.message,
            "confirmed",
          );
          const baseFee = feeResult.value ?? 5000;
          const rentBuffer = 2_000_000;
          const computeBuffer = 500_000;
          const computed = (baseFee + rentBuffer + computeBuffer) * 2;
          lamportsToSend = Math.min(
            Math.max(computed, 2_000_000),
            20_000_000,
          );
          console.log("[execute-step] dynamic funding x2", {
            baseFee,
            lamportsToSend,
            attempt: attempt + 1,
          });
        } catch {
          // use fixed ×2
        }

        const fundSig = await sendSolFromFunder(walletAddress, lamportsToSend);
        if (!fundSig) {
          console.warn("[execute-step] funder top-up failed on attempt", attempt + 1);
          break;
        }
        console.log("[execute-step] funded wallet for retry", {
          userId,
          signature: fundSig,
          lamports: lamportsToSend,
          attempt: attempt + 1,
        });

        await new Promise((r) => setTimeout(r, 3000));

        try {
          const serialized = transaction.serialize();
          const sig = await connection.sendRawTransaction(serialized, {
            skipPreflight: false,
            preflightCommitment: "confirmed",
          });
          console.log("[execute-step] success after funding retry", {
            userId,
            stepIndex,
            signature: sig,
            attempt: attempt + 1,
          });
          return res.status(200).json({ signature: sig, status: "Success" });
        } catch (retryErr: unknown) {
          const retryLogs = (retryErr as Error & { logs?: string[] }).logs;
          const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
          const stillInsufficient =
            /insufficient lamports|Transfer: insufficient|0x1788|6024/i.test(retryMsg) ||
            (Array.isArray(retryLogs) &&
              retryLogs.some((l) => /insufficient lamports|need \d+|0x1788/.test(String(l))));
          if (!stillInsufficient) {
            console.warn("[execute-step] retry failed with non-SOL error", retryMsg);
            break;
          }
          attempt++;
        }
      }
    }

    const userMessage = isEncodingOverrun
      ? "Transaction encoding error. Try again with different slippage or amount."
      : isJupiterInsufficientFunds
        ? "Insufficient funds for swap and fees. Ensure you have enough of the input token and SOL for transaction fees."
        : "Transaction failed. Please try again.";
    return res.status(500).json({
      error: userMessage,
      signature: "",
      status: "Failed",
    });
  }
}

async function evmAddressHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });
  try {
    ensureFirebase();
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer "))
      return res.status(401).json({ error: "Unauthorized" });
    const decoded = await getAdminAuth().verifyIdToken(authHeader.slice(7));
    const userId = decoded.uid;
    const encryptionSecret = process.env.ENCRYPTION_SECRET;
    if (!encryptionSecret)
      return res
        .status(503)
        .json({ error: "ENCRYPTION_SECRET not configured" });
    const db = getAdminDb();
    const userSnap = await db.collection("users").doc(userId).get();
    const userData = userSnap.data();
    const encryptedSecretKey = userData?.encryptedSecretKey;
    const encryptedMnemonic = userData?.encryptedMnemonic;
    if (!encryptedSecretKey)
      return res.status(400).json({ error: "Wallet credentials not found" });
    const { mnemonic } = await decryptWalletCredentials(
      userId,
      encryptedMnemonic,
      encryptedSecretKey,
      encryptionSecret,
    );
    if (!mnemonic || !mnemonic.trim())
      return res.status(200).json({ evmAddress: null });
    const wallet = HDNodeWallet.fromPhrase(
      mnemonic.trim(),
      undefined,
      ETH_DERIVATION_PATH,
    );
    const addr = wallet.address.toLowerCase();
    try {
      await userSnap.ref.update({ evmAddress: addr });
      addEvmAddressToAlchemyWebhooks(addr);
    } catch {
      // best-effort persist for webhook lookup
    }
    return res.status(200).json({ evmAddress: wallet.address });
  } catch (e: unknown) {
    console.error("evm-address error:", e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : "Internal server error",
    });
  }
}

async function evmBalancesHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });
  try {
    ensureFirebase();
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer "))
      return res.status(401).json({ error: "Unauthorized" });
    const decoded = await getAdminAuth().verifyIdToken(authHeader.slice(7));
    const userId = decoded.uid;
    const encryptionSecret = process.env.ENCRYPTION_SECRET;
    if (!encryptionSecret)
      return res
        .status(503)
        .json({ error: "ENCRYPTION_SECRET not configured" });
    const db = getAdminDb();
    const userSnap = await db.collection("users").doc(userId).get();
    const userData = userSnap.data();
    const encryptedSecretKey = userData?.encryptedSecretKey;
    const encryptedMnemonic = userData?.encryptedMnemonic;
    if (!encryptedSecretKey)
      return res.status(200).json({
        evmAddress: null,
        base: { usdc: 0, native: 0 },
        bnb: { usdc: 0, native: 0 },
      });
    const { mnemonic } = await decryptWalletCredentials(
      userId,
      encryptedMnemonic,
      encryptedSecretKey,
      encryptionSecret,
    );
    if (!mnemonic || !mnemonic.trim())
      return res.status(200).json({
        evmAddress: null,
        base: { usdc: 0, native: 0 },
        bnb: { usdc: 0, native: 0 },
      });
    const wallet = HDNodeWallet.fromPhrase(
      mnemonic.trim(),
      undefined,
      ETH_DERIVATION_PATH,
    );
    const addr = wallet.address.toLowerCase();
    try {
      await userSnap.ref.update({ evmAddress: addr });
      addEvmAddressToAlchemyWebhooks(addr);
    } catch {
      // best-effort persist for webhook lookup
    }
    const [balances, tokenPositions] = await Promise.all([
      getEvmBalances(wallet.address),
      getEvmTokenPositions(wallet.address),
    ]);
    return res.status(200).json({
      evmAddress: wallet.address,
      base: balances.base,
      bnb: balances.bnb,
      tokens: tokenPositions,
    });
  } catch (e: unknown) {
    console.error("evm-balances error:", e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : "Internal server error",
    });
  }
}

async function evmBalancesPublicHandler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });
  const address = (req.query.address as string)?.trim();
  if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return res
      .status(400)
      .json({ error: "Invalid address; provide 0x-prefixed 40-char hex" });
  }
  try {
    const balances = await getEvmBalances(address);
    return res.status(200).json({ base: balances.base, bnb: balances.bnb });
  } catch (e: unknown) {
    console.error("evm-balances-public error:", e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : "Internal server error",
    });
  }
}

async function evmAddressRemoveHandler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== "POST" && req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });
  try {
    ensureFirebase();
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer "))
      return res.status(401).json({ error: "Unauthorized" });
    const decoded = await getAdminAuth().verifyIdToken(authHeader.slice(7));
    const userId = decoded.uid;
    const db = getAdminDb();
    const userSnap = await db.collection("users").doc(userId).get();
    const evmAddress = userSnap.data()?.evmAddress;
    if (
      evmAddress &&
      typeof evmAddress === "string" &&
      evmAddress.length >= 40
    ) {
      removeEvmAddressFromAlchemyWebhooks(evmAddress);
    }
    return res.status(200).json({ success: true });
  } catch (e: unknown) {
    console.error("evm-address-remove error:", e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : "Internal server error",
    });
  }
}

async function currenciesHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });
  try {
    const apiKey = process.env.RELAY_API_KEY;
    const body = req.method === "POST" ? req.body : {};
    const query = req.query || {};
    const term = (body.term ?? query.term ?? "").toString().trim();
    const addressParam = (body.address ?? query.address ?? "")
      .toString()
      .trim();
    const tokensParam = body.tokens ?? query.tokens;
    const chainIdsParam = body.chainIds ?? query.chainIds;
    const limit = Math.min(
      Math.max(
        1,
        parseInt(String(body.limit ?? query.limit ?? "20"), 10) || 20,
      ),
      50,
    );
    const verified = body.verified ?? query.verified;
    const relayParams: Record<string, unknown> = {
      limit,
      useExternalSearch: true,
    };
    if (term) relayParams.term = term;
    if (addressParam) {
      relayParams.address = addressParam;
      if (!Array.isArray(chainIdsParam) || chainIdsParam.length === 0)
        relayParams.chainIds = [CHAIN_IDS.solana];
      if (verified === undefined) relayParams.verified = false;
    }
    if (Array.isArray(tokensParam) && tokensParam.length > 0)
      relayParams.tokens = tokensParam;
    else if (typeof tokensParam === "string" && tokensParam) {
      try {
        const parsed = JSON.parse(tokensParam) as string[];
        if (Array.isArray(parsed) && parsed.length > 0)
          relayParams.tokens = parsed;
      } catch {
        relayParams.tokens = [tokensParam];
      }
    }
    if (Array.isArray(chainIdsParam) && chainIdsParam.length > 0)
      relayParams.chainIds = chainIdsParam;
    if (verified !== undefined) relayParams.verified = Boolean(verified);
    let relayRes = await fetch(`${RELAY_API_BASE}/currencies/v2`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey && { "x-api-key": apiKey }),
      },
      body: JSON.stringify(relayParams),
    });
    if (relayRes.status === 404 || relayRes.status === 405) {
      const getUrl = new URL(`${RELAY_API_BASE}/currencies/v2`);
      if (term) getUrl.searchParams.set("term", term);
      if (addressParam) getUrl.searchParams.set("address", addressParam);
      getUrl.searchParams.set("limit", String(limit));
      relayRes = await fetch(getUrl.toString(), {
        headers: apiKey ? { "x-api-key": apiKey } : {},
      });
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
      return res
        .status(relayRes.status >= 500 ? 502 : 400)
        .json({ error: message });
    }
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(502).json({ error: "Invalid JSON from Relay" });
    }
    const list = Array.isArray(data)
      ? data
      : ((data as { currencies?: unknown[]; data?: unknown[] })?.currencies ??
        (data as { currencies?: unknown[]; data?: unknown[] })?.data ??
        []);
    const SUPPORTED_CHAIN_IDS = new Set([792703809, 8453, 56]);
    type RelayItem = {
      chainId?: number;
      address?: string;
      symbol?: string;
      name?: string;
      decimals?: number;
      metadata?: { logoURI?: string; verified?: boolean };
    };
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
    return res.status(500).json({
      error: e instanceof Error ? e.message : "Internal server error",
    });
  }
}

async function coingeckoTokensHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });
  try {
    const apiKey = process.env.COINGECKO_API_KEY;
    const query = req.query || {};
    const networkParam = (query.network ?? "").toString().trim().toLowerCase();
    const addressesParam = (query.addresses ?? "").toString().trim();
    const network =
      (CHAIN_TO_NETWORK[networkParam] ?? networkParam) || "solana";
    if (!addressesParam)
      return res
        .status(400)
        .json({ error: "Missing addresses (comma-separated token addresses)" });
    const addresses = addressesParam
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    if (addresses.length === 0)
      return res
        .status(400)
        .json({ error: "At least one token address is required" });
    if (addresses.length > 30)
      return res
        .status(400)
        .json({ error: "Maximum 30 addresses per request" });
    const url = new URL(
      `${COINGECKO_API_BASE}/networks/${network}/tokens/multi/${addresses.join(",")}`,
    );
    url.searchParams.set("include", "top_pools");
    url.searchParams.set("include_composition", "true");
    url.searchParams.set("include_inactive_source", "true");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
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
      return res
        .status(coinRes.status >= 500 ? 502 : 400)
        .json({ error: message });
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
    return res.status(500).json({
      error: e instanceof Error ? e.message : "Internal server error",
    });
  }
}

const COINGECKO_SIMPLE_BASE = "https://api.coingecko.com/api/v3/simple";
const DEFAULT_ETH_PRICE = 3000;
const DEFAULT_BNB_PRICE = 600;

async function coingeckoNativePricesHandler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET")
    return res.status(405).json({ error: "Method not allowed" });
  try {
    const apiKey = process.env.COINGECKO_API_KEY;
    const url = `${COINGECKO_SIMPLE_BASE}/price?ids=ethereum,binancecoin&vs_currencies=usd`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers["x-cg-demo-api-key"] = apiKey;
    const coinRes = await fetch(url, { method: "GET", headers });
    const raw = await coinRes.text();
    if (!coinRes.ok) {
      return res.status(502).json({
        eth: DEFAULT_ETH_PRICE,
        bnb: DEFAULT_BNB_PRICE,
        _fallback: true,
      });
    }
    let data: { ethereum?: { usd?: number }; binancecoin?: { usd?: number } };
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(200).json({
        eth: DEFAULT_ETH_PRICE,
        bnb: DEFAULT_BNB_PRICE,
        _fallback: true,
      });
    }
    const eth = typeof data?.ethereum?.usd === "number" ? data.ethereum.usd : DEFAULT_ETH_PRICE;
    const bnb = typeof data?.binancecoin?.usd === "number" ? data.binancecoin.usd : DEFAULT_BNB_PRICE;
    return res.status(200).json({ eth, bnb });
  } catch (e: unknown) {
    console.error("coingecko-native-prices error:", e);
    return res.status(200).json({
      eth: DEFAULT_ETH_PRICE,
      bnb: DEFAULT_BNB_PRICE,
      _fallback: true,
    });
  }
}

function getEvmProvider(chainId: number): JsonRpcProvider {
  if (chainId === 8453)
    return new JsonRpcProvider(
      process.env.BASE_RPC_URL || "https://mainnet.base.org",
    );
  if (chainId === 56)
    return new JsonRpcProvider(
      process.env.BNB_RPC_URL || "https://bsc-dataseed.binance.org",
    );
  throw new Error(`Unsupported EVM chainId: ${chainId}`);
}

async function bridgeFromEvmQuoteHandler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });
  const secret =
    process.env.WEBHOOK_EVM_DEPOSIT_SECRET || process.env.RELAY_INTERNAL_SECRET;
  if (
    secret &&
    req.headers["x-webhook-secret"] !== secret &&
    req.headers.authorization !== `Bearer ${secret}`
  ) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const body = req.body as {
      evmAddress?: string;
      network?: string;
      amountRaw?: string;
      recipientSolAddress?: string;
    };
    const evmAddress = (body?.evmAddress ?? "").trim();
    const network = (body?.network ?? "").toLowerCase();
    const amountRaw = body?.amountRaw ?? "";
    const recipientSolAddress = (body?.recipientSolAddress ?? "").trim();
    if (!evmAddress || evmAddress.length < 40)
      return res.status(400).json({ error: "Invalid evmAddress" });
    if (network !== "base" && network !== "bnb")
      return res
        .status(400)
        .json({ error: "Invalid network; use base or bnb" });
    if (!amountRaw || BigInt(amountRaw) <= 0n)
      return res.status(400).json({ error: "Invalid amountRaw" });
    if (!recipientSolAddress || recipientSolAddress.length < 32)
      return res.status(400).json({ error: "Invalid recipientSolAddress" });

    console.log("[bridge-from-evm-quote] request", {
      evmAddress: evmAddress.slice(0, 10) + "...",
      network,
      amountRaw,
      recipientSolAddress: recipientSolAddress.slice(0, 8) + "...",
    });

    const apiKey = process.env.RELAY_API_KEY;
    const originChainId =
      CHAIN_IDS[network] ?? (network === "base" ? 8453 : 56);
    const amountUsdc = parseInt(amountRaw, 10);
    const topupAmount = amountUsdc > 5_000_000 ? "500000" : "200000"; // $0.50 for >=$5, $0.20 for <$5
    const relayBody = {
      user: evmAddress,
      originChainId,
      destinationChainId: CHAIN_IDS.solana,
      originCurrency: ORIGIN_USDC[network],
      destinationCurrency: SOLANA_USDC_MINT,
      amount: amountRaw,
      tradeType: "EXACT_INPUT",
      recipient: recipientSolAddress,
      useDepositAddress: false,
      usePermit: true,
      topupGas: true,
      topupGasAmount: topupAmount,
      appFees: getAppFees(),
    };
    console.log("[bridge-from-evm-quote] relay quote/v2 body", {
      ...relayBody,
      user: evmAddress.slice(0, 10) + "...",
      recipient: recipientSolAddress.slice(0, 8) + "...",
    });

    const quoteRes = await fetch(`${RELAY_API_BASE}/quote/v2`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey && { "x-api-key": apiKey }),
      },
      body: JSON.stringify(relayBody),
    });
    if (!quoteRes.ok) {
      const errBody = await quoteRes.text();
      console.log("[bridge-from-evm-quote] relay error", {
        status: quoteRes.status,
        body: errBody.slice(0, 500),
      });
      let message = `Relay quote failed: ${quoteRes.status}`;
      try {
        const j = JSON.parse(errBody);
        if (j.message) message = j.message;
        else if (j.error) message = j.error;
      } catch {
        if (errBody) message = errBody.slice(0, 200);
      }
      return res
        .status(quoteRes.status >= 500 ? 502 : 400)
        .json({ error: message });
    }
    const quote = await quoteRes.json();
    console.log("[bridge-from-evm-quote] success", { network, amountRaw });
    return res.status(200).json(quote);
  } catch (e: unknown) {
    console.error("bridge-from-evm-quote error:", e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : "Internal server error",
    });
  }
}

async function executeBridgeCustodialHandler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });
  const secret =
    process.env.WEBHOOK_EVM_DEPOSIT_SECRET || process.env.RELAY_INTERNAL_SECRET;
  if (
    secret &&
    req.headers["x-webhook-secret"] !== secret &&
    req.headers.authorization !== `Bearer ${secret}`
  ) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    ensureFirebase();
    const body = req.body as { userId?: string; quoteResponse?: unknown };
    const userId = (body?.userId ?? "").trim();
    const quoteResponse = body?.quoteResponse;
    if (!userId || !quoteResponse || typeof quoteResponse !== "object") {
      return res.status(400).json({ error: "Missing userId or quoteResponse" });
    }
    const quote = quoteResponse as {
      steps?: Array<{
        id?: string;
        kind?: string;
        items?: Array<{
          data?: unknown;
          check?: { endpoint?: string; method?: string };
        }>;
      }>;
    };
    const steps = quote?.steps;
    if (!Array.isArray(steps) || steps.length === 0) {
      return res.status(400).json({ error: "Invalid quote: no steps" });
    }
    const encryptionSecret = process.env.ENCRYPTION_SECRET;
    if (!encryptionSecret)
      return res
        .status(503)
        .json({ error: "ENCRYPTION_SECRET not configured" });
    const db = getAdminDb();
    const userSnap = await db.collection("users").doc(userId).get();
    const userData = userSnap.data();
    const encryptedSecretKey = userData?.encryptedSecretKey;
    const encryptedMnemonic = userData?.encryptedMnemonic;
    const walletAddress = userData?.walletAddress as string | undefined;
    if (!encryptedSecretKey || !walletAddress) {
      return res.status(400).json({ error: "User wallet not found" });
    }
    const { secretKey, mnemonic } = await decryptWalletCredentials(
      userId,
      encryptedMnemonic,
      encryptedSecretKey,
      encryptionSecret,
    );
    const solanaKeypair = Keypair.fromSecretKey(secretKey);
    let evmWallet: HDNodeWallet | null = null;
    if (mnemonic?.trim()) {
      evmWallet = HDNodeWallet.fromPhrase(
        mnemonic.trim(),
        undefined,
        ETH_DERIVATION_PATH,
      );
    }
    const apiKey = process.env.RELAY_API_KEY;
    const relayHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      ...(apiKey && { "x-api-key": apiKey }),
    };
    const solanaConnection = new Connection(getRpcUrl());

    for (let stepIndex = 0; stepIndex < steps.length; stepIndex++) {
      const step = steps[stepIndex];
      const kind = step?.kind ?? "transaction";
      const items = step?.items ?? [];
      if (items.length === 0) continue;

      const firstItem = items[0];
      const data = firstItem?.data;
      if (!data || typeof data !== "object") continue;

      const d = data as Record<string, unknown>;

      if (kind === "signature") {
        const signData = d.sign as Record<string, unknown> | undefined;
        const postData = d.post as
          | { endpoint?: string; method?: string; body?: unknown }
          | undefined;
        if (!signData || !postData?.endpoint || !evmWallet) {
          console.warn(
            "execute-bridge-custodial: skip signature step, missing sign/post or evmWallet",
          );
          continue;
        }
        const signatureKind = (signData.signatureKind as string) ?? "eip191";
        let signature: string;
        if (signatureKind === "eip712") {
          const domain = signData.domain as Record<string, unknown>;
          const types = signData.types as Record<
            string,
            Array<{ name: string; type: string }>
          >;
          const value = signData.value as Record<string, unknown>;
          signature = await evmWallet.signTypedData(
            domain as object,
            types as Record<string, Array<{ name: string; type: string }>>,
            value as Record<string, unknown>,
          );
        } else {
          const message = (signData.message as string) ?? "";
          signature = await evmWallet.signMessage(
            message.startsWith("0x")
              ? Buffer.from(message.slice(2), "hex")
              : message,
          );
        }
        const postBody =
          typeof postData.body === "object" && postData.body !== null
            ? { ...postData.body }
            : {};
        const postUrl = postData.endpoint.startsWith("http")
          ? postData.endpoint
          : `${RELAY_API_BASE}${postData.endpoint.startsWith("/") ? "" : "/"}${postData.endpoint}`;
        const postUrlWithSignature = `${postUrl}${postUrl.includes("?") ? "&" : "?"}signature=${encodeURIComponent(signature)}`;
        const postRes = await fetch(postUrlWithSignature, {
          method: (postData.method as string) ?? "POST",
          headers: relayHeaders,
          body: JSON.stringify(postBody),
        });
        if (!postRes.ok) {
          console.error(
            "execute-bridge-custodial: permit post failed",
            await postRes.text(),
          );
          return res.status(502).json({ error: "Relay permit post failed" });
        }
      } else if (kind === "transaction") {
        const chainId = d.chainId as number | undefined;
        if (chainId === 8453 || chainId === 56) {
          if (!evmWallet) {
            return res.status(400).json({ error: "EVM step but no mnemonic" });
          }
          const txRequest: TransactionRequest = {
            from: d.from as string,
            to: d.to as string,
            data: d.data as string,
            value: typeof d.value === "string" ? BigInt(d.value) : undefined,
            gasLimit:
              typeof d.gas === "string"
                ? BigInt(d.gas)
                : typeof d.gas === "number"
                  ? BigInt(d.gas)
                  : undefined,
            maxFeePerGas:
              typeof d.maxFeePerGas === "string"
                ? BigInt(d.maxFeePerGas)
                : undefined,
            maxPriorityFeePerGas:
              typeof d.maxPriorityFeePerGas === "string"
                ? BigInt(d.maxPriorityFeePerGas)
                : undefined,
            chainId,
          };
          const provider = getEvmProvider(chainId);
          const connected = evmWallet.connect(provider);
          const tx = await connected.sendTransaction(txRequest);
          await tx.wait();
        } else {
          let tx: VersionedTransaction | null = null;
          let serializedTx: string | null = null;
          if (typeof d.serializedTransaction === "string")
            serializedTx = d.serializedTransaction;
          else if (typeof d.transaction === "string")
            serializedTx = d.transaction;
          else if (typeof d.payload === "string") serializedTx = d.payload;
          else if (typeof d.transactionBytes === "string")
            serializedTx = d.transactionBytes;

          if (serializedTx) {
            const txBuffer = Buffer.from(serializedTx, "base64");
            tx = VersionedTransaction.deserialize(txBuffer);
          } else if (isRelaySolanaTxData(d)) {
            tx = await buildVersionedTxFromRelayInstructions(
              d,
              solanaKeypair.publicKey,
              solanaConnection,
            );
          }

          if (!tx) {
            return res
              .status(400)
              .json({ error: "Step data does not contain Solana transaction" });
          }

          tx.sign([solanaKeypair]);
          await solanaConnection.sendRawTransaction(tx.serialize(), {
            skipPreflight: false,
            preflightCommitment: "confirmed",
          });
        }
      }

      const check = firstItem?.check;
      if (check?.endpoint && (check.method === "GET" || !check.method)) {
        const statusUrl = check.endpoint.startsWith("http")
          ? check.endpoint
          : `${RELAY_API_BASE}${check.endpoint.startsWith("/") ? "" : "/"}${check.endpoint}`;
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const statusRes = await fetch(statusUrl, {
            headers: apiKey ? { "x-api-key": apiKey } : {},
          });
          const statusJson = (await statusRes.json()) as { status?: string };
          const s = statusJson?.status;
          if (s === "success" || s === "completed") break;
          if (s === "refunded") {
            return res.status(200).json({ status: "refunded", message: "Bridge was refunded" });
          }
          if (
            s === "failure" ||
            s === "failed" ||
            s === "reverted"
          ) {
            return res.status(502).json({ error: "Bridge step failed" });
          }
        }
      }
    }

    return res.status(200).json({ status: "Success" });
  } catch (e: unknown) {
    console.error("execute-bridge-custodial error:", e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : "Internal server error",
    });
  }
}

async function notifyWithdrawalCompleteHandler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });
  try {
    ensureFirebase();
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer "))
      return res.status(401).json({ error: "Unauthorized" });
    const decoded = await getAdminAuth().verifyIdToken(authHeader.slice(7));
    const userId = decoded.uid;
    const body = (req.body as { amount?: number; network?: string }) ?? {};
    const amount = body.amount ?? 0;
    const network = body.network ?? "Solana";
    const { getUserTokens, sendToTokens } =
      await import("../../lib/push-server");
    const tokens = await getUserTokens(userId);
    if (tokens.length > 0) {
      const amountStr = amount > 0 ? `$${amount.toFixed(2)} ` : "";
      await sendToTokens(tokens, {
        title: "Withdrawal complete",
        body: `${amountStr}USDC sent to ${network}`,
        deepLink: "/app/profile",
        data: { type: "withdrawal_complete", refresh: "balance" },
      });
    }
    return res.status(200).json({ ok: true });
  } catch (e: unknown) {
    console.error("notify-withdrawal-complete error:", e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : "Internal server error",
    });
  }
}

const ROUTES: Record<
  string,
  (req: VercelRequest, res: VercelResponse) => Promise<void | VercelResponse>
> = {
  "deposit-quote": depositQuoteHandler,
  "swap-quote": swapQuoteHandler,
  "withdraw-quote": withdrawQuoteHandler,
  "execute-step": executeStepHandler,
  "bridge-from-evm-quote": bridgeFromEvmQuoteHandler,
  "execute-bridge-custodial": executeBridgeCustodialHandler,
  "evm-address": evmAddressHandler,
  "evm-address-remove": evmAddressRemoveHandler,
  "evm-balances": evmBalancesHandler,
  "evm-balances-public": evmBalancesPublicHandler,
  "notify-withdrawal-complete": notifyWithdrawalCompleteHandler,
  currencies: currenciesHandler,
  "coingecko-tokens": coingeckoTokensHandler,
  "coingecko-native-prices": coingeckoNativePricesHandler,
};

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  const path = (req.url ?? "").split("?")[0];
  const segments = path.split("/").filter(Boolean);
  const action = segments[segments.length - 1];
  if (action === "swap-quote" || action === "execute-step") {
    console.log("[relay] request", { action, method: req.method });
  }
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
