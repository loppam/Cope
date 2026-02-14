# Digital Asset Links (TWA / Solana dApp Store)

This folder is served at `https://trycope.com/.well-known/`.

## assetlinks.json

**Already configured.** It contains the SHA256 fingerprint of the TWA signing key (keystore in `twa-build/android.keystore`) and package `com.trycope.app`. The APK must be signed with that same keystore so the TWA opens full-screen.

To re-check the fingerprint: run `twa-build/get-fingerprint.sh`. See [Solana Mobile – Publishing a PWA](https://docs.solanamobile.com/dapp-publishing/publishing-a-pwa).
