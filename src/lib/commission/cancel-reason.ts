/**
 * Cancelling commission money always has to say WHY (owner ask 2026-08-06: "หากต้องการยกเลิกบิล
 * ต้องระบุเหตุผลทุกครั้ง อยากให้ล็อคตรงนี้ไว้"). The rule lives here — not in a form — so every
 * route that voids a bill, a payout, or hard-deletes an entry enforces the same bar and a client
 * that forgets the field is refused rather than silently writing NULL.
 */

/** Shortest reason worth keeping. "ผิด" / "ซ้ำ" are 2–3 chars and legitimate; "-" and "." are not. */
export const MIN_CANCEL_REASON_LENGTH = 2;

export const CANCEL_REASON_REQUIRED_MESSAGE = 'ต้องระบุเหตุผลในการยกเลิกทุกครั้ง';

/**
 * Normalize a caller-supplied reason, or explain why it isn't one. Punctuation-only text is
 * rejected: a dash is the placeholder people reach for when they don't want to give a reason.
 */
export function requireCancelReason(raw: unknown): { ok: true; reason: string } | { ok: false; error: string } {
  const reason = typeof raw === 'string' ? raw.trim() : '';
  const meaningful = reason.replace(/[\s\-_.·•]/g, '');
  if (meaningful.length < MIN_CANCEL_REASON_LENGTH) {
    return { ok: false, error: CANCEL_REASON_REQUIRED_MESSAGE };
  }
  return { ok: true, reason };
}

/** Same verdict as `requireCancelReason`, for greying out a confirm button as the user types. */
export function hasCancelReason(raw: unknown): boolean {
  return requireCancelReason(raw).ok;
}
