import { Outlet } from "react-router";
import { BottomNav } from "@/components/BottomNav";
import { PwaTitleBar } from "@/components/pwa/PwaTitleBar";
import { AnimatePage } from "@/components/AnimatePage";

export function MainLayout() {
  return (
    <div
      className="bg-gradient-to-b from-[#000000] to-[#0B3D2E] min-h-screen"
      style={{
        paddingTop: "max(var(--safe-area-inset-top), env(titlebar-area-height, 0px))",
        paddingBottom: "calc(8rem + var(--safe-area-inset-bottom))",
      }}
    >
      <PwaTitleBar />
      <AnimatePage>
        <Outlet />
      </AnimatePage>
      <BottomNav />
    </div>
  );
}
