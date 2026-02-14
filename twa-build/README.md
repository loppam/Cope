# TWA build for COPE (trycope.com)

This folder contains the **keystore** and **TWA manifest** used to build the Android APK for the Solana dApp Store. The keystore was generated for you; its SHA256 fingerprint is already in `public/.well-known/assetlinks.json`.

## Important

- **Do not commit** `android.keystore` or `.keystore-pass`. They are in `.gitignore`.
- **Back up** the keystore and password somewhere secure. You need the same keystore to sign all future updates.

## One-time setup: Bubblewrap and Android project

1. Install Bubblewrap CLI (if not already):
   ```bash
   npm i -g @bubblewrap/cli
   ```

2. Initialize the TWA Android project from the live manifest (run from this directory or a new dir):
   ```bash
   bubblewrap init --manifest https://trycope.com/manifest.json
   ```
   When prompted:
   - Use **existing** keystore: point to `twa-build/android.keystore` and use the password from `twa-build/.keystore-pass`.
   - Or accept defaults and **replace** the generated keystore with `twa-build/android.keystore` and set the password in the project so the fingerprint matches `public/.well-known/assetlinks.json`.

3. **If you used a new directory for init:** Copy `twa-manifest.json` from this folder into that project (overwriting the generated one) so `packageId` stays `com.trycope.app`. Then copy `android.keystore` and `.keystore-pass` into that project so `bubblewrap build` can sign with the same key.

## Build the APK

From the directory that contains the Android project and `twa-manifest.json`:

1. **Set supported locales** in `app/build.gradle` (required for dApp Store):
   ```gradle
   android {
       defaultConfig {
           resConfigs "en"   // add others if needed: "es", "fr"
       }
   }
   ```

2. Build signed release APK:
   ```bash
   bubblewrap build
   ```
   When asked for the keystore password, use the value from `twa-build/.keystore-pass` (or the password you set when using the existing keystore).

3. Output: `app-release-signed.apk` — submit this to the Solana dApp Store.

## Digital Asset Links

Already done. `public/.well-known/assetlinks.json` contains the SHA256 fingerprint of this keystore and `packageId` `com.trycope.app`. Deploy the app so `https://trycope.com/.well-known/assetlinks.json` is live; then the TWA will open full-screen.

## Keystore password

The password is in `twa-build/.keystore-pass`. To use it in a script:

```bash
export TWA_KEYSTORE_PASS=$(cat twa-build/.keystore-pass)
# then pass to bubblewrap if it supports env or flags
```

To change the password (e.g. for production), use `keytool -storepasswd` and then update `assetlinks.json` only if you generate a **new** keystore (new key = new fingerprint). For the same keystore, changing the password does not change the fingerprint.
