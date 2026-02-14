import { ReactNode } from "react";
import { BottomNav } from "@/components/BottomNav";
import { PwaTitleBar } from "@/components/pwa/PwaTitleBar";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div
      className="bg-gradient-to-b from-[#000000] to-[#0B3D2E] min-h-screen"
      style={{
        paddingBottom: `calc(8rem + var(--safe-area-inset-bottom))`,
        paddingTop: "max(var(--safe-area-inset-top), env(titlebar-area-height, 0px))",
      }}
    >
      <PwaTitleBar />
      {children}
      <BottomNav />
    </div>
  );
}
