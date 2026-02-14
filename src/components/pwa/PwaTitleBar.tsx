/**
 * PWA title bar for window-controls-overlay display mode.
 * Uses CSS env() so the bar sits in the overlay area; draggable for window move.
 */
export function PwaTitleBar() {
  return (
    <div
      className="fixed left-0 top-0 z-50 flex items-center bg-black/80 backdrop-blur-sm"
      style={{
        // When window-controls-overlay is active, fill the titlebar area
        left: "env(titlebar-area-x, 0)",
        top: "env(titlebar-area-y, 0)",
        width: "env(titlebar-area-width, 100%)",
        height: "env(titlebar-area-height, var(--safe-area-inset-top, 0px))",
        minHeight: "env(titlebar-area-height, 0px)",
        WebkitAppRegion: "drag",
        appRegion: "drag",
      }}
    >
      <span
        className="ml-4 truncate text-sm font-medium text-white/90"
        style={{ WebkitAppRegion: "no-drag", appRegion: "no-drag" }}
      >
        COPE
      </span>
    </div>
  );
}
