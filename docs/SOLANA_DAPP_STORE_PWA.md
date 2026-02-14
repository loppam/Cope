# Solana dApp Store – PWA (trycope.com)

Checklist for publishing the COPE PWA to the Solana dApp Store as a TWA (Trusted Web Activity).

**Manifest URL:** `https://trycope.com/manifest.json`

## 1. Install Bubblewrap CLI

```bash
npm i -g @bubblewrap/cli
```

Requires Node 14.15.0+.

## 2. Initialize TWA project

In a **new directory** (not this repo):

```bash
bubblewrap init --manifest https://trycope.com/manifest.json
```

- Set domain/URL to `https://trycope.com`
- Create and **securely store** the Android keystore and password (needed for all future updates)

This creates `twa-manifest.json` and Android project files. Only commit `twa-manifest.json` if you use version control for the TWA project.

## 3. Build APK

**Before building:** Edit the generated `build.gradle` and set supported locales:

```gradle
android {
    defaultConfig {
        ...
        resConfigs "en"   // add any others: "es", "fr", etc.
    }
}
```

Then:

```bash
bubblewrap build
```

Output: signed release APK (e.g. `app-release-signed.apk`).

## 4. Digital Asset Links (done)

The repo already has a **real** SHA256 fingerprint in `public/.well-known/assetlinks.json` (package `com.trycope.app`). The keystore used for that fingerprint lives in `twa-build/android.keystore` (see `twa-build/README.md`). You must use **this same keystore** when signing the APK so the TWA opens full-screen.

To re-check the fingerprint: run `twa-build/get-fingerprint.sh` (requires `android.keystore` and `twa-build/.keystore-pass`).

Deploy so that `https://trycope.com/.well-known/assetlinks.json` is served (already configured in `vercel.json`).

## 5. Test

```bash
bubblewrap install app-release-signed.apk
```

If the browser bar appears, fix Digital Asset Links (step 4).

## 6. Submit to dApp Store

Use the [dApp publishing guide](https://docs.solanamobile.com/dapp-publishing/) and submit the signed APK.

## Updating later

After changing TWA config (e.g. icon):

```bash
bubblewrap update --manifest=./twa-manifest.json
bubblewrap build
```

Then submit the new APK as an update.
