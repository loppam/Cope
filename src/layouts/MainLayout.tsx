import { Outlet } from "react-router";
import { BottomNav } from "@/components/BottomNav";

export function MainLayout() {
  return (
    <div
      className="bg-gradient-to-b from-[#000000] to-[#0B3D2E] min-h-screen"
      style={{
        paddingTop: "var(--safe-area-inset-top)",
        paddingBottom: "calc(8rem + var(--safe-area-inset-bottom))",
      }}
    >
      <Outlet />
      <BottomNav />
    </div>
  );
}
