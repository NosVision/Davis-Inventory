/**
 * One answer to "is this bottle expired?" for every screen.
 *
 * The rule the business runs on: a deposit is sold as 30 days, and 30 days is the date the
 * customer is told. But a shift runs past midnight, so someone who turns up on day 30 at 01:00 is
 * still inside the night they were counting on — the expiry-check cron knows this and extends the
 * real deadline to the store's closing hour (effectiveExpiryISO), which is why `status` stays
 * `in_store` into the small hours of day 31.
 *
 * The screens did not know it. They computed `daysUntil(expiry_date)` from the raw date, so at
 * 00:01 on day 31 the customer's app said "หมดอายุแล้ว" while the withdraw button — which reads
 * `status` — was still live. Staff read the label and turned people away; customers read it and
 * argued, because by their count the bottle had not expired (owner report 2026-08-11).
 *
 * Nothing here changes when a bottle actually dies. It only stops the label contradicting the
 * button: `status` is the authority, and the countdown is presentation.
 */

export type DepositExpiryState =
  /** No expiry at all (VIP). */
  | 'none'
  /** Comfortably in date. */
  | 'ok'
  /** Within the warning window. */
  | 'soon'
  /**
   * Past the printed date but still withdrawable — the grace hours of the final night.
   * The customer was told 30 days and this is still, to them, that night.
   */
  | 'last_call'
  /** Actually finished: the cron has flipped it. */
  | 'expired';

export interface DepositExpiryDisplay {
  state: DepositExpiryState;
  /** Whole days left against the printed date. Negative once past it. null when there is no expiry. */
  days: number | null;
  /** True while a withdrawal is still allowed. */
  withdrawable: boolean;
}

const SOON_DAYS = 7;

/**
 * `status` decides whether the bottle is dead; the date only decides how the countdown reads.
 * Deliberately NOT recomputing the grace client-side: the cron owns that decision with the store's
 * own closing hour and blocked days, and a second implementation would drift from it.
 */
export function depositExpiryDisplay(deposit: {
  expiry_date?: string | null;
  status?: string | null;
}): DepositExpiryDisplay {
  const status = deposit.status ?? null;
  const raw = deposit.expiry_date ?? null;

  if (status === 'expired') return { state: 'expired', days: raw ? daysLeft(raw) : null, withdrawable: false };
  if (!raw) return { state: 'none', days: null, withdrawable: true };

  const days = daysLeft(raw);
  if (days <= 0) return { state: 'last_call', days, withdrawable: true };
  if (days <= SOON_DAYS) return { state: 'soon', days, withdrawable: true };
  return { state: 'ok', days, withdrawable: true };
}

function daysLeft(expiry: string): number {
  return Math.ceil((new Date(expiry).getTime() - Date.now()) / 86_400_000);
}

/** Thai label for the countdown chip. Keeps the printed 30-day date honest on every surface. */
export function depositExpiryLabelTH(d: DepositExpiryDisplay): string {
  switch (d.state) {
    case 'none':
      return 'ไม่มีวันหมดอายุ';
    case 'expired':
      return 'หมดอายุแล้ว';
    case 'last_call':
      return 'วันสุดท้าย — เบิกได้ถึงร้านปิด';
    case 'soon':
      return d.days === 1 ? 'เหลือ 1 วัน' : `เหลือ ${d.days} วัน`;
    default:
      return `เหลือ ${d.days} วัน`;
  }
}
