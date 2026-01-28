import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { subscribeToForegroundPush } from "@/lib/firebase";
import { toast } from "sonner";

/**
 * When the app is in the foreground, FCM delivers messages via onMessage instead of
 * the service worker. This component subscribes and shows a toast so the user still
 * sees notifications while the tab is open.
 */
export function PushForegroundHandler() {
  const { user } = useAuth();

  useEffect(() => {
    if (!user) return;
    const unsubscribe = subscribeToForegroundPush((payload) => {
      const title = payload.notification?.title || "COPE Alert";
      const body = payload.notification?.body || "";
      toast(title, { description: body || undefined });
    });
    return () => unsubscribe();
  }, [user]);

  return null;
}
