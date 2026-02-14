const IOS_HAPTIC_INPUT_ID = "cope-ios-haptic-switch";
const IOS_HAPTIC_LABEL_ID = "cope-ios-haptic-label";

let iosHapticLabel: HTMLLabelElement | null = null;

function isLikelyIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const platform = navigator.platform || "";
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (platform === "MacIntel" && (navigator.maxTouchPoints ?? 0) > 1)
  );
}

function ensureIOSHapticLabel(): HTMLLabelElement | null {
  if (typeof document === "undefined") return null;
  if (iosHapticLabel && document.contains(iosHapticLabel)) return iosHapticLabel;

  const existing = document.getElementById(
    IOS_HAPTIC_LABEL_ID,
  ) as HTMLLabelElement | null;
  if (existing) {
    iosHapticLabel = existing;
    return existing;
  }

  const root = document.body ?? document.documentElement;
  if (!root) return null;

  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = IOS_HAPTIC_INPUT_ID;
  input.setAttribute("switch", "");
  input.setAttribute("role", "switch");
  input.setAttribute("aria-hidden", "true");
  input.tabIndex = -1;
  input.style.position = "fixed";
  input.style.opacity = "0";
  input.style.pointerEvents = "none";
  input.style.width = "1px";
  input.style.height = "1px";
  input.style.left = "-9999px";
  input.style.top = "0";

  const label = document.createElement("label");
  label.id = IOS_HAPTIC_LABEL_ID;
  label.htmlFor = IOS_HAPTIC_INPUT_ID;
  label.setAttribute("aria-hidden", "true");
  label.style.position = "fixed";
  label.style.opacity = "0";
  label.style.pointerEvents = "none";
  label.style.width = "1px";
  label.style.height = "1px";
  label.style.left = "-9999px";
  label.style.top = "0";
  // iOS 18+ haptic workaround relies on a label click handler.
  label.addEventListener("click", () => {});

  root.appendChild(input);
  root.appendChild(label);
  iosHapticLabel = label;
  return label;
}

function triggerIOSHaptic(): void {
  if (!isLikelyIOS()) return;
  const label = ensureIOSHapticLabel();
  label?.click();
}

/**
 * Trigger a short haptic feedback when supported.
 * - Vibration API for Android/PWA APK.
 * - iOS 18+ label+switch workaround for Safari/PWA.
 */
export function triggerHaptic(): void {
  if (typeof navigator === "undefined") return;
  if ("vibrate" in navigator) {
    navigator.vibrate(10);
  }
  triggerIOSHaptic();
}
