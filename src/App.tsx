import { useEffect } from "react";
import { RouterProvider } from "react-router";
import { router } from "@/routes";
import { Toaster } from "sonner";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { OfflineIndicator } from "@/components/pwa/OfflineIndicator";
import { PushForegroundHandler } from "@/components/pwa/PushForegroundHandler";
import { AuthProvider } from "@/contexts/AuthContext";
import { triggerHaptic } from "@/lib/haptic";

function TapHapticListener() {
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      const target = (e.target as Element).closest("[data-tap-haptic]");
      if (target) triggerHaptic();
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, []);
  return null;
}

export default function App() {
  return (
    <AuthProvider>
      <TapHapticListener />
      <PushForegroundHandler />
      <OfflineIndicator />
      <RouterProvider router={router} />
      <Toaster
        position="top-center"
        toastOptions={{
          style: {
            background: "linear-gradient(135deg, #0F4A38 0%, #0B3D2E 100%)",
            color: "#fff",
            border: "1px solid rgba(18, 213, 133, 0.3)",
            borderRadius: "12px",
            boxShadow:
              "0 4px 12px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(18, 213, 133, 0.1)",
            marginTop: "var(--safe-area-inset-top)",
          },
          classNames: {
            title: "!text-white",
            description: "!text-white",
            content: "!text-white",
            actionButton: "!text-white",
            cancelButton: "!text-white",
          },
        }}
        className="cope-toaster"
      />
      <InstallPrompt />
    </AuthProvider>
  );
}
