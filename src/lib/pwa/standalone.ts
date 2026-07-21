// Shared "are we running as the installed app?" detection (client report 2026-07-21: some
// devices that really did launch from the installed icon still hit the install gate).
//
// Detection layers, most → least reliable:
// 1. display-mode media queries — covers standalone AND the other installed display modes
//    (fullscreen / minimal-ui / window-controls-overlay); some launchers report those instead.
// 2. navigator.standalone — iOS home-screen apps.
// 3. android-app:// referrer — WebAPK / TWA launches on devices whose display-mode query lies.
// 4. The manifest start_url marker (?source=pwa): every launch from the installed icon loads the
//    start_url, so the root layout's inline <head> script stamps sessionStorage before React
//    mounts. sessionStorage is per app-window (never shared with browser tabs), so this cannot
//    leak an "installed" state into a plain browser session — which would defeat the PWA gate.

export const PWA_LAUNCH_SESSION_KEY = 'pwa-standalone-launch';

const INSTALLED_DISPLAY_MODES = ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'];

/** True when this window is the installed app (home-screen launch), best-effort. Client only. */
export function isStandaloneLaunch(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (INSTALLED_DISPLAY_MODES.some((m) => window.matchMedia(`(display-mode: ${m})`).matches)) {
      return true;
    }
    if ((navigator as { standalone?: boolean }).standalone === true) return true;
    if (document.referrer.startsWith('android-app://')) return true;
    if (new URLSearchParams(window.location.search).get('source') === 'pwa') return true;
    if (window.sessionStorage.getItem(PWA_LAUNCH_SESSION_KEY) === '1') return true;
  } catch {
    // matchMedia/sessionStorage unavailable (old WebView, private mode) — fall through
  }
  return false;
}
