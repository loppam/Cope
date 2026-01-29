# Firebase Auth on Mobile (Safari / redirect flow)

This app uses **Option 3** from [Firebase redirect best practices](https://firebase.google.com/docs/auth/web/redirect-best-practices): we proxy auth requests to Firebase so the auth iframe and `init.json` are served from our domain. That fixes:

- **404 for `init.json`** – we serve it at `/__/firebase/init.json` via `api/firebase-init`
- **“Network connection lost” for auth iframe** – Safari blocks third-party storage; same-origin iframe avoids that

## Production checklist

1. **Env (Vercel)**  
   Set:
   - `VITE_FIREBASE_AUTH_DOMAIN=www.trycope.com` (your app domain, not `*.firebaseapp.com`)

2. **Twitter Developer Portal**  
   Add this redirect URI:
   - `https://www.trycope.com/__/auth/handler`

3. **Firebase Console → Authentication → Settings → Authorized domains**  
   Add:
   - `www.trycope.com` (and your root domain if different)

4. **`vercel.json`**  
   The auth proxy rewrites `/__/auth/*` to `https://dplug-687cf.firebaseapp.com/__/auth/*`. If your Firebase project ID is different, change that URL in `vercel.json` to `https://<your-project-id>.firebaseapp.com/__/auth/$1`.

After deploying, sign-in with redirect (e.g. X/Twitter on mobile) should work without the init.json 404 or iframe connection errors.
