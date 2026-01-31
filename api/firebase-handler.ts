// Consolidated: firebase-init, firebase-config
// Rewrites: /__/firebase/init.json → /api/firebase-handler?init=1
//           /api/firebase-config → /api/firebase-handler?config=1
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const isInit = req.query.init === "1" || req.query.init === "true";
  const isConfig = req.query.config === "1" || req.query.config === "true";

  if (isInit) {
    const apiKey = process.env.VITE_FIREBASE_API_KEY;
    const authDomain = process.env.VITE_FIREBASE_AUTH_DOMAIN;
    if (!apiKey || !authDomain) {
      return res.status(500).json({
        error: "Firebase config missing",
        message:
          "Set VITE_FIREBASE_API_KEY and VITE_FIREBASE_AUTH_DOMAIN in Vercel env",
      });
    }
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(200).json({ apiKey, authDomain });
  }

  if (isConfig) {
    return res.status(200).json({
      apiKey: process.env.VITE_FIREBASE_API_KEY,
      authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.VITE_FIREBASE_PROJECT_ID,
      messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.VITE_FIREBASE_APP_ID,
    });
  }

  return res.status(400).json({ error: "Invalid request" });
}
