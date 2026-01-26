# Complete PWA Setup Guide

This is a comprehensive guide explaining how to set up a Progressive Web App (PWA) from scratch. This guide covers every aspect of the PWA implementation so you can recreate it in any project.

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Step-by-Step Setup](#step-by-step-setup)
4. [File Structure](#file-structure)
5. [Detailed Configuration](#detailed-configuration)
6. [How It Works](#how-it-works)
7. [Testing](#testing)
8. [Troubleshooting](#troubleshooting)
9. [Best Practices](#best-practices)

---

## Overview

A Progressive Web App (PWA) is a web application that uses modern web capabilities to provide a native app-like experience. This implementation includes:

- **Web App Manifest**: Defines how the app appears and behaves when installed
- **Service Worker**: Enables offline functionality and caching
- **Install Prompt**: Allows users to install the app on their devices
- **Offline Support**: Caches assets and provides offline fallbacks
- **App Icons**: Multiple sizes for different devices and contexts

---

## Prerequisites

Before starting, ensure you have:

- **Node.js** (v16 or higher)
- **npm** or **pnpm** package manager
- A **Vite + React** project (or similar build tool)
- **HTTPS** for production (required for service workers)
- A source icon image (at least 512x512px) for generating app icons

---

## Step-by-Step Setup

### Step 1: Install Required Dependencies

Install the PWA plugin and related dependencies:

```bash
npm install -D vite-plugin-pwa workbox-window
```

**What these do:**
- `vite-plugin-pwa`: Automatically generates service worker and handles PWA configuration
- `workbox-window`: Provides utilities for service worker lifecycle management

### Step 2: Configure Vite Plugin

Edit your `vite.config.ts` (or `vite.config.js`) to include the PWA plugin:

```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Service worker registration type
      registerType: 'autoUpdate', // Automatically updates when new version is available
      
      // Assets to include in the service worker precache
      includeAssets: ['favicon.ico', 'icons/*.png'],
      
      // Web App Manifest configuration
      manifest: {
        name: 'Your App Name',
        short_name: 'App',
        description: 'Your app description',
        theme_color: '#12d585',
        background_color: '#000000',
        display: 'standalone', // How app appears when installed
        orientation: 'portrait-primary', // Lock orientation (optional)
        scope: '/', // Navigation scope
        start_url: '/', // URL to open when app launches
        
        // Icons configuration (see Step 3)
        icons: [
          {
            src: '/icons/icon-72x72.png',
            sizes: '72x72',
            type: 'image/png',
            purpose: 'any'
          },
          // ... more icon sizes (see full config below)
        ],
        
        // App shortcuts (optional)
        shortcuts: [
          {
            name: 'Home',
            short_name: 'Home',
            description: 'Go to home screen',
            url: '/app/home',
            icons: [{ src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' }]
          }
        ],
        
        // Categories for app stores (optional)
        categories: ['finance', 'business'],
        
        // Share target (optional - allows app to receive shared content)
        share_target: {
          action: '/share',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            title: 'title',
            text: 'text',
            url: 'url'
          }
        }
      },
      
      // Service worker generation strategy
      strategies: 'generateSW', // Generates service worker automatically
      
      // Workbox configuration (caching strategies)
      workbox: {
        // Files to precache (cached on install)
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        
        // Fallback for navigation requests (SPA routing)
        navigateFallback: '/index.html',
        
        // URLs to exclude from navigation fallback
        navigateFallbackDenylist: [/^\/api\//, /^\/_/],
        
        // Runtime caching strategies
        runtimeCaching: [
          // Cache Google Fonts
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst', // Use cache if available, otherwise fetch
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          // Cache Google Fonts static files
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          // Cache images
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
              }
            }
          },
          // Cache API calls (network-first strategy)
          {
            urlPattern: /^https:\/\/.*\.(?:your-api-domain)\.com\/.*/i,
            handler: 'NetworkFirst', // Try network first, fallback to cache
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 5 // 5 minutes
              },
              networkTimeoutSeconds: 10,
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      },
      
      // Development options
      devOptions: {
        enabled: true, // Enable PWA in development
        type: 'module', // Use ES modules
        navigateFallback: 'index.html'
      }
    })
  ]
})
```

**Key Configuration Options Explained:**

- `registerType: 'autoUpdate'`: Service worker automatically updates when a new version is detected
- `strategies: 'generateSW'`: Uses Workbox to generate the service worker automatically
- `handler: 'CacheFirst'`: For static assets (fonts, images) - checks cache first
- `handler: 'NetworkFirst'`: For API calls - tries network first, falls back to cache if offline
- `navigateFallback`: Required for Single Page Apps (SPA) - serves index.html for all routes

### Step 3: Create Web App Manifest

Create `/public/manifest.json`:

```json
{
  "name": "Your App Name",
  "short_name": "App",
  "description": "Your app description",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#000000",
  "theme_color": "#12d585",
  "orientation": "portrait-primary",
  "scope": "/",
  "icons": [
    {
      "src": "/icons/icon-72x72.png",
      "sizes": "72x72",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-96x96.png",
      "sizes": "96x96",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-128x128.png",
      "sizes": "128x128",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-144x144.png",
      "sizes": "144x144",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-152x152.png",
      "sizes": "152x152",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "maskable"
    },
    {
      "src": "/icons/icon-384x384.png",
      "sizes": "384x384",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    },
    {
      "src": "/icons/apple-touch-icon.png",
      "sizes": "180x180",
      "type": "image/png",
      "purpose": "any"
    }
  ],
  "shortcuts": [
    {
      "name": "Home",
      "short_name": "Home",
      "description": "Go to home screen",
      "url": "/app/home",
      "icons": [{ "src": "/icons/icon-192x192.png", "sizes": "192x192", "type": "image/png" }]
    }
  ],
  "categories": ["finance", "business"],
  "share_target": {
    "action": "/share",
    "method": "POST",
    "enctype": "multipart/form-data",
    "params": {
      "title": "title",
      "text": "text",
      "url": "url"
    }
  }
}
```

**Manifest Properties Explained:**

- `name`: Full app name (shown in install prompt)
- `short_name`: Short name (shown on home screen)
- `display`: How app appears when installed
  - `standalone`: Looks like native app (no browser UI)
  - `fullscreen`: Full screen mode
  - `minimal-ui`: Minimal browser UI
  - `browser`: Normal browser
- `theme_color`: Color of status bar/toolbar
- `background_color`: Background color shown during app launch
- `icons`: Array of icon objects with different sizes
  - `purpose: 'any'`: Standard icon
  - `purpose: 'maskable'`: Icon that can be masked (Android adaptive icons)
- `shortcuts`: Quick actions when long-pressing app icon
- `share_target`: Allows app to receive shared content from other apps

### Step 4: Generate App Icons

You need multiple icon sizes for different devices. Create a script to generate them:

**Option 1: Using Sharp (Recommended)**

Create `scripts/generate-icons.js`:

```javascript
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const sizes = [
  { size: 72, name: 'icon-72x72.png' },
  { size: 96, name: 'icon-96x96.png' },
  { size: 128, name: 'icon-128x128.png' },
  { size: 144, name: 'icon-144x144.png' },
  { size: 152, name: 'icon-152x152.png' },
  { size: 192, name: 'icon-192x192.png' },
  { size: 384, name: 'icon-384x384.png' },
  { size: 512, name: 'icon-512x512.png' },
  { size: 180, name: 'apple-touch-icon.png' }
];

const sourceImage = process.argv[2];
const outputDir = path.join(process.cwd(), 'public', 'icons');

if (!sourceImage) {
  console.error('Usage: node scripts/generate-icons.js <path-to-source-image>');
  process.exit(1);
}

// Create output directory if it doesn't exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

async function generateIcons() {
  for (const { size, name } of sizes) {
    await sharp(sourceImage)
      .resize(size, size, { fit: 'cover' })
      .toFile(path.join(outputDir, name));
    console.log(`Generated ${name} (${size}x${size})`);
  }
  console.log('All icons generated successfully!');
}

generateIcons().catch(console.error);
```

Install Sharp:
```bash
npm install -D sharp
```

Run the script:
```bash
node scripts/generate-icons.js path/to/your/icon.png
```

**Option 2: Online Tools**

Use tools like:
- [PWA Asset Generator](https://github.com/onderceylan/pwa-asset-generator)
- [RealFaviconGenerator](https://realfavicongenerator.net/)
- [App Icon Generator](https://www.appicon.co/)

### Step 5: Update HTML File

Add PWA meta tags and manifest link to your `index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="description" content="Your app description" />
    
    <!-- Theme color for mobile browsers -->
    <meta name="theme-color" content="#12d585" />
    
    <!-- iOS PWA meta tags -->
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="App" />
    
    <!-- Android PWA meta tag -->
    <meta name="mobile-web-app-capable" content="yes" />
    
    <!-- PWA Manifest -->
    <link rel="manifest" href="/manifest.json" />
    
    <!-- Icons -->
    <link rel="icon" type="image/png" sizes="32x32" href="/icons/icon-72x72.png" />
    <link rel="icon" type="image/png" sizes="16x16" href="/icons/icon-72x72.png" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    
    <title>Your App Name</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Meta Tags Explained:**

- `theme-color`: Sets the color of the browser's address bar (mobile)
- `apple-mobile-web-app-capable`: Makes iOS treat the app as standalone
- `apple-mobile-web-app-status-bar-style`: iOS status bar style
- `apple-mobile-web-app-title`: Name shown on iOS home screen
- `apple-touch-icon`: Icon for iOS home screen

### Step 6: Create PWA Utility Functions

Create `src/lib/pwa.ts`:

```typescript
// PWA registration and update handling
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
```

**Functions Explained:**

- `registerServiceWorker()`: Sets up service worker update detection
- `setupInstallPrompt()`: Captures the install prompt event
- `showInstallPrompt()`: Triggers the install prompt UI
- `isInstalled()`: Checks if app is running as installed PWA
- `isOnline()`: Checks current network status
- `setupNetworkListener()`: Listens for online/offline events

### Step 7: Initialize PWA in Main Entry Point

Update `src/main.tsx` (or `src/main.js`):

```typescript
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/index.css";
import { registerServiceWorker, setupInstallPrompt } from "./lib/pwa";

// Register PWA service worker
registerServiceWorker();
setupInstallPrompt();

createRoot(document.getElementById("root")!).render(<App />);
```

### Step 8: Create Install Prompt Component

Create `src/components/pwa/InstallPrompt.tsx`:

```typescript
import { useState, useEffect } from 'react';
import { showInstallPrompt, isInstalled, getDeferredPrompt } from '@/lib/pwa';

export function InstallPrompt() {
  const [showPrompt, setShowPrompt] = useState(false);

  useEffect(() => {
    // Don't show if already installed
    if (isInstalled()) {
      return;
    }

    // Check if prompt is available
    const checkPrompt = () => {
      if (getDeferredPrompt()) {
        // Check if prompt was dismissed before (stored in localStorage)
        const wasDismissed = localStorage.getItem('pwa-install-dismissed');
        if (wasDismissed) {
          const dismissedTime = parseInt(wasDismissed, 10);
          const daysSinceDismissed = (Date.now() - dismissedTime) / (1000 * 60 * 60 * 24);
          // Show again after 7 days
          if (daysSinceDismissed < 7) {
            setShowPrompt(false);
            return;
          }
        }
        setShowPrompt(true);
      }
    };

    // Listen for custom event from PWA setup
    const handlePWAInstallAvailable = () => {
      checkPrompt();
    };

    window.addEventListener('pwa-install-available', handlePWAInstallAvailable);
    
    // Check immediately in case prompt was already available
    checkPrompt();

    return () => {
      window.removeEventListener('pwa-install-available', handlePWAInstallAvailable);
    };
  }, []);

  const handleInstall = async () => {
    const result = await showInstallPrompt();
    if (result) {
      setShowPrompt(false);
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    localStorage.setItem('pwa-install-dismissed', Date.now().toString());
  };

  if (!showPrompt) {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-4 right-4 md:left-auto md:right-4 md:w-96 z-50">
      <div className="bg-surface-2 border border-white/10 rounded-lg p-4 shadow-lg">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#12d585] to-[#08b16b] flex items-center justify-center">
              <Download className="w-6 h-6 text-[#000000]" />
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-white font-semibold mb-1">Install App</h3>
            <p className="text-white/60 text-sm mb-3">
              Install our app for a better experience with offline access and faster loading.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleInstall}
                className="flex-1 bg-primary text-white px-4 py-2 rounded"
              >
                Install
              </button>
              <button
                onClick={handleDismiss}
                className="px-3 py-2 border rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Component Features:**

- Only shows if app is not already installed
- Respects user dismissal (won't show again for 7 days)
- Listens for install prompt availability
- Provides install and dismiss buttons

### Step 9: Create Offline Indicator Component

Create `src/components/pwa/OfflineIndicator.tsx`:

```typescript
import { useState, useEffect } from 'react';
import { isOnline, setupNetworkListener } from '@/lib/pwa';

export function OfflineIndicator() {
  const [online, setOnline] = useState(isOnline());

  useEffect(() => {
    setupNetworkListener((isOnline) => {
      setOnline(isOnline);
    });
  }, []);

  if (online) {
    return null;
  }

  return (
    <div className="fixed top-0 left-0 right-0 bg-yellow-500/90 text-black px-4 py-2 flex items-center justify-center gap-2 z-50">
      <WifiOff className="w-4 h-4" />
      <span className="text-sm font-medium">You're offline. Some features may be limited.</span>
    </div>
  );
}
```

### Step 10: Add Components to App

Update `src/App.tsx`:

```typescript
import { InstallPrompt } from '@/components/pwa/InstallPrompt';
import { OfflineIndicator } from '@/components/pwa/OfflineIndicator';

export default function App() {
  return (
    <>
      <OfflineIndicator />
      {/* Your app content */}
      <InstallPrompt />
    </>
  );
}
```

---

## File Structure

After setup, your project should have this structure:

```
your-project/
├── public/
│   ├── manifest.json          # Web app manifest
│   └── icons/                  # App icons directory
│       ├── icon-72x72.png
│       ├── icon-96x96.png
│       ├── icon-128x128.png
│       ├── icon-144x144.png
│       ├── icon-152x152.png
│       ├── icon-192x192.png
│       ├── icon-384x384.png
│       ├── icon-512x512.png
│       └── apple-touch-icon.png
├── src/
│   ├── lib/
│   │   └── pwa.ts              # PWA utility functions
│   ├── components/
│   │   └── pwa/
│   │       ├── InstallPrompt.tsx
│   │       └── OfflineIndicator.tsx
│   ├── main.tsx                # Entry point (initializes PWA)
│   └── App.tsx                  # Main app component
├── scripts/
│   └── generate-icons.js       # Icon generation script
├── vite.config.ts              # Vite config with PWA plugin
└── index.html                  # HTML with PWA meta tags
```

---

## Detailed Configuration

### Service Worker Registration Types

The `registerType` option controls how the service worker updates:

- `'autoUpdate'`: Automatically activates new service worker when available (recommended)
- `'prompt'`: Shows a prompt to user before updating
- `'manual'`: Requires manual refresh to update

### Caching Strategies

Workbox provides several caching strategies:

1. **CacheFirst**: Check cache first, fetch if not found
   - Best for: Static assets, fonts, images
   - Example: `handler: 'CacheFirst'`

2. **NetworkFirst**: Try network first, fallback to cache
   - Best for: API calls, dynamic content
   - Example: `handler: 'NetworkFirst'`

3. **StaleWhileRevalidate**: Serve from cache, update in background
   - Best for: Content that can be slightly stale
   - Example: `handler: 'StaleWhileRevalidate'`

4. **NetworkOnly**: Always fetch from network
   - Best for: Critical real-time data
   - Example: `handler: 'NetworkOnly'`

5. **CacheOnly**: Only serve from cache
   - Best for: Offline-only resources
   - Example: `handler: 'CacheOnly'`

### Display Modes

The `display` property in manifest controls how the app appears:

- `standalone`: No browser UI (looks like native app)
- `fullscreen`: Full screen (no status bar)
- `minimal-ui`: Minimal browser controls
- `browser`: Normal browser experience

---

## How It Works

### Service Worker Lifecycle

1. **Installation**: When user first visits, service worker is installed
   - Assets listed in `globPatterns` are precached
   - Service worker enters "installing" state

2. **Activation**: Service worker becomes active
   - Controls all pages in its scope
   - Can intercept network requests

3. **Update Detection**: On subsequent visits:
   - Browser checks for new service worker
   - If found, new worker enters "installing" state
   - Old worker remains active until new one is ready

4. **Update Activation**: New service worker activates
   - Old worker is terminated
   - New worker takes control
   - Page reloads to use new assets

### Install Prompt Flow

1. User visits site and meets installability criteria
2. Browser fires `beforeinstallprompt` event
3. App captures event and stores it
4. User interacts with site (required)
5. App shows custom install button
6. User clicks install button
7. Browser shows native install prompt
8. User accepts or dismisses
9. If accepted, app is installed

### Offline Functionality

1. **Precaching**: Static assets cached on install
2. **Runtime Caching**: Dynamic content cached based on strategies
3. **Navigation Fallback**: SPA routes serve `index.html` when offline
4. **Network Detection**: App detects online/offline status
5. **Offline Indicator**: UI shows when offline

---

## Testing

### Local Development Testing

1. **Start dev server:**
   ```bash
   npm run dev
   ```

2. **Open Chrome DevTools:**
   - Go to **Application** tab
   - Check **Service Workers** section
   - Verify service worker is registered

3. **Test Manifest:**
   - In DevTools → **Application** → **Manifest**
   - Verify all fields are correct
   - Check for errors

4. **Test Installability:**
   - Look for install button in address bar
   - Or use DevTools → **Application** → **Manifest** → **Add to homescreen**

5. **Test Offline:**
   - DevTools → **Network** tab → Check "Offline"
   - Refresh page
   - Verify app still works

### Production Testing

1. **Build for production:**
   ```bash
   npm run build
   ```

2. **Serve with HTTPS:**
   ```bash
   # Using serve
   npx serve -s dist --ssl-cert cert.pem --ssl-key key.pem
   
   # Or deploy to hosting with HTTPS (Vercel, Netlify, etc.)
   ```

3. **Test on real devices:**
   - **Android**: Chrome browser
   - **iOS**: Safari browser
   - Verify install prompt appears
   - Test offline functionality

4. **Lighthouse Audit:**
   - Chrome DevTools → **Lighthouse** tab
   - Run PWA audit
   - Fix any issues reported

### Installability Criteria

For the install prompt to appear, your app must:

1. ✅ Have a valid manifest
2. ✅ Be served over HTTPS (or localhost)
3. ✅ Have a registered service worker
4. ✅ Have at least one icon (192x192 and 512x512)
5. ✅ User must interact with the site first
6. ✅ Not already be installed

---

## Troubleshooting

### Service Worker Not Registering

**Symptoms:** Service worker doesn't appear in DevTools

**Solutions:**
- Ensure you're using HTTPS (or localhost)
- Check browser console for errors
- Verify `vite-plugin-pwa` is installed
- Check `vite.config.ts` has correct plugin configuration
- Clear browser cache and reload

### Install Prompt Not Showing

**Symptoms:** Install button doesn't appear

**Solutions:**
- Verify manifest is valid (check DevTools → Application → Manifest)
- Ensure all required icons exist
- Check if app is already installed
- User must interact with site first (click, scroll, etc.)
- Verify HTTPS is enabled (required for production)
- Check browser compatibility (Chrome, Edge, Safari iOS 16.4+)

### Icons Not Loading

**Symptoms:** Icons don't appear or are broken

**Solutions:**
- Verify all icon files exist in `/public/icons/`
- Check icon paths in `manifest.json` are correct
- Ensure icon sizes match manifest entries
- Verify icons are valid PNG files
- Check file permissions

### App Not Working Offline

**Symptoms:** App breaks when offline

**Solutions:**
- Verify service worker is active
- Check `navigateFallback` is set correctly
- Ensure assets are in `globPatterns`
- Verify runtime caching is configured
- Test in DevTools offline mode first

### Service Worker Update Not Working

**Symptoms:** Changes don't appear after deployment

**Solutions:**
- Check `registerType` is set to `'autoUpdate'`
- Verify service worker file is being updated
- Clear service worker cache in DevTools
- Check browser isn't blocking updates
- Force update: DevTools → Application → Service Workers → Update

---

## Best Practices

### 1. Icon Design

- Use a square source image (at least 512x512px)
- Ensure important content is in the center (for maskable icons)
- Use high contrast for visibility
- Test on different backgrounds

### 2. Caching Strategy

- **Static assets**: CacheFirst (long expiration)
- **API calls**: NetworkFirst (short expiration)
- **Images**: CacheFirst (medium expiration)
- **Fonts**: CacheFirst (long expiration)

### 3. Update Strategy

- Use `autoUpdate` for most apps
- Show update notification for critical updates
- Test updates thoroughly before deploying

### 4. Offline Experience

- Provide offline fallback pages
- Cache essential assets
- Show clear offline indicators
- Handle API failures gracefully

### 5. Performance

- Minimize precache size
- Use appropriate cache expiration
- Implement lazy loading
- Optimize images before caching

### 6. User Experience

- Don't be pushy with install prompts
- Respect user dismissal preferences
- Provide clear benefits of installing
- Test on real devices

### 7. Security

- Always use HTTPS in production
- Validate cached content
- Don't cache sensitive data
- Implement proper CORS headers

---

## Additional Resources

- [PWA Documentation](https://web.dev/progressive-web-apps/)
- [Web App Manifest](https://web.dev/add-manifest/)
- [Service Workers](https://web.dev/service-workers-cache-storage/)
- [Vite PWA Plugin](https://vite-pwa-org.netlify.app/)
- [Workbox Documentation](https://developers.google.com/web/tools/workbox)
- [PWA Checklist](https://web.dev/pwa-checklist/)

---

## Summary

This guide covers everything needed to set up a complete PWA:

1. ✅ Install and configure `vite-plugin-pwa`
2. ✅ Create web app manifest
3. ✅ Generate app icons
4. ✅ Add PWA meta tags to HTML
5. ✅ Create PWA utility functions
6. ✅ Build install prompt component
7. ✅ Build offline indicator component
8. ✅ Initialize PWA in app entry point
9. ✅ Configure caching strategies
10. ✅ Test and deploy

With this setup, your app will:
- Be installable on devices
- Work offline
- Cache assets for faster loading
- Provide native app-like experience
- Update automatically

Follow this guide step-by-step to recreate the PWA setup in any new project!
