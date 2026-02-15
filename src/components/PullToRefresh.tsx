import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

const PULL_THRESHOLD = 100;
const MAX_PULL = 140;
const RESISTANCE = 0.35;

interface PullToRefreshProps {
  onRefresh: () => void | Promise<void>;
  children: React.ReactNode;
  disabled?: boolean;
}

/**
 * Pull-to-refresh for mobile (touch). Listens to window scroll and touch events.
 * When user is at top and pulls down, shows indicator and triggers onRefresh on release.
 */
export function PullToRefresh({
  onRefresh,
  children,
  disabled = false,
}: PullToRefreshProps) {
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const atTop = useRef(true);
  const pullYRef = useRef(0);
  const refreshingRef = useRef(false);

  pullYRef.current = pullY;
  refreshingRef.current = refreshing;

  const runRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    setRefreshing(true);
    setPullY(0);
    try {
      await Promise.resolve(onRefresh());
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);

  useEffect(() => {
    if (disabled) return;

    const handleTouchStart = (e: TouchEvent) => {
      atTop.current = window.scrollY <= 8;
      startY.current = e.touches[0].clientY;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (refreshingRef.current) return;
      if (!atTop.current) return;
      const y = e.touches[0].clientY;
      const delta = y - startY.current;
      if (delta > 0) {
        const pull = Math.min(delta * RESISTANCE, MAX_PULL);
        setPullY(pull);
      } else {
        setPullY(0);
      }
    };

    const handleTouchEnd = () => {
      const currentPull = pullYRef.current;
      if (refreshingRef.current) {
        setPullY(0);
        return;
      }
      if (currentPull >= PULL_THRESHOLD) {
        runRefresh();
      }
      setPullY(0);
    };

    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("touchmove", handleTouchMove, { passive: true });
    document.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
    };
  }, [disabled, runRefresh]);

  const showIndicator = pullY > 0 || refreshing;
  const indicatorHeight = Math.max(pullY, refreshing ? 52 : 0);

  return (
    <>
      {showIndicator && (
        <div
          className="fixed left-0 right-0 z-50 flex items-center justify-center bg-transparent pointer-events-none"
          style={{
            top: 0,
            height: indicatorHeight,
            transition: refreshing ? "none" : "height 0.15s ease-out",
          }}
        >
          <div
            className="w-9 h-9 rounded-full bg-white/10 flex items-center justify-center border border-white/10"
            style={{
              opacity: Math.min(1, (pullY || 52) / 52),
              transform: `translateY(${Math.min(pullY, 52) / 2 - 26}px)`,
            }}
          >
            {refreshing ? (
              <Loader2 className="w-5 h-5 text-[#12d585] animate-spin" />
            ) : (
              <svg
                className="w-5 h-5 text-white/70"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 14l-7 7m0 0l-7-7m7 7V3"
                />
              </svg>
            )}
          </div>
        </div>
      )}
      {children}
    </>
  );
}
