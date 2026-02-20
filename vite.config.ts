import { defineConfig } from "vite";
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { Buffer } from "buffer";

export default defineConfig({
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "icons/*.png", "icons/favicon.svg", "offline.html"],
      manifest: {
        id: "https://trycope.com/",
        name: "COPE - Social Trading App",
        short_name: "COPE",
        description:
          "Social trading app for cryptocurrency trading and wallet management",
        theme_color: "#12d585",
        background_color: "#000000",
        display: "standalone",
        display_override: ["window-controls-overlay", "standalone"],
        dir: "ltr",
        lang: "en",
        launch_handler: { client_mode: "navigate-existing" },
        orientation: "portrait-primary",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "/icons/icon-72x72.png",
            sizes: "72x72",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-96x96.png",
            sizes: "96x96",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-128x128.png",
            sizes: "128x128",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-144x144.png",
            sizes: "144x144",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-152x152.png",
            sizes: "152x152",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-192x192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "/icons/icon-384x384.png",
            sizes: "384x384",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
          {
            src: "/icons/apple-touch-icon.png",
            sizes: "180x180",
            type: "image/png",
            purpose: "any",
          },
        ],
        shortcuts: [
          {
            name: "Home",
            short_name: "Home",
            description: "Go to home screen",
            url: "/app/home",
            icons: [
              {
                src: "/icons/icon-192x192.png",
                sizes: "192x192",
                type: "image/png",
              },
            ],
          },
          {
            name: "Trade",
            short_name: "Trade",
            description: "Open trading screen",
            url: "/app/trade",
            icons: [
              {
                src: "/icons/icon-192x192.png",
                sizes: "192x192",
                type: "image/png",
              },
            ],
          },
          {
            name: "Scanner",
            short_name: "Scanner",
            description: "Scan wallets",
            url: "/scanner",
            icons: [
              {
                src: "/icons/icon-192x192.png",
                sizes: "192x192",
                type: "image/png",
              },
            ],
          },
        ],
        categories: ["finance", "business"],
        screenshots: [
          {
            form_factor: "narrow",
            label: "Home",
            sizes: "1242x2570",
            src: "/screenshots/home.png",
          },
          {
            form_factor: "narrow",
            label: "Trade",
            sizes: "1242x2562",
            src: "/screenshots/trade.png",
          },
          {
            form_factor: "narrow",
            label: "Scanner",
            sizes: "1242x2575",
            src: "/screenshots/scanner.png",
          },
          {
            form_factor: "narrow",
            label: "Profile",
            sizes: "1233x2581",
            src: "/screenshots/profile.png",
          },
        ],
        share_target: {
          action: "/share",
          method: "POST",
          enctype: "multipart/form-data",
          params: {
            title: "title",
            text: "text",
            url: "url",
          },
        },
      },
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.js",
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // 4 MiB (main chunk exceeds 2 MiB default)
        additionalManifestEntries: [{ url: "/offline.html", revision: null }],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/_/],
        // Push notification support
        clientsClaim: true,
        skipWaiting: true,
      },
      devOptions: {
        enabled: true,
        type: "module",
        navigateFallback: "index.html",
      },
    }),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    // Make Buffer available globally
    global: "globalThis",
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: "globalThis",
      },
    },
  },
});
