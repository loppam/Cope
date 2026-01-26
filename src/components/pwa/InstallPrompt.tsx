import { useState, useEffect } from 'react';
import { Button } from '@/components/Button';
import { Download, X } from 'lucide-react';
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
            <h3 className="text-white font-semibold mb-1">Install COPE</h3>
            <p className="text-white/60 text-sm mb-3">
              Install our app for a better experience with offline access and faster loading.
            </p>
            <div className="flex gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={handleInstall}
                className="flex-1"
              >
                Install
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDismiss}
                className="px-3"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
