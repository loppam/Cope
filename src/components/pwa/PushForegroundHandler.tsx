import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { subscribeToForegroundPush } from "@/lib/firebase";
import { toast } from "sonner";
import { Bell, ExternalLink } from "lucide-react";

/**
 * When the app is in the foreground, FCM delivers messages via onMessage instead of
 * the service worker. This component subscribes and shows a styled toast notification
 * so the user still sees notifications while the tab is open.
 */
export function PushForegroundHandler() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    const unsubscribe = subscribeToForegroundPush((payload) => {
      const title = payload.notification?.title || "COPE Alert";
      const body = payload.notification?.body || "";
      const deepLink = payload.data?.deepLink || "/app/alerts";

      // Show styled notification toast
      toast(title, {
        description: body || undefined,
        icon: <Bell className="w-5 h-5 text-[#12d585]" />,
        action: {
          label: "View",
          onClick: () => {
            window.location.href = deepLink;
          },
        },
        duration: 5000,
        style: {
          background: "linear-gradient(135deg, #0F4A38 0%, #0B3D2E 100%)",
          color: "#fff",
          border: "1px solid rgba(18, 213, 133, 0.3)",
          borderRadius: "12px",
          boxShadow:
            "0 4px 12px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(18, 213, 133, 0.1)",
        },
        className: "cope-notification-toast",
      });
    });
    return () => unsubscribe();
  }, [user]);

  return null;
}
