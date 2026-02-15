#!/usr/bin/env bash
# Test all API proxies after deploy. Run: ./scripts/test-api-proxies.sh [BASE_URL]
# Example: ./scripts/test-api-proxies.sh https://www.trycope.com

BASE="${1:-https://www.trycope.com}"
FAILED=0

test_ok() {
  local name="$1"
  local url="$2"
  local method="${3:-GET}"
  local extra="${4:-}"
  echo -n "Testing $name... "
  if res=$(curl -s -w "\n%{http_code}" -X "$method" $extra "$url" 2>/dev/null); then
    code=$(echo "$res" | tail -1)
    body=$(echo "$res" | sed '$d')
    # 2xx = success, 400/404 = proxy worked (bad params/not found), 503 = config missing
    if [[ "$code" =~ ^2[0-9][0-9]$ ]] || [[ "$code" == "400" ]] || [[ "$code" == "404" ]]; then
      echo "OK ($code)"
    elif [[ "$code" == "503" ]]; then
      echo "SKIP (503 - API key may be missing)"
    else
      echo "FAIL ($code)"
      echo "  URL: $url"
      echo "  Body: ${body:0:200}..."
      FAILED=$((FAILED + 1))
    fi
  else
    echo "FAIL (curl error)"
    FAILED=$((FAILED + 1))
  fi
}

test_json_has() {
  local name="$1"
  local url="$2"
  local key="$3"
  echo -n "Testing $name (expects JSON with '$key')... "
  body=$(curl -s "$url" 2>/dev/null)
  if echo "$body" | grep -q '"'"$key"'"; then
    echo "OK"
  else
    echo "FAIL (missing or invalid)"
    echo "  URL: $url"
    echo "  Body: ${body:0:200}..."
    FAILED=$((FAILED + 1))
  fi
}

echo "=== Testing API Proxies (base: $BASE) ==="
echo ""

# Birdeye (token-overview, search, pnl-summary, token-txs)
echo "--- Birdeye ---"
test_ok "Birdeye token-overview" \
  "$BASE/api/birdeye/token-overview?address=HaNUKkvWbEUsEydYVuhFNtuz1LKDNs57pD6sK7Kvpump&chain=solana"
test_ok "Birdeye search" \
  "$BASE/api/birdeye/search?term=SOL&limit=5&chains=solana"
test_ok "Birdeye pnl-summary" \
  "$BASE/api/birdeye/pnl-summary?wallet=So11111111111111111111111111111111111111112&duration=all"
test_ok "Birdeye token-txs" \
  "$BASE/api/birdeye/token-txs?address=So11111111111111111111111111111111111111112&limit=5"
test_ok "Birdeye wallet-current-net-worth (SOL/USDC/portfolio)" \
  "$BASE/api/birdeye/wallet-current-net-worth?wallet=So11111111111111111111111111111111111111112"
test_ok "Birdeye wallet-pnl (per-token PnL)" \
  "$BASE/api/birdeye/wallet-pnl?wallet=So11111111111111111111111111111111111111112&token_addresses=So11111111111111111111111111111111111111112"
echo ""

# Moralis (token-overview, search, profitability)
echo "--- Moralis ---"
test_ok "Moralis token-overview (Base USDC)" \
  "$BASE/api/moralis/token-overview?address=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913&chain=base"
test_ok "Moralis search" \
  "$BASE/api/moralis/search?term=USDC&limit=5"
test_ok "Moralis profitability" \
  "$BASE/api/moralis/profitability?address=0x0000000000000000000000000000000000000001&chain=base"
echo ""

# Jupiter (search, price - key endpoints for trade/swap)
echo "--- Jupiter ---"
test_ok "Jupiter search" \
  "$BASE/api/jupiter/ultra/v1/search?query=SOL&limit=5"
test_ok "Jupiter price" \
  "$BASE/api/jupiter/price/v3?ids=So11111111111111111111111111111111111111112"
echo ""

# SolanaTracker (wallet, pnl - key for profile/positions)
echo "--- SolanaTracker ---"
test_ok "SolanaTracker wallet" \
  "$BASE/api/solanatracker/wallet/So11111111111111111111111111111111111111112"
test_ok "SolanaTracker pnl" \
  "$BASE/api/solanatracker/pnl/So11111111111111111111111111111111111111112"
echo ""

# Relay (critical for funding/deposits/withdrawals)
echo "--- Relay (funding tech) ---"
test_ok "Relay currencies" \
  "$BASE/api/relay/currencies?term=SOL&limit=5"
test_json_has "Relay coingecko-native-prices" \
  "$BASE/api/relay/coingecko-native-prices" \
  "eth"
echo ""

echo "=== Summary ==="
if [[ $FAILED -eq 0 ]]; then
  echo "All tests passed."
  exit 0
else
  echo "$FAILED test(s) failed."
  exit 1
fi
