# API Usage and Replacement Matrix

Documentation-derived audit of all third-party APIs used in the project: **API**, **Usage**, **Replaceable?**, **Replacement (per docs)**.

---

## Solana Tracker (data.solanatracker.io)

| API | Usage | Replaceable? | Replacement |
|-----|-------|--------------|-------------|
| **GET /wallet/{owner}** | `getWalletPositions()` in `src/lib/solanatracker.ts` — *unused* (dead code). Previously used by log-balance cron; now replaced. | Yes (done) | **Birdeye** `GET /wallet/v2/current-net-worth` — [Birdeye docs](https://docs.birdeye.so/reference/get-wallet-v2-current-net-worth): "Retrieve current net worth and portfolio of a wallet." Returns `items` with address, balance, value (USD), symbol. |
| **GET /pnl/{wallet}** | `getWalletPnL()` → `getWalletPnLSummary()` in `src/lib/solanatracker.ts`. Used only by `getWalletPositions()` (dead). | Yes | **Birdeye** `GET /wallet/v2/pnl` (per-token) + `GET /wallet/v2/pnl/summary` — [Birdeye wallet PnL](https://docs.birdeye.so/reference/get-wallet-v2-pnl): `total_invested`, `realized_profit_usd`, `unrealized_usd`, `total_usd`. Summary gives aggregated stats. |
| **GET /pnl/{wallet}/{token}** | `getTokenPnL()` in `src/lib/solanatracker.ts` — *unused*. | Yes | **Birdeye** `GET /wallet/v2/pnl?wallet=&token_addresses=` — same endpoint with token filter. |
| **GET /top-traders/{token}** | `getTopTradersForToken()` in `src/lib/solanatracker.ts`, previously used by `scanWalletsForTokens()` — *migrated*. | Yes (done) | **Birdeye** `defi/v3/token/txs` — [Birdeye token txs](https://docs.birdeye.so): Fetch swap transactions per token, derive wallets from `owner`, compute invested/removed from volumes. No direct "top traders by PnL" equivalent; our `scanWalletsForTokens` now uses tx-derived approach. |
| **GET /search** | Not used. Token search uses Jupiter (`/ultra/v1/search`) for Solana and Birdeye (`/defi/v3/search`) via `searchTokensUnified`. | N/A | **Birdeye** `GET /defi/v3/search` — [Birdeye search](https://docs.birdeye.so/reference/get-defi-v3-search): token search by keyword/address. |
| **GET /tokens/{tokenAddress}** | Not used. Token info uses Jupiter (`/ultra/v1/search`) for Solana. | N/A | **Birdeye** `GET /defi/token_overview` or Jupiter Ultra search. |

---

## Birdeye (public-api.birdeye.so)

| API | Usage | Replaceable? | Replacement |
|-----|-------|--------------|-------------|
| **GET /wallet/v2/current-net-worth** | `getWalletSolAndUsdcBalances`, `getWalletPortfolioWithPnL`, log-balance cron. Profile, Positions, Home, PublicProfile, Trade (token balance). | No | Primary source. [Docs](https://docs.birdeye.so/reference/get-wallet-v2-current-net-worth). |
| **GET /wallet/v2/pnl** | `getWalletPortfolioWithPnL` — per-token PnL. | No | Primary. Note: [Birdeye marks v2/pnl deprecated](https://docs.birdeye.so/reference/get-wallet-v2-pnl) but still functional; monitor for successor. |
| **GET /wallet/v2/pnl/summary** | `getWalletPnLSummary` in `src/lib/birdeye.ts` → Positions page. | No | Primary. |
| **GET /defi/v3/search** | `searchTokensUnified` in `src/lib/birdeye-token.ts` → TokenSearch (Solana chain). | No | Primary for Solana token search. |
| **GET /defi/token_overview** | `fetchBirdeyeTokenOverview` in `src/lib/birdeye-token.ts` — token metadata/price. | No | Primary. |
| **GET /defi/v3/token/txs** | `getTokenTransactionsPaginated` → `scanWalletsForTokens` (Scanner). | No | Primary. [Birdeye token txs](https://docs.birdeye.so). |
| **POST /wallet/v2/token-balance** | `getWalletTokenBalance` in `src/lib/birdeye-token.ts` — balance for specific token addresses. | No | Primary. |

---

## Jupiter (api.jup.ag)

| API | Usage | Replaceable? | Replacement |
|-----|-------|--------------|-------------|
| **GET /ultra/v1/search** | `searchTokens`, `getTokenInfo` in `src/lib/jupiter.ts` — Trade page when loading Solana token by mint. | No | Primary for Solana token search/info in Trade. [Jupiter docs](https://dev.jup.ag). |
| **GET /price/v3** | Jupiter proxy, log-balance cron (SOL price). | No | Primary for token prices. |
| **POST /ultra/v1/order**, **POST /ultra/v1/execute** | Swap execution. | No | Primary. |

---

## Moralis (deep-index.moralis.io/api/v2.2)

| API | Usage | Replaceable? | Replacement |
|-----|-------|--------------|-------------|
| **GET /erc20/metadata**, **GET /erc20/{addr}/price**, **GET /erc20/metadata/symbols** | EVM token search/overview in `src/lib/moralis-token.ts`, `api/token-search.ts`. | No | Primary for Base/BNB. [Moralis v2.2](https://docs.moralis.com/web3-data-api/evm). |
| **GET /wallets/{addr}/tokens** | Inlined in relay + cron — EVM wallet tokens (Base, BNB). | No | Primary. Uses raw `balance/10^decimals` (prefer over `balance_formatted`). **USDC** for bridging/positions: RPC only. Base USDC = 6 decimals; BNB USDC = 18 decimals. |

---

## Solana RPC (Solana Tracker or public RPC)

| API | Usage | Replaceable? | Replacement |
|-----|-------|--------------|-------------|
| **getBalance** | `getSolBalanceServer` in `api/cron/log-balance.ts` (fallback when `baseUrl` missing); `rpc.ts` URL config. | Yes (optional) | **Birdeye** `wallet/v2/current-net-worth` covers SOL. RPC fallback kept for cron when Birdeye unavailable. |
| **getTokenAccountsByOwner** | `getUsdcBalanceServer` in `api/cron/log-balance.ts` (fallback); `getTokenAccounts` in `src/lib/rpc.ts`. | Yes (optional) | **Birdeye** `wallet/v2/current-net-worth` covers USDC and all tokens. RPC used for `getTokenAccounts` (client) and cron fallback. |
| **rpc-mainnet.solanatracker.io** | Optional RPC provider via `SOLANATRACKER_RPC_API_KEY` / `SOLANATRACKER_API_KEY`. | Yes | Any Solana RPC (Helius, QuickNode, public). [Solana Tracker RPC](https://docs.solanatracker.io/solana-rpc/http/getbalance). |

---

## Summary: Replaceability

| Provider | Status | Notes |
|----------|--------|-------|
| **Solana Tracker Data API** | Largely replaceable | Wallet, PnL, top-traders → Birdeye. Search/token info → Jupiter + Birdeye. |
| **Birdeye** | Primary | No replacement in use; monitor deprecated `/wallet/v2/pnl`. |
| **Jupiter** | Primary | Search, price, swap. |
| **Moralis** | Primary | EVM chains. |
| **Solana RPC** | Optional fallback | Birdeye for balances when available; RPC for `getTokenAccounts` and cron fallback. |

---

*References: [Solana Tracker llms.txt](https://docs.solanatracker.io/llms.txt), [Birdeye Reference](https://docs.birdeye.so/reference), [Jupiter](https://dev.jup.ag), [Moralis v2.2](https://docs.moralis.com/web3-data-api/evm).*
