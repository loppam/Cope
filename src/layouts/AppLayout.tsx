import { ReactNode } from 'react';
import { BottomNav } from '@/components/BottomNav';

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  return (
    <div className="bg-gradient-to-b from-[#000000] to-[#0B3D2E] min-h-screen pb-32">
      {children}
      <BottomNav />
    </div>
  );
}
