import { Home, TrendingUp, Activity, Bell, User } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router';
import { cn } from '@/lib/utils';

export function BottomNav() {
  const navigate = useNavigate();
  const location = useLocation();

  const tabs = [
    { path: '/app/home', icon: Home, label: 'Home' },
    { path: '/app/positions', icon: TrendingUp, label: 'Positions' },
    { path: '/app/trade', icon: Activity, label: 'Trade', primary: true },
    { path: '/app/alerts', icon: Bell, label: 'Alerts' },
    { path: '/app/profile', icon: User, label: 'Profile' },
  ];

  return (
    <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
      <div className="glass-panel px-6 py-3 rounded-full flex items-center gap-2 shadow-glow border-white/10">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = location.pathname === tab.path;

          return (
            <button
              key={tab.path}
              onClick={() => navigate(tab.path)}
              className={cn(
                'relative flex items-center justify-center w-10 h-10 rounded-full transition-all duration-200',
                isActive
                  ? 'bg-accent-primary text-[#000000]'
                  : 'text-text-secondary hover:text-white hover:bg-white/5'
              )}
            >
              <Icon className={cn('w-5 h-5 z-10', isActive && 'scale-105 transition-transform')} />
              <span className="sr-only">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
