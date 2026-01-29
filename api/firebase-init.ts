import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * Serves /__/firebase/init.json for Firebase Auth redirect flow.
 * Required when using auth proxy (Option 3) so the SDK gets config from our domain
 * instead of firebaseapp.com (avoids init.json 404 and Safari iframe blocking).
 * See: https://firebase.google.com/docs/auth/web/redirect-best-practices
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.VITE_FIREBASE_API_KEY;
  const authDomain = process.env.VITE_FIREBASE_AUTH_DOMAIN;

  if (!apiKey || !authDomain) {
    return res.status(500).json({
      error: "Firebase config missing",
      message:
        "Set VITE_FIREBASE_API_KEY and VITE_FIREBASE_AUTH_DOMAIN in Vercel env",
    });
  }

  // Minimal init.json format expected by Firebase Auth SDK
  const init = {
    apiKey,
    authDomain,
  };

  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(200).json(init);
}
