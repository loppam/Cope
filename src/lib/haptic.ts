/**
 * Trigger a short haptic feedback when supported (e.g. Android).
 * No-op on unsupported devices (e.g. iOS Safari).
 */
export function triggerHaptic(): void {
  if (typeof navigator === "undefined") return;
  if ("vibrate" in navigator) {
    navigator.vibrate(10);
  }
}
