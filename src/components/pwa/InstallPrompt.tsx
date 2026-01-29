import { useState, useEffect } from "react";
import { Button } from "@/components/Button";
import { Download, X, Share2 } from "lucide-react";
import { showInstallPrompt, isInstalled, getDeferredPrompt } from "@/lib/pwa";

// Check if device is iOS
const isIOS = () => {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
};

// Check if device is Android
const isAndroid = () => {
  return /Android/.test(navigator.userAgent);
};

export function InstallPrompt() {
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIOSDevice, setIsIOSDevice] = useState(false);
  const [isAndroidDevice, setIsAndroidDevice] = useState(false);

  useEffect(() => {
    // Don't show if already installed
    if (isInstalled()) {
      return;
    }

    setIsIOSDevice(isIOS());
    setIsAndroidDevice(isAndroid());

    // Check if prompt is available
    const checkPrompt = () => {
      const deferredPrompt = getDeferredPrompt();

      // For iOS, always show instructions (no beforeinstallprompt event)
      if (isIOS() && !isInstalled()) {
        const wasDismissed = localStorage.getItem("pwa-install-dismissed");
        if (wasDismissed) {
          const dismissedTime = parseInt(wasDismissed, 10);
          const daysSinceDismissed =
            (Date.now() - dismissedTime) / (1000 * 60 * 60 * 24);
          // Show again after 7 days
          if (daysSinceDismissed < 7) {
            setShowPrompt(false);
            return;
          }
        }
        setShowPrompt(true);
        return;
      }

      // For Android/Chrome, use beforeinstallprompt
      if (deferredPrompt) {
        const wasDismissed = localStorage.getItem("pwa-install-dismissed");
        if (wasDismissed) {
          const dismissedTime = parseInt(wasDismissed, 10);
          const daysSinceDismissed =
            (Date.now() - dismissedTime) / (1000 * 60 * 60 * 24);
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

    window.addEventListener("pwa-install-available", handlePWAInstallAvailable);

    // Check immediately in case prompt was already available
    checkPrompt();

    return () => {
      window.removeEventListener(
        "pwa-install-available",
        handlePWAInstallAvailable,
      );
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
    localStorage.setItem("pwa-install-dismissed", Date.now().toString());
  };

  if (!showPrompt) {
    return null;
  }

  return (
    <div
      className="fixed left-4 right-4 md:left-auto md:right-4 md:w-96 z-50"
      style={{
        bottom: "calc(1rem + var(--safe-area-inset-bottom))",
      }}
    >
      <div className="bg-surface-2 border border-white/10 rounded-lg p-4 shadow-lg">
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#12d585] to-[#08b16b] flex items-center justify-center">
              {isIOSDevice ? (
                <Share2 className="w-6 h-6 text-[#000000]" />
              ) : (
                <Download className="w-6 h-6 text-[#000000]" />
              )}
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-white font-semibold mb-1">Install COPE</h3>
            {isIOSDevice ? (
              <>
                <p className="text-white/60 text-sm mb-2">
                  Install COPE on your iPhone or iPad:
                </p>
                <ol className="text-white/70 text-xs space-y-1 mb-3 list-decimal list-inside">
                  <li>
                    Tap the <Share2 className="w-3 h-3 inline" /> Share button
                  </li>
                  <li>Scroll down and tap "Add to Home Screen"</li>
                  <li>Tap "Add" to confirm</li>
                </ol>
              </>
            ) : isAndroidDevice ? (
              <p className="text-white/60 text-sm mb-3">
                Install our app for a better experience with offline access and
                faster loading.
              </p>
            ) : (
              <p className="text-white/60 text-sm mb-3">
                Install our app for a better experience with offline access and
                faster loading.
              </p>
            )}
            <div className="flex gap-2">
              {!isIOSDevice && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleInstall}
                  className="flex-1"
                >
                  Install
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={handleDismiss}
                className={isIOSDevice ? "flex-1" : "px-3"}
              >
                {isIOSDevice ? "Got it" : <X className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
