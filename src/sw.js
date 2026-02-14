// Unified Service Worker: Workbox (PWA caching) + Firebase Messaging
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute, setCatchHandler } from "workbox-routing";
import { CacheFirst, NetworkFirst, NetworkOnly } from "workbox-strategies";
import { ExpirationPlugin } from "workbox-expiration";
import { BackgroundSyncPlugin } from "workbox-background-sync";
import { clientsClaim } from "workbox-core";

// Clean up old caches and precache new assets
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Offline fallback: when no route handles the request (e.g. navigate while offline), serve offline page
const OFFLINE_URL = "/offline.html";
setCatchHandler(async ({ request }) => {
  if (request.mode === "navigate") {
    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;
    const index = await caches.match("/index.html");
    if (index) return index;
  }
  return new Response("Offline", { status: 503, statusText: "Service Unavailable" });
});

// Auto-update behavior
self.skipWaiting();
clientsClaim();

// Firebase Messaging setup
importScripts(
  "https://www.gstatic.com/firebasejs/11.0.1/firebase-app-compat.js",
);
importScripts(
  "https://www.gstatic.com/firebasejs/11.0.1/firebase-messaging-compat.js",
);

async function initFirebase() {
  try {
    const response = await fetch("/api/firebase-config");
    if (!response.ok) throw new Error("Failed to load Firebase config");
    const config = await response.json();
    if (!config.apiKey) throw new Error("Firebase config missing");
    firebase.initializeApp(config);
    const messaging = firebase.messaging();

    messaging.onBackgroundMessage((payload) => {
      const title = payload.notification?.title || "COPE Alert";
      const options = {
        body: payload.notification?.body || "New wallet activity",
        data: payload.data || {},
        icon: "/icons/icon-192x192.png",
        badge: "/icons/icon-96x96.png",
      };
      self.registration.showNotification(title, options);
    });
  } catch (error) {
    console.error("[SW] Firebase init failed", error);
  }
}

// Web Push API handler (for Safari/iOS)
self.addEventListener("push", (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      data = {
        title: "COPE Alert",
        body: event.data.text() || "New notification",
      };
    }
  }

  const title = data.title || "COPE Alert";
  const options = {
    body: data.body || data.message || "New wallet activity",
    data: data.data || {},
    icon: "/icons/icon-192x192.png",
    badge: "/icons/icon-96x96.png",
    tag: data.tag || "cope-notification",
    requireInteraction: false,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Unified notification click handler (works for both FCM and Web Push)
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const deepLink =
    (event.notification.data && event.notification.data.deepLink) ||
    "/app/alerts";
  const urlToOpen = new URL(deepLink, self.location.origin).href;
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windowClients) => {
        const tClient = windowClients.find(
          (client) =>
            client.url.startsWith(urlToOpen) || client.url.includes(deepLink),
        );
        if (tClient) {
          return tClient.focus();
        }
        return clients.openWindow(urlToOpen);
      }),
  );
});

initFirebase();

// Background Sync: retry failed POST requests to /api/ when back online
const bgSyncPlugin = new BackgroundSyncPlugin("cope-api-sync", {
  maxRetentionTime: 24 * 60, // retry for up to 24 hours
});
registerRoute(
  ({ url }) => url.pathname.startsWith("/api/"),
  new NetworkOnly({ plugins: [bgSyncPlugin] }),
  "POST",
);

// Periodic Sync: optional background refresh (register from app with periodicsync permission)
self.addEventListener("periodicsync", (event) => {
  if (event.tag === "cope-content-refresh") {
    event.waitUntil(
      Promise.all(
        self.clients.matchAll({ type: "window" }).then((clients) =>
          clients.map((c) => c.postMessage({ type: "PERIODIC_SYNC", tag: event.tag })),
        ),
      ).catch(() => {}),
    );
  }
});

// Runtime caching strategies
registerRoute(
  ({ url }) => url.origin === "https://fonts.googleapis.com",
  new CacheFirst({
    cacheName: "google-fonts-cache",
    plugins: [
      new ExpirationPlugin({
        maxEntries: 10,
        maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
      }),
    ],
  }),
);

registerRoute(
  ({ url }) => url.origin === "https://fonts.gstatic.com",
  new CacheFirst({
    cacheName: "gstatic-fonts-cache",
    plugins: [
      new ExpirationPlugin({
        maxEntries: 10,
        maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
      }),
    ],
  }),
);

registerRoute(
  ({ request }) => request.destination === "image",
  new CacheFirst({
    cacheName: "images-cache",
    plugins: [
      new ExpirationPlugin({
        maxEntries: 100,
        maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
      }),
    ],
  }),
);

registerRoute(
  ({ url }) => url.hostname.includes("solana") || url.hostname.includes("sol"),
  new NetworkFirst({
    cacheName: "api-cache",
    networkTimeoutSeconds: 10,
    plugins: [
      new ExpirationPlugin({
        maxEntries: 50,
        maxAgeSeconds: 60 * 5, // 5 minutes
      }),
    ],
  }),
);
