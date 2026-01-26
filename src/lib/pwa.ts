// PWA registration and update handling
// Note: vite-plugin-pwa handles service worker registration automatically
// This function is kept for compatibility but vite-plugin-pwa will handle registration
export function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    // vite-plugin-pwa automatically registers the service worker
    // We just need to listen for updates
    navigator.serviceWorker.ready.then((registration) => {
      console.log('[PWA] Service Worker ready:', registration.scope);

      // Check for updates periodically
      setInterval(() => {
        registration.update();
      }, 60 * 60 * 1000); // Check every hour

      // Handle updates
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New service worker available
              // Dispatch event so UI can show update notification
              window.dispatchEvent(new CustomEvent('pwa-update-available'));
            }
          });
        }
      });
    }).catch((error) => {
      console.error('[PWA] Service Worker error:', error);
    });

    // Handle service worker controller changes (when update is activated)
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        // Reload when new service worker takes control
        window.location.reload();
      }
    });
  }
}

// Install prompt handling
let deferredPrompt: BeforeInstallPromptEvent | null = null;

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    console.log('[PWA] Install prompt available');
    // Dispatch custom event so components can listen
    window.dispatchEvent(new CustomEvent('pwa-install-available'));
  });
}

export function getDeferredPrompt(): BeforeInstallPromptEvent | null {
  return deferredPrompt;
}

export async function showInstallPrompt(): Promise<boolean> {
  if (!deferredPrompt) {
    return false;
  }

  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;

  return outcome === 'accepted';
}

// Check if app is installed
export function isInstalled(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true ||
    document.referrer.includes('android-app://')
  );
}

// Check if app is online
export function isOnline(): boolean {
  return navigator.onLine;
}

// Network status listener
export function setupNetworkListener(callback: (online: boolean) => void) {
  window.addEventListener('online', () => callback(true));
  window.addEventListener('offline', () => callback(false));
}
