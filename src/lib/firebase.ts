// Firebase configuration and initialization
import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import { getAnalytics, Analytics, isSupported } from "firebase/analytics";
import { getAuth, Auth, connectAuthEmulator } from "firebase/auth";
import {
  getFirestore,
  Firestore,
  connectFirestoreEmulator,
} from "firebase/firestore";
import {
  getMessaging,
  getToken,
  onMessage,
  Messaging,
} from "firebase/messaging";

// Firebase configuration - these should be in your .env file
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID, // Optional: for Analytics
};

// Initialize Firebase
let app: FirebaseApp;
if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApps()[0];
}

// Initialize Firebase services
export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app);
export let messaging: Messaging | null = null;

if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  try {
    messaging = getMessaging(app);
  } catch (error) {
    console.warn("[Firebase] Messaging initialization skipped:", error);
  }
}

// Initialize Analytics (only in browser environment and if measurementId is provided)
// Analytics is optional and errors are caught to prevent app crashes
let analytics: Analytics | null = null;
if (typeof window !== "undefined" && firebaseConfig.measurementId) {
  // Initialize analytics asynchronously to avoid blocking app startup
  (async () => {
    try {
      const supported = await isSupported();
      if (supported) {
        analytics = getAnalytics(app);
        console.log("[Firebase] Analytics initialized");
      }
    } catch (error) {
      // Silently fail - analytics is optional
      console.warn("[Firebase] Analytics initialization skipped:", error);
    }
  })();
}
export { analytics };

export async function requestFirebaseMessagingToken(
  vapidKey?: string,
): Promise<string | null> {
  if (!messaging) return null;
  try {
    const resolvedVapidKey =
      vapidKey || import.meta.env.VITE_FIREBASE_VAPID_KEY;
    if (!resolvedVapidKey) {
      console.warn("[Firebase] VAPID key is missing");
    }

    // Get the unified service worker registration (Vite PWA)
    let registration: ServiceWorkerRegistration | null = null;
    if ("serviceWorker" in navigator) {
      registration = await navigator.serviceWorker.ready;
    }

    return await getToken(messaging, {
      vapidKey: resolvedVapidKey,
      serviceWorkerRegistration: registration || undefined,
    });
  } catch (error) {
    console.error("[Firebase] Failed to get messaging token:", error);
    return null;
  }
}

/** Subscribe to foreground push messages (app open). Returns unsubscribe. */
export function subscribeToForegroundPush(
  callback: (payload: {
    notification?: { title?: string; body?: string };
    data?: Record<string, string>;
  }) => void,
): () => void {
  if (!messaging) return () => {};
  return onMessage(messaging, callback);
}

// Connect to emulators in development (optional)
if (
  import.meta.env.DEV &&
  import.meta.env.VITE_USE_FIREBASE_EMULATOR === "true"
) {
  try {
    connectAuthEmulator(auth, "http://localhost:9099", {
      disableWarnings: true,
    });
    connectFirestoreEmulator(db, "localhost", 8080);
  } catch (error) {
    console.warn("Firebase emulator connection failed:", error);
  }
}

export default app;
