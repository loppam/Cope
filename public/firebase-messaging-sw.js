importScripts('https://www.gstatic.com/firebasejs/11.0.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.0.1/firebase-messaging-compat.js');

async function initFirebase() {
  try {
    const response = await fetch('/api/firebase-config');
    if (!response.ok) throw new Error('Failed to load Firebase config');
    const config = await response.json();
    if (!config.apiKey) throw new Error('Firebase config missing');
    firebase.initializeApp(config);
    const messaging = firebase.messaging();

    messaging.onBackgroundMessage((payload) => {
      const title = payload.notification?.title || 'COPE Alert';
      const options = {
        body: payload.notification?.body || 'New wallet activity',
        data: payload.data || {},
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-96x96.png',
      };
      self.registration.showNotification(title, options);
    });

    self.addEventListener('notificationclick', (event) => {
      event.notification.close();
      const deepLink = (event.notification.data && event.notification.data.deepLink) || '/app/alerts';
      event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
          const tClient = windowClients.find((client) => client.url.includes(deepLink));
          if (tClient) {
            return tClient.focus();
          }
          return clients.openWindow(deepLink);
        })
      );
    });
  } catch (error) {
    console.error('[SW] Firebase init failed', error);
  }
}

initFirebase();
