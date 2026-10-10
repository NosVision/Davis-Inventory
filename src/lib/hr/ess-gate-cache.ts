/**
 * Per-tab memo for the two app-wide gates the dashboard layout mounts on every full page load:
 * the identity-claim prompt and the policy reader. Each used to ask the server again on every
 * load — three requests (identity twice, policies once) per staff member per load, which at the
 * shift-change peak was ~1,200 requests in 20 minutes for answers that never change within a
 * shift (2026-10-10).
 *
 * What is remembered, and the limits that keep it honest:
 *   • Only the "all clear" answers are cached: `linked = true` and "no policy pending". A user who
 *     still has to claim a name or read a policy is asked the server every time, as before.
 *   • sessionStorage, keyed by user id: the memo lives in this tab only, dies with it, and can never
 *     be read for another account — the trap that ruled out a plain localStorage flag before
 *     (see identity-claim-modal.tsx).
 *   • Six hours, so a newly published policy still reaches an open tab the same day.
 */

export interface IdentityStatus {
  linked: boolean;
  claim: { id: string; full_name_th: string; claimed_at: string } | null;
}

const PREFIX = 'ess-gate:';
const IDENTITY_KEY = 'identity-linked';
export const GATE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
/** Both gates mount together; the second one reuses the first one's request for this long. */
const INFLIGHT_TTL_MS = 30_000;

export function readGateCache(key: string, userId: string): boolean {
  try {
    const raw = window.sessionStorage.getItem(`${PREFIX}${key}`);
    if (!raw) return false;
    const v = JSON.parse(raw) as { userId?: string; until?: number };
    return v.userId === userId && typeof v.until === 'number' && v.until > Date.now();
  } catch {
    return false;
  }
}

export function writeGateCache(key: string, userId: string, ttlMs: number = GATE_CACHE_TTL_MS): void {
  try {
    window.sessionStorage.setItem(`${PREFIX}${key}`, JSON.stringify({ userId, until: Date.now() + ttlMs }));
  } catch {
    // storage blocked (private mode, some webviews) — the gate simply asks the server next time
  }
}

let inflight: { userId: string; at: number; promise: Promise<IdentityStatus | null> } | null = null;

/**
 * The caller's identity-link status. `null` means the request failed — callers treat that as
 * "don't show the prompt", exactly as they did with a non-OK response before.
 */
export function getIdentityStatus(userId: string): Promise<IdentityStatus | null> {
  if (readGateCache(IDENTITY_KEY, userId)) return Promise.resolve({ linked: true, claim: null });
  if (inflight && inflight.userId === userId && Date.now() - inflight.at < INFLIGHT_TTL_MS) {
    return inflight.promise;
  }
  const promise = fetch('/api/hr/ess/identity', { cache: 'no-store' })
    .then(async (res) => {
      if (!res.ok) return null;
      const data = ((await res.json())?.data ?? null) as IdentityStatus | null;
      if (data?.linked) writeGateCache(IDENTITY_KEY, userId);
      return data;
    })
    .catch(() => null);
  inflight = { userId, at: Date.now(), promise };
  return promise;
}
