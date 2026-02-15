# API Proxies Audit

Audit completed 2026-02-15. All proxies verified against official docs and fixed for Vercel deployment.

## Summary

| Proxy | Status | Fix Applied | Docs |
|-------|--------|-------------|------|
| **birdeye-proxy** | ✅ Fixed | Inlined handlers (was importing `api/birdeye/[...slug]` → ERR_MODULE_NOT_FOUND) | [Birdeye](https://docs.birdeye.so) |
| **moralis-proxy** | ✅ Fixed | Inlined handlers (was importing `api/moralis/[...slug]` → ERR_MODULE_NOT_FOUND) | [Moralis v2.2](https://docs.moralis.com/web3-data-api/evm) |
| **jupiter-proxy** | ✅ OK | Self-contained, no imports. Forwards to `api.jup.ag` | [Jupiter](https://dev.jup.ag) |
| **solanatracker-proxy** | ✅ OK | Self-contained, no imports. Forwards to `data.solanatracker.io` | [SolanaTracker](https://docs.solanatracker.io) |

## Verified Against Docs

### Jupiter
- Base URL: `https://api.jup.ag` ✓
- Auth: `x-api-key` header ✓
- Paths: `/ultra/v1/search`, `/price/v3`, `/ultra/v1/order`, `/ultra/v1/execute` ✓

### SolanaTracker
- Base URL: `https://data.solanatracker.io` ✓
- Auth: `x-api-key` header ✓
- Paths: `/wallet/{addr}`, `/pnl/{addr}`, `/search`, etc. ✓

### Birdeye
- Base URL: `https://public-api.birdeye.so` ✓
- Auth: `X-API-KEY` header ✓
- Paths: `/defi/token_overview`, `/defi/v3/search`, `/wallet/v2/pnl/summary`, `/defi/v3/token/txs` ✓

### Moralis
- Base URL: `https://deep-index.moralis.io/api/v2.2` ✓
- Auth: `X-API-Key` header ✓
- Paths: `/erc20/metadata`, `/erc20/{addr}/price`, `/erc20/metadata/symbols`, `/wallets/{addr}/profitability` ✓

## Post-Deploy Testing

After pushing to Vercel, run:

```bash
./scripts/test-api-proxies.sh https://www.trycope.com
```

Or with default (trycope.com):

```bash
./scripts/test-api-proxies.sh
```

The script tests:
- Birdeye: token-overview, search, pnl-summary, token-txs
- Moralis: token-overview, search, profitability
- Jupiter: search, price
- SolanaTracker: wallet, pnl
- Relay: currencies, coingecko-native-prices (funding/price support)

## Removed Files (Vercel Module Resolution)

- `api/birdeye/[...slug].ts` – logic inlined into `api/birdeye-proxy.ts`
- `api/moralis/[...slug].ts` – logic inlined into `api/moralis-proxy.ts`

These caused `ERR_MODULE_NOT_FOUND` on Vercel because the bracketed path `api/X/[...slug]` could not be resolved when imported from another serverless function.
