import { useState, useEffect } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { isOnline, setupNetworkListener } from "@/lib/pwa";

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
    <div
      className="fixed left-0 right-0 bg-yellow-500/90 text-[#000000] px-4 py-2 flex items-center justify-center gap-2 z-50"
      style={{ top: "var(--safe-area-inset-top)" }}
    >
      <WifiOff className="w-4 h-4" />
      <span className="text-sm font-medium">
        You're offline. Some features may be limited.
      </span>
    </div>
  );
}
