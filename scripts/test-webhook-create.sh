#!/usr/bin/env bash
# Create a Helius webhook that watches the test wallet.
# Loads HELIUS_API_KEY and WEBHOOK_URL from .env in project root.
# Usage: ./scripts/test-webhook-create.sh

set -e
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "Missing .env. Create it from .env.example and set HELIUS_API_KEY and WEBHOOK_URL."
  exit 1
fi

# Load only these vars (avoid sourcing .env due to multi-line values like private key)
HELIUS_API_KEY=$(grep -E '^HELIUS_API_KEY=' .env | cut -d= -f2- | tr -d '\r')
WEBHOOK_URL=$(grep -E '^WEBHOOK_URL=' .env | cut -d= -f2- | tr -d '\r')

if [[ -z "$HELIUS_API_KEY" ]]; then
  echo "HELIUS_API_KEY not set in .env"
  exit 1
fi

WEBHOOK_URL="${WEBHOOK_URL:-https://www.trycope.com/api/webhook/transaction}"
WALLET="9F9bVr2h2Koiedq9C5t8Q4YtbkeNM9Ew52pFSWaWWxKi"

echo "Creating webhook for wallet: $WALLET"
echo "Webhook URL: $WEBHOOK_URL"
echo ""

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST \
  "https://api-mainnet.helius-rpc.com/v0/webhooks?api-key=${HELIUS_API_KEY}" \
  -H "Content-Type: application/json" \
  -d "{\"webhookURL\": \"${WEBHOOK_URL}\", \"transactionTypes\": [\"ANY\"], \"accountAddresses\": [\"${WALLET}\"], \"webhookType\": \"enhanced\"}")

# macOS head doesn't support -n -1; use sed to drop last line
HTTP_CODE=$(echo "$RESPONSE" | tail -n 1)
HTTP_BODY=$(echo "$RESPONSE" | sed '$d')

echo "HTTP $HTTP_CODE"
echo "$HTTP_BODY" | jq . 2>/dev/null || echo "$HTTP_BODY"

if [[ "$HTTP_CODE" != "200" && "$HTTP_CODE" != "201" ]]; then
  exit 1
fi

WEBHOOK_ID=$(echo "$HTTP_BODY" | jq -r '.webhookID // empty')
if [[ -n "$WEBHOOK_ID" ]]; then
  echo ""
  echo "Add to .env (and Vercel) for future updates: HELIUS_WEBHOOK_ID=$WEBHOOK_ID"
fi
