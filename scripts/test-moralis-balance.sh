#!/bin/bash
# Test Moralis wallet tokens API for Base and BSC
# Usage: ./scripts/test-moralis-balance.sh [ADDRESS]
# Uses MORALIS_API_KEY from .env (source it first: source .env 2>/dev/null || export MORALIS_API_KEY="your-key")
ADDR="${1:-0x414e3656fa298e40d6cd221c67f3c20ba30ee819}"

if [ -z "$MORALIS_API_KEY" ]; then
  echo "Set MORALIS_API_KEY (e.g. from .env)"
  exit 1
fi

echo "=== Base chain ==="
curl -s -X GET "https://deep-index.moralis.io/api/v2.2/wallets/${ADDR}/tokens?chain=base&limit=100&exclude_spam=true" \
  -H "accept: application/json" \
  -H "X-API-Key: $MORALIS_API_KEY" | jq '.' 2>/dev/null || cat

echo ""
echo "=== BSC chain ==="
curl -s -X GET "https://deep-index.moralis.io/api/v2.2/wallets/${ADDR}/tokens?chain=bsc&limit=100&exclude_spam=true" \
  -H "accept: application/json" \
  -H "X-API-Key: $MORALIS_API_KEY" | jq '.' 2>/dev/null || cat
