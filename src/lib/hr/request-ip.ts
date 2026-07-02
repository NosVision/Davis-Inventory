/**
 * Resolve the originating client IP from a request, spoof-resistantly.
 *
 * Trust model: the LEFTMOST `x-forwarded-for` entry is whatever the CLIENT sent —
 * proxies append the observed peer IP on the right, so `xff.split(',')[0]` is
 * attacker-controllable and must NOT be trusted for anti-fraud signals (§F anti-VPN).
 *
 * On Vercel (and most managed edges) `x-real-ip` is set by the platform to the true
 * connecting IP and cannot be prepended by the client, so we prefer it. The
 * `x-forwarded-for` fallback is only for deploy targets that don't set `x-real-ip`;
 * on those, spoof-resistance depends on a trusted reverse proxy in front of the app.
 */
export interface HeaderBag {
  get(name: string): string | null;
}

export function getClientIp(headers: HeaderBag): string | null {
  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;

  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  return null;
}
