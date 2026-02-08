import { Home, Search, Activity, Bell, User } from "lucide-react";
import { useNavigate, useLocation } from "react-router";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";

export function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const { userProfile } = useAuth();
  const isLopam = userProfile?.xHandle?.toLowerCase?.() === "@lopam.eth";

  const tabs = [
    { path: "/app/home", icon: Home, label: "Home" },
    { path: "/app/scanner", icon: Search, label: "Scanner" },
    { path: "/app/trade", icon: Activity, label: "Trade", primary: true },
    { path: "/app/alerts", icon: Bell, label: "Alerts" },
    { path: "/app/profile", icon: User, label: "Profile" },
  ];

  return (
    <nav
      className="fixed left-1/2 -translate-x-1/2 z-50"
      style={{
        bottom: `calc(1rem + var(--safe-area-inset-bottom))`,
      }}
    >
      <div className="glass-panel px-4 sm:px-6 py-2 sm:py-3 rounded-full flex items-center gap-1 sm:gap-2 shadow-glow border-white/10">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = location.pathname === tab.path;

          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              className={cn(
                "relative flex items-center justify-center w-10 h-10 rounded-full transition-all duration-200 active:scale-95",
                isActive
                  ? "bg-accent-primary text-[#000000]"
                  : "text-text-secondary hover:text-white hover:bg-white/5",
              )}
            >
              <Icon
                className={cn(
                  "w-5 h-5 z-10 transition-transform duration-200",
                  isActive && "scale-110",
                )}
              />
              <span className="sr-only">{tab.label}</span>
            </button>
          );
        })}
        {isLopam && (
          <button
            onClick={() => navigate("/lopam/push")}
            className="relative flex items-center justify-center h-10 px-3 rounded-full text-xs tracking-wide bg-white/5 text-white hover:bg-white/10 transition-colors"
          >
            Admin Push
          </button>
        )}
      </div>
    </nav>
  );
}
