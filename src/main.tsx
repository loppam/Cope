import { createRoot } from "react-dom/client";
import { Buffer } from 'buffer';
import App from "./App";
import "./styles/index.css";
import { registerServiceWorker, setupInstallPrompt } from "./lib/pwa";

// Make Buffer available globally for browser compatibility
if (typeof window !== 'undefined') {
  (window as any).Buffer = Buffer;
  (window as any).global = window;
}

// Register PWA service worker
registerServiceWorker();
setupInstallPrompt();

createRoot(document.getElementById("root")!).render(<App />);