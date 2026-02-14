#!/usr/bin/env bash
# Print SHA256 fingerprint for the TWA keystore (for verification or manual assetlinks).
# Requires: keystore and .keystore-pass in this directory.
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
if [[ ! -f android.keystore ]] || [[ ! -f .keystore-pass ]]; then
  echo "Missing android.keystore or .keystore-pass in twa-build/" >&2
  exit 1
fi
keytool -list -v -keystore android.keystore -alias twa -storepass "$(cat .keystore-pass)" 2>/dev/null | grep "SHA256:" | sed 's/.*SHA256: /SHA256: /'
