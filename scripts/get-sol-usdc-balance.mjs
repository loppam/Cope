#!/usr/bin/env node
/**
 * Get SOL and USDC balance for a Solana wallet address.
 *
 * Usage:
 *   node scripts/get-sol-usdc-balance.mjs <WALLET_ADDRESS>
 *   WALLET_ADDRESS=YourSolanaAddress node scripts/get-sol-usdc-balance.mjs
 *
 * Env (optional):
 *   SOLANA_RPC_URL - RPC endpoint (default: https://api.mainnet-beta.solana.com)
 *   HELIUS_API_KEY - or use https://rpc.helius.xyz/?api-key=HELIUS_API_KEY
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env");
if (existsSync(envPath)) {
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m) {
      const key = m[1].trim();
      const val = m[2].replace(/^["']|["']$/g, "").trim();
      if (!(key in process.env)) process.env[key] = val;
    }
  }
}

import { Connection, PublicKey } from "@solana/web3.js";

const SOLANA_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function getRpcUrl() {
  if (process.env.SOLANA_RPC_URL) return process.env.SOLANA_RPC_URL;
  if (process.env.HELIUS_API_KEY) {
    return `https://rpc.helius.xyz/?api-key=${process.env.HELIUS_API_KEY}`;
  }
  return "https://api.mainnet-beta.solana.com";
}

async function getSolBalance(connection, walletAddress) {
  const publicKey = new PublicKey(walletAddress);
  const balance = await connection.getBalance(publicKey);
  return balance / 1e9; // lamports -> SOL
}

async function getUsdcBalance(connection, walletAddress) {
  const publicKey = new PublicKey(walletAddress);
  const usdcMint = new PublicKey(SOLANA_USDC_MINT);
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
    mint: usdcMint,
  });

  let total = 0;
  for (const { account } of tokenAccounts.value) {
    const info = account.data?.parsed?.info;
    if (!info?.tokenAmount) continue;
    const tokenAmount = info.tokenAmount;
    let uiAmount = tokenAmount.uiAmount ?? 0;
    if (uiAmount === 0 && tokenAmount.uiAmountString != null) {
      const parsed = parseFloat(tokenAmount.uiAmountString);
      if (Number.isFinite(parsed)) uiAmount = parsed;
    }
    if (uiAmount === 0 && tokenAmount.amount != null && tokenAmount.decimals != null) {
      const raw = Number(tokenAmount.amount);
      if (Number.isFinite(raw)) uiAmount = raw / Math.pow(10, tokenAmount.decimals);
    }
    total += uiAmount;
  }
  return total;
}

async function main() {
  const walletAddress = process.argv[2] || process.env.WALLET_ADDRESS;
  if (!walletAddress) {
    console.error("Usage: node scripts/get-sol-usdc-balance.mjs <WALLET_ADDRESS>");
    console.error("   or: WALLET_ADDRESS=... node scripts/get-sol-usdc-balance.mjs");
    process.exit(1);
  }

  const rpcUrl = getRpcUrl();
  const connection = new Connection(rpcUrl, "confirmed");

  try {
    const [sol, usdc] = await Promise.all([
      getSolBalance(connection, walletAddress),
      getUsdcBalance(connection, walletAddress),
    ]);
    console.log(JSON.stringify({ wallet: walletAddress, sol, usdc }, null, 2));
  } catch (err) {
    console.error("Error:", err.message || err);
    process.exit(1);
  }
}

main();
